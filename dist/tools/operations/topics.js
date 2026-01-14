/**
 * Topic Tools
 *
 * Topics are conceptual buckets for organizing memories.
 * Projects, themes, domains - anything that groups related memories together.
 */
import { BaseTool } from "../base/tool.js";
import { createTopic, updateTopic, getTopicById, listTopics, deleteTopic, listMemories, listTodos, countMemoriesByTopic, countOpenTodosByTopic, } from "../../schema/memorySchema.js";
export class CreateTopicTool extends BaseTool {
    constructor() {
        super(...arguments);
        this.name = "create_topic";
        this.description = "Create a new topic to organize memories. Topics are buckets for projects, themes, or domains.";
        this.inputSchema = {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "Short label for the topic (e.g., 'AlarmWizard', 'Poland ASRR')",
                    maxLength: 100,
                },
                description: {
                    type: "string",
                    description: "1-2 sentence summary of what this topic covers",
                    maxLength: 500,
                },
                tags: {
                    type: "array",
                    items: { type: "string" },
                    description: "Flexible categorization tags",
                },
                importance: {
                    type: "number",
                    description: "Priority level from 0.0 to 1.0",
                    minimum: 0,
                    maximum: 1,
                    default: 0.5,
                },
                status: {
                    type: "string",
                    enum: ["active", "paused"],
                    description: "Initial status of the topic",
                    default: "active",
                },
            },
            required: ["name"],
        };
    }
    async execute(params) {
        try {
            const topic = await createTopic({
                name: params.name,
                description: params.description ?? "",
                tags: params.tags ?? [],
                importance: params.importance ?? 0.5,
                status: params.status ?? "active",
            });
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(topic, null, 2),
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
export class UpdateTopicTool extends BaseTool {
    constructor() {
        super(...arguments);
        this.name = "update_topic";
        this.description = "Update an existing topic's metadata or status.";
        this.inputSchema = {
            type: "object",
            properties: {
                topic_id: {
                    type: "string",
                    description: "ID of the topic to update",
                },
                name: {
                    type: "string",
                    description: "New name for the topic",
                    maxLength: 100,
                },
                description: {
                    type: "string",
                    description: "New description",
                    maxLength: 500,
                },
                tags: {
                    type: "array",
                    items: { type: "string" },
                    description: "New tags (replaces existing)",
                },
                importance: {
                    type: "number",
                    description: "New importance level (0.0 to 1.0)",
                    minimum: 0,
                    maximum: 1,
                },
                status: {
                    type: "string",
                    enum: ["active", "paused", "completed", "archived"],
                    description: "New status",
                },
            },
            required: ["topic_id"],
        };
    }
    async execute(params) {
        try {
            const updates = {};
            if (params.name !== undefined)
                updates.name = params.name;
            if (params.description !== undefined)
                updates.description = params.description;
            if (params.tags !== undefined)
                updates.tags = params.tags;
            if (params.importance !== undefined)
                updates.importance = params.importance;
            if (params.status !== undefined)
                updates.status = params.status;
            const topic = await updateTopic(params.topic_id, updates);
            if (!topic) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Topic not found: ${params.topic_id}`,
                        },
                    ],
                    isError: true,
                };
            }
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(topic, null, 2),
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
export class ListTopicsTool extends BaseTool {
    constructor() {
        super(...arguments);
        this.name = "list_topics";
        this.description = "List topics with optional filtering. Returns compact summaries, not full memory contents.";
        this.inputSchema = {
            type: "object",
            properties: {
                status_filter: {
                    type: "array",
                    items: {
                        type: "string",
                        enum: ["active", "paused", "completed", "archived"],
                    },
                    description: "Filter by status(es)",
                },
                tag_filter: {
                    type: "array",
                    items: { type: "string" },
                    description: "Filter by tag(s), AND logic",
                },
                name_search: {
                    type: "string",
                    description: "Substring search on name",
                },
                min_importance: {
                    type: "number",
                    description: "Minimum importance threshold",
                },
                include_memory_counts: {
                    type: "boolean",
                    description: "Include count of memories per topic",
                    default: true,
                },
                include_todo_counts: {
                    type: "boolean",
                    description: "Include count of open todos per topic",
                    default: true,
                },
                limit: {
                    type: "number",
                    description: "Maximum number of topics to return",
                    default: 20,
                    maximum: 50,
                },
            },
        };
    }
    async execute(params) {
        try {
            const topics = await listTopics({
                status_filter: params.status_filter,
                tag_filter: params.tag_filter,
                name_search: params.name_search,
                min_importance: params.min_importance,
                limit: params.limit ?? 20,
            });
            const includeMemoryCounts = params.include_memory_counts ?? true;
            const includeTodoCounts = params.include_todo_counts ?? true;
            const summaries = await Promise.all(topics.map(async (t) => {
                const summary = {
                    id: t.id,
                    name: t.name,
                    status: t.status,
                    importance: t.importance,
                    last_referenced_at: t.last_referenced_at,
                };
                if (includeMemoryCounts) {
                    summary.memory_count = await countMemoriesByTopic(t.id);
                }
                if (includeTodoCounts) {
                    summary.open_todo_count = await countOpenTodosByTopic(t.id);
                }
                return summary;
            }));
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(summaries, null, 2),
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
export class GetTopicTool extends BaseTool {
    constructor() {
        super(...arguments);
        this.name = "get_topic";
        this.description = "Get full details for a single topic, including recent memories and open todos.";
        this.inputSchema = {
            type: "object",
            properties: {
                topic_id: {
                    type: "string",
                    description: "ID of the topic to retrieve",
                },
                include_memories: {
                    type: "boolean",
                    description: "Include recent memories for this topic",
                    default: true,
                },
                memory_limit: {
                    type: "number",
                    description: "Maximum number of memories to include",
                    default: 10,
                },
                include_todos: {
                    type: "boolean",
                    description: "Include todos for this topic",
                    default: true,
                },
                todo_status_filter: {
                    type: "array",
                    items: {
                        type: "string",
                        enum: ["open", "in_progress", "done", "blocked", "cancelled"],
                    },
                    description: "Filter todos by status",
                    default: ["open", "in_progress", "blocked"],
                },
            },
            required: ["topic_id"],
        };
    }
    async execute(params) {
        try {
            const topic = await getTopicById(params.topic_id);
            if (!topic) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Topic not found: ${params.topic_id}`,
                        },
                    ],
                    isError: true,
                };
            }
            const response = { topic };
            if (params.include_memories ?? true) {
                response.memories = await listMemories({
                    topic_id: params.topic_id,
                    limit: params.memory_limit ?? 10,
                });
            }
            if (params.include_todos ?? true) {
                const statusFilter = (params.todo_status_filter ?? ["open", "in_progress", "blocked"]);
                response.todos = await listTodos({
                    topic_id: params.topic_id,
                    status_filter: statusFilter,
                });
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
export class DeleteTopicTool extends BaseTool {
    constructor() {
        super(...arguments);
        this.name = "delete_topic";
        this.description = "Delete a topic. Optionally reassign or delete associated memories and todos.";
        this.inputSchema = {
            type: "object",
            properties: {
                topic_id: {
                    type: "string",
                    description: "ID of the topic to delete",
                },
                memory_action: {
                    type: "string",
                    enum: ["orphan", "delete"],
                    description: "What to do with associated memories",
                    default: "orphan",
                },
                todo_action: {
                    type: "string",
                    enum: ["orphan", "delete"],
                    description: "What to do with associated todos",
                    default: "orphan",
                },
            },
            required: ["topic_id"],
        };
    }
    async execute(params) {
        try {
            const topic = await getTopicById(params.topic_id);
            if (!topic) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Topic not found: ${params.topic_id}`,
                        },
                    ],
                    isError: true,
                };
            }
            const memoryAction = params.memory_action ?? "orphan";
            const todoAction = params.todo_action ?? "orphan";
            // Get associated items
            const memories = await listMemories({ topic_id: params.topic_id, limit: 1000 });
            const todos = await listTodos({ topic_id: params.topic_id, limit: 1000 });
            let orphanedMemories = 0;
            let orphanedTodos = 0;
            // Handle memories
            const { updateMemory, deleteMemory } = await import("../../schema/memorySchema.js");
            for (const memory of memories) {
                if (memoryAction === "delete") {
                    await deleteMemory(memory.id);
                }
                else {
                    await updateMemory(memory.id, { topic_id: null });
                    orphanedMemories++;
                }
            }
            // Handle todos
            const { updateTodo, deleteTodo } = await import("../../schema/memorySchema.js");
            for (const todo of todos) {
                if (todoAction === "delete") {
                    await deleteTodo(todo.id);
                }
                else {
                    await updateTodo(todo.id, { topic_id: null });
                    orphanedTodos++;
                }
            }
            // Delete the topic
            await deleteTopic(params.topic_id);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            deleted: true,
                            orphaned_memories: orphanedMemories,
                            orphaned_todos: orphanedTodos,
                        }, null, 2),
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
