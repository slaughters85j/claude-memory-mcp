/**
 * Memory Tools
 *
 * Memories are atomic knowledge items: decisions, insights, context, notes.
 * Supports semantic search when embeddings are available, falls back to text search.
 */
import { BaseTool } from "../base/tool.js";
import { createMemory, updateMemory, getMemoryById, listMemories, deleteMemory, searchMemoriesVector, getMemoriesBySupersedes, getTopicById, getTopicByName, createTopic, touchTopicLastReferenced, } from "../../schema/memorySchema.js";
import { safeEmbed, getEmbeddingProvider } from "../../embeddings/index.js";
export class AddMemoryTool extends BaseTool {
    constructor() {
        super(...arguments);
        this.name = "add_memory";
        this.description = "Store a distilled memory. Keep content concise (1-10 sentences). For updates to existing memories, use update_memory or set supersedes_id.";
        this.inputSchema = {
            type: "object",
            properties: {
                title: {
                    type: "string",
                    description: "Short label for listing (< 100 chars)",
                    maxLength: 100,
                },
                content: {
                    type: "string",
                    description: "The actual memory (1-10 sentences, target < 500 chars)",
                    maxLength: 2000,
                },
                kind: {
                    type: "string",
                    enum: ["decision", "insight", "context", "preference", "outcome", "blocker", "reference", "other"],
                    description: "Type of memory",
                    default: "insight",
                },
                topic_id: {
                    type: "string",
                    description: "Associate with existing topic by ID",
                },
                topic_name: {
                    type: "string",
                    description: "Create new topic if topic_id not provided",
                },
                tags: {
                    type: "array",
                    items: { type: "string" },
                    description: "Cross-cutting concern tags",
                },
                importance: {
                    type: "number",
                    description: "Priority level from 0.0 to 1.0",
                    minimum: 0,
                    maximum: 1,
                    default: 0.5,
                },
                conversation_summary: {
                    type: "string",
                    description: "One-liner about source conversation",
                    maxLength: 200,
                },
                supersedes_id: {
                    type: "string",
                    description: "ID of memory this replaces/updates",
                },
            },
            required: ["title", "content"],
        };
    }
    async execute(params) {
        try {
            let topicId = params.topic_id ?? null;
            // Create topic on-the-fly if topic_name provided without topic_id
            if (!topicId && params.topic_name) {
                // Check if topic with this name already exists
                const existingTopic = await getTopicByName(params.topic_name);
                if (existingTopic) {
                    topicId = existingTopic.id;
                }
                else {
                    const newTopic = await createTopic({
                        name: params.topic_name,
                        description: "",
                        tags: [],
                        importance: 0.5,
                        status: "active",
                    });
                    topicId = newTopic.id;
                }
            }
            // Generate embedding for semantic search
            const textForEmbedding = `${params.title}. ${params.content}`;
            const vector = await safeEmbed(textForEmbedding);
            const memory = await createMemory({
                topic_id: topicId,
                title: params.title,
                content: params.content,
                kind: params.kind ?? "insight",
                tags: params.tags ?? [],
                importance: params.importance ?? 0.5,
                conversation_summary: params.conversation_summary ?? null,
                supersedes_id: params.supersedes_id ?? null,
                vector,
            });
            // Touch the topic's last_referenced_at
            if (topicId) {
                await touchTopicLastReferenced(topicId);
            }
            // Strip vector from output (too large, not useful for Claude)
            const { vector: _v, ...memoryWithoutVector } = memory;
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(memoryWithoutVector, null, 2),
                    },
                ],
                isError: false,
            };
        }
        catch (error) {
            return this.handleError(error);
        }
    }
}
export class UpdateMemoryTool extends BaseTool {
    constructor() {
        super(...arguments);
        this.name = "update_memory";
        this.description = "Update an existing memory's content or metadata.";
        this.inputSchema = {
            type: "object",
            properties: {
                memory_id: {
                    type: "string",
                    description: "ID of the memory to update",
                },
                title: {
                    type: "string",
                    description: "New title",
                    maxLength: 100,
                },
                content: {
                    type: "string",
                    description: "New content",
                    maxLength: 2000,
                },
                kind: {
                    type: "string",
                    enum: ["decision", "insight", "context", "preference", "outcome", "blocker", "reference", "other"],
                    description: "New kind",
                },
                topic_id: {
                    type: ["string", "null"],
                    description: "Reassign to different topic, null to orphan",
                },
                tags: {
                    type: "array",
                    items: { type: "string" },
                    description: "New tags (replaces existing)",
                },
                importance: {
                    type: "number",
                    description: "New importance level",
                    minimum: 0,
                    maximum: 1,
                },
            },
            required: ["memory_id"],
        };
    }
    async execute(params) {
        try {
            const existing = await getMemoryById(params.memory_id);
            if (!existing) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Memory not found: ${params.memory_id}`,
                        },
                    ],
                    isError: true,
                };
            }
            const updates = {};
            if (params.title !== undefined)
                updates.title = params.title;
            if (params.content !== undefined)
                updates.content = params.content;
            if (params.kind !== undefined)
                updates.kind = params.kind;
            if (params.topic_id !== undefined)
                updates.topic_id = params.topic_id;
            if (params.tags !== undefined)
                updates.tags = params.tags;
            if (params.importance !== undefined)
                updates.importance = params.importance;
            // Recompute embedding if content changed
            if (params.content !== undefined || params.title !== undefined) {
                const newTitle = params.title ?? existing.title;
                const newContent = params.content ?? existing.content;
                const textForEmbedding = `${newTitle}. ${newContent}`;
                updates.vector = await safeEmbed(textForEmbedding);
            }
            const memory = await updateMemory(params.memory_id, updates);
            if (!memory) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to update memory ${params.memory_id}. The update operation returned no result.`,
                        },
                    ],
                    isError: true,
                };
            }
            // Touch the topic's last_referenced_at
            if (memory.topic_id) {
                await touchTopicLastReferenced(memory.topic_id);
            }
            // Strip vector from output (too large, not useful for Claude)
            const { vector: _v, ...memoryWithoutVector } = memory;
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(memoryWithoutVector, null, 2),
                    },
                ],
                isError: false,
            };
        }
        catch (error) {
            return this.handleError(error);
        }
    }
}
export class SearchMemoriesTool extends BaseTool {
    constructor() {
        super(...arguments);
        this.name = "search_memories";
        this.description = "Search memories using semantic similarity and/or filters. Returns compact results by default.";
        this.inputSchema = {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Natural language search query",
                },
                topic_id: {
                    type: "string",
                    description: "Limit to specific topic",
                },
                topic_ids: {
                    type: "array",
                    items: { type: "string" },
                    description: "Limit to multiple topics",
                },
                kind_filter: {
                    type: "array",
                    items: {
                        type: "string",
                        enum: ["decision", "insight", "context", "preference", "outcome", "blocker", "reference", "other"],
                    },
                    description: "Filter by memory kind(s)",
                },
                tag_filter: {
                    type: "array",
                    items: { type: "string" },
                    description: "Filter by tag(s), AND logic",
                },
                min_importance: {
                    type: "number",
                    description: "Minimum importance threshold",
                },
                since: {
                    type: "string",
                    description: "ISO date, only memories updated after this",
                },
                include_content: {
                    type: "boolean",
                    description: "Include full content in results",
                    default: false,
                },
                limit: {
                    type: "number",
                    description: "Maximum results to return",
                    default: 10,
                    maximum: 30,
                },
            },
            required: ["query"],
        };
    }
    async execute(params) {
        try {
            const limit = params.limit ?? 10;
            const includeContent = params.include_content ?? false;
            const provider = getEmbeddingProvider();
            let results = [];
            // Try vector search first
            if (provider.isAvailable()) {
                const queryVector = await safeEmbed(params.query);
                if (queryVector) {
                    const vectorResults = await searchMemoriesVector(queryVector, {
                        topic_id: params.topic_id,
                        topic_ids: params.topic_ids,
                        kind_filter: params.kind_filter,
                        tag_filter: params.tag_filter,
                        min_importance: params.min_importance,
                        since: params.since,
                    }, limit);
                    // Transform to search results
                    results = await Promise.all(vectorResults.map(async (m) => {
                        const topic = m.topic_id ? await getTopicById(m.topic_id) : null;
                        const result = {
                            id: m.id,
                            title: m.title,
                            kind: m.kind,
                            topic_name: topic?.name ?? null,
                            importance: m.importance,
                            similarity_score: 1 - (m._distance ?? 0), // Convert distance to similarity
                            updated_at: m.updated_at,
                            tags: m.tags,
                        };
                        if (includeContent) {
                            result.content = m.content;
                        }
                        // Touch topic last_referenced_at
                        if (m.topic_id) {
                            await touchTopicLastReferenced(m.topic_id);
                        }
                        return result;
                    }));
                }
            }
            // Fallback to text search if no vector results
            if (results.length === 0) {
                const allMemories = await listMemories({
                    topic_id: params.topic_id,
                    topic_ids: params.topic_ids,
                    kind_filter: params.kind_filter,
                    tag_filter: params.tag_filter,
                    min_importance: params.min_importance,
                    since: params.since,
                    limit: limit * 3, // Get more to filter
                });
                // Simple text matching
                const queryLower = params.query.toLowerCase();
                const matched = allMemories
                    .map((m) => {
                    const titleMatch = m.title.toLowerCase().includes(queryLower);
                    const contentMatch = m.content.toLowerCase().includes(queryLower);
                    const score = titleMatch ? 0.8 : contentMatch ? 0.5 : 0;
                    return { memory: m, score };
                })
                    .filter((x) => x.score > 0)
                    .sort((a, b) => b.score - a.score)
                    .slice(0, limit);
                results = await Promise.all(matched.map(async ({ memory, score }) => {
                    const topic = memory.topic_id ? await getTopicById(memory.topic_id) : null;
                    const result = {
                        id: memory.id,
                        title: memory.title,
                        kind: memory.kind,
                        topic_name: topic?.name ?? null,
                        importance: memory.importance,
                        similarity_score: score,
                        updated_at: memory.updated_at,
                        tags: memory.tags,
                    };
                    if (includeContent) {
                        result.content = memory.content;
                    }
                    return result;
                }));
            }
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(results, null, 2),
                    },
                ],
                isError: false,
            };
        }
        catch (error) {
            return this.handleError(error);
        }
    }
}
export class GetMemoryTool extends BaseTool {
    constructor() {
        super(...arguments);
        this.name = "get_memory";
        this.description = "Get full details for a single memory, including linked todos and supersession chain.";
        this.inputSchema = {
            type: "object",
            properties: {
                memory_id: {
                    type: "string",
                    description: "ID of the memory to retrieve",
                },
                include_linked_todos: {
                    type: "boolean",
                    description: "Include todos linked to this memory",
                    default: true,
                },
                include_supersession_chain: {
                    type: "boolean",
                    description: "Include supersedes/superseded_by chain",
                    default: false,
                },
            },
            required: ["memory_id"],
        };
    }
    async execute(params) {
        try {
            const memory = await getMemoryById(params.memory_id);
            if (!memory) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Memory not found: ${params.memory_id}`,
                        },
                    ],
                    isError: true,
                };
            }
            // Strip vector from output (too large, not useful for Claude)
            const { vector: _v, ...memoryWithoutVector } = memory;
            const response = { memory: memoryWithoutVector };
            // Get linked todos
            if (params.include_linked_todos ?? true) {
                const { listTodos } = await import("../../schema/memorySchema.js");
                response.linked_todos = await listTodos({
                    memory_id: params.memory_id,
                });
            }
            // Get supersession chain
            if (params.include_supersession_chain) {
                // What this memory supersedes
                if (memory.supersedes_id) {
                    const supersedes = await getMemoryById(memory.supersedes_id);
                    if (supersedes) {
                        const { vector: _v2, ...supersedesWithoutVector } = supersedes;
                        response.supersedes = supersedesWithoutVector;
                    }
                }
                // What supersedes this memory
                const supersededBy = await getMemoriesBySupersedes(params.memory_id);
                if (supersededBy) {
                    const { vector: _v3, ...supersededByWithoutVector } = supersededBy;
                    response.superseded_by = supersededByWithoutVector;
                }
            }
            // Touch topic last_referenced_at
            if (memory.topic_id) {
                await touchTopicLastReferenced(memory.topic_id);
            }
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(response, null, 2),
                    },
                ],
                isError: false,
            };
        }
        catch (error) {
            return this.handleError(error);
        }
    }
}
export class GetMemoryTimelineTool extends BaseTool {
    constructor() {
        super(...arguments);
        this.name = "get_memory_timeline";
        this.description = "Get chronological memory history for a topic. Useful for understanding project evolution.";
        this.inputSchema = {
            type: "object",
            properties: {
                topic_id: {
                    type: "string",
                    description: "ID of the topic",
                },
                kind_filter: {
                    type: "array",
                    items: {
                        type: "string",
                        enum: ["decision", "insight", "context", "preference", "outcome", "blocker", "reference", "other"],
                    },
                    description: "Filter by memory kind(s)",
                },
                since: {
                    type: "string",
                    description: "ISO date, start of timeline",
                },
                until: {
                    type: "string",
                    description: "ISO date, end of timeline",
                },
                include_content: {
                    type: "boolean",
                    description: "Include full content",
                    default: true,
                },
                limit: {
                    type: "number",
                    description: "Maximum memories to return",
                    default: 20,
                    maximum: 50,
                },
            },
            required: ["topic_id"],
        };
    }
    async execute(params) {
        try {
            let memories = await listMemories({
                topic_id: params.topic_id,
                kind_filter: params.kind_filter,
                since: params.since,
                until: params.until,
                limit: params.limit ?? 20,
            });
            // Sort by created_at ascending (chronological)
            memories.sort((a, b) => a.created_at.localeCompare(b.created_at));
            // Optionally strip content
            if (!(params.include_content ?? true)) {
                memories = memories.map((m) => ({
                    ...m,
                    content: undefined,
                    vector: undefined,
                }));
            }
            else {
                // Remove vectors from output (too noisy)
                memories = memories.map((m) => ({
                    ...m,
                    vector: undefined,
                }));
            }
            // Touch topic last_referenced_at
            await touchTopicLastReferenced(params.topic_id);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(memories, null, 2),
                    },
                ],
                isError: false,
            };
        }
        catch (error) {
            return this.handleError(error);
        }
    }
}
export class DeleteMemoryTool extends BaseTool {
    constructor() {
        super(...arguments);
        this.name = "delete_memory";
        this.description = "Delete a memory. Use sparingly - prefer updating importance to 0 for soft deprecation.";
        this.inputSchema = {
            type: "object",
            properties: {
                memory_id: {
                    type: "string",
                    description: "ID of the memory to delete",
                },
            },
            required: ["memory_id"],
        };
    }
    async execute(params) {
        try {
            const existing = await getMemoryById(params.memory_id);
            if (!existing) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Memory not found: ${params.memory_id}`,
                        },
                    ],
                    isError: true,
                };
            }
            await deleteMemory(params.memory_id);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ deleted: true }, null, 2),
                    },
                ],
                isError: false,
            };
        }
        catch (error) {
            return this.handleError(error);
        }
    }
}
