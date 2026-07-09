/**
 * Memory Tools
 *
 * Memories are atomic knowledge items: decisions, insights, context, notes.
 * Supports semantic search when embeddings are available, falls back to text search.
 */

import { BaseTool, ToolParams, ToolResponse } from "../base/tool.js";
import {
  createMemory,
  updateMemory,
  getMemoryById,
  listMemories,
  deleteMemory,
  searchMemoriesVector,
  getMemoriesBySupersedes,
  getTopicById,
  getTopicByName,
  createTopic,
  safeTouchTopicLastReferenced,
  Memory,
  MemoryKind,
  MemorySearchResult,
  stripTodoVectors,
  stripMemoryVectors,
} from "../../schema/memorySchema.js";
import { safeEmbed, getEmbeddingProvider } from "../../embeddings/index.js";

// ============================================================================
// add_memory
// ============================================================================

interface AddMemoryParams extends ToolParams {
  title: string;
  content: string;
  kind?: MemoryKind;
  topic_id?: string;
  topic_name?: string;
  tags?: string[];
  importance?: number;
  conversation_summary?: string;
  supersedes_id?: string;
}

export class AddMemoryTool extends BaseTool<AddMemoryParams> {
  name = "add_memory";
  description =
    "Store a distilled memory. Keep content concise (1-10 sentences). For updates to existing memories, use update_memory or set supersedes_id.";

  inputSchema = {
    type: "object" as const,
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

  async execute(params: AddMemoryParams): Promise<ToolResponse> {
    try {
      let topicId = params.topic_id ?? null;

      // Create topic on-the-fly if topic_name provided without topic_id
      if (!topicId && params.topic_name) {
        // Check if topic with this name already exists
        const existingTopic = await getTopicByName(params.topic_name);
        if (existingTopic) {
          topicId = existingTopic.id;
        } else {
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
        await safeTouchTopicLastReferenced(topicId);
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
    } catch (error) {
      return this.handleError(error);
    }
  }
}

// ============================================================================
// update_memory
// ============================================================================

interface UpdateMemoryParams extends ToolParams {
  memory_id: string;
  title?: string;
  content?: string;
  kind?: MemoryKind;
  topic_id?: string | null;
  tags?: string[];
  importance?: number;
}

export class UpdateMemoryTool extends BaseTool<UpdateMemoryParams> {
  name = "update_memory";
  description = "Update an existing memory's content or metadata.";

  inputSchema = {
    type: "object" as const,
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

  async execute(params: UpdateMemoryParams): Promise<ToolResponse> {
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

      const updates: Partial<Memory> = {};

      if (params.title !== undefined) updates.title = params.title;
      if (params.content !== undefined) updates.content = params.content;
      if (params.kind !== undefined) updates.kind = params.kind;
      if (params.topic_id !== undefined) updates.topic_id = params.topic_id;
      if (params.tags !== undefined) updates.tags = params.tags;
      if (params.importance !== undefined) updates.importance = params.importance;

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
        await safeTouchTopicLastReferenced(memory.topic_id);
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
    } catch (error) {
      return this.handleError(error);
    }
  }
}

// ============================================================================
// search_memories
// ============================================================================

interface SearchMemoriesParams extends ToolParams {
  query: string;
  topic_id?: string;
  topic_ids?: string[];
  kind_filter?: MemoryKind[];
  tag_filter?: string[];
  min_importance?: number;
  since?: string;
  include_content?: boolean;
  limit?: number;
}

export class SearchMemoriesTool extends BaseTool<SearchMemoriesParams> {
  name = "search_memories";
  description =
    "Search memories using semantic similarity and/or filters. Returns compact results by default.";

  inputSchema = {
    type: "object" as const,
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

  async execute(params: SearchMemoriesParams): Promise<ToolResponse> {
    try {
      const limit = params.limit ?? 10;
      const includeContent = params.include_content ?? false;

      const provider = getEmbeddingProvider();
      let results: MemorySearchResult[] = [];

      // Try vector search first
      if (provider.isAvailable()) {
        const queryVector = await safeEmbed(params.query);

        if (queryVector) {
          const vectorResults = await searchMemoriesVector(
            queryVector,
            {
              topic_id: params.topic_id,
              topic_ids: params.topic_ids,
              kind_filter: params.kind_filter,
              tag_filter: params.tag_filter,
              min_importance: params.min_importance,
              since: params.since,
            },
            limit
          );

          // Transform to search results
          results = await Promise.all(
            vectorResults.map(async (m) => {
              const topic = m.topic_id ? await getTopicById(m.topic_id) : null;
              const result: MemorySearchResult = {
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
                await safeTouchTopicLastReferenced(m.topic_id);
              }

              return result;
            })
          );
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

        results = await Promise.all(
          matched.map(async ({ memory, score }) => {
            const topic = memory.topic_id ? await getTopicById(memory.topic_id) : null;
            const result: MemorySearchResult = {
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
          })
        );
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
    } catch (error) {
      return this.handleError(error);
    }
  }
}

// ============================================================================
// get_memory
// ============================================================================

interface GetMemoryParams extends ToolParams {
  memory_id: string;
  include_linked_todos?: boolean;
  include_supersession_chain?: boolean;
}

export class GetMemoryTool extends BaseTool<GetMemoryParams> {
  name = "get_memory";
  description =
    "Get full details for a single memory, including linked todos and supersession chain.";

  inputSchema = {
    type: "object" as const,
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

  async execute(params: GetMemoryParams): Promise<ToolResponse> {
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

      const response: {
        memory: Omit<Memory, 'vector'>;
        linked_todos?: any[];
        supersedes?: Omit<Memory, 'vector'> | null;
        superseded_by?: Omit<Memory, 'vector'> | null;
      } = { memory: memoryWithoutVector };

      // Get linked todos
      if (params.include_linked_todos ?? true) {
        const { listTodos } = await import("../../schema/memorySchema.js");
        const linkedTodos = await listTodos({
          memory_id: params.memory_id,
        });
        response.linked_todos = stripTodoVectors(linkedTodos);
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
        await safeTouchTopicLastReferenced(memory.topic_id);
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
    } catch (error) {
      return this.handleError(error);
    }
  }
}

// ============================================================================
// get_memory_timeline
// ============================================================================

interface GetMemoryTimelineParams extends ToolParams {
  topic_id: string;
  kind_filter?: MemoryKind[];
  since?: string;
  until?: string;
  include_content?: boolean;
  limit?: number;
}

export class GetMemoryTimelineTool extends BaseTool<GetMemoryTimelineParams> {
  name = "get_memory_timeline";
  description =
    "Get chronological memory history for a topic. Useful for understanding project evolution.";

  inputSchema = {
    type: "object" as const,
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

  async execute(params: GetMemoryTimelineParams): Promise<ToolResponse> {
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

      // Strip vectors and optionally strip content
      const includeContent = params.include_content ?? true;
      const cleanMemories = stripMemoryVectors(memories).map((m) =>
        includeContent ? m : { ...m, content: undefined as any }
      );

      // Touch topic last_referenced_at
      await safeTouchTopicLastReferenced(params.topic_id);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(cleanMemories, null, 2),
          },
        ],
        isError: false,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }
}

// ============================================================================
// delete_memory
// ============================================================================

interface DeleteMemoryParams extends ToolParams {
  memory_id: string;
}

export class DeleteMemoryTool extends BaseTool<DeleteMemoryParams> {
  name = "delete_memory";
  description =
    "Delete a memory. Use sparingly - prefer updating importance to 0 for soft deprecation.";

  inputSchema = {
    type: "object" as const,
    properties: {
      memory_id: {
        type: "string",
        description: "ID of the memory to delete",
      },
    },
    required: ["memory_id"],
  };

  async execute(params: DeleteMemoryParams): Promise<ToolResponse> {
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
    } catch (error) {
      return this.handleError(error);
    }
  }
}
