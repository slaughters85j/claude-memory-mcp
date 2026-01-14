/**
 * Todo Tools
 *
 * Actionable items with status tracking. Link to topics and memories for context.
 */
import { BaseTool } from "../base/tool.js";
import { createTodo, updateTodo, getTodoById, listTodos, deleteTodo, getTopicById, getTopicByName, createTopic, nowISO, PRIORITY_ORDER, } from "../../schema/memorySchema.js";
import { safeEmbed } from "../../embeddings/index.js";
export class AddTodoTool extends BaseTool {
    constructor() {
        super(...arguments);
        this.name = "add_todo";
        this.description = "Create a new todo/action item. Link to topic and/or memory for context.";
        this.inputSchema = {
            type: "object",
            properties: {
                title: {
                    type: "string",
                    description: "Short action item (< 150 chars)",
                    maxLength: 150,
                },
                description: {
                    type: "string",
                    description: "Additional detail if needed",
                    maxLength: 1000,
                },
                topic_id: {
                    type: "string",
                    description: "Associate with existing topic by ID",
                },
                topic_name: {
                    type: "string",
                    description: "Create new topic if topic_id not provided",
                },
                memory_id: {
                    type: "string",
                    description: "Link to memory that explains why this todo exists",
                },
                priority: {
                    type: "string",
                    enum: ["low", "medium", "high", "urgent"],
                    description: "Priority level",
                    default: "medium",
                },
                due_at: {
                    type: "string",
                    description: "ISO date for deadline",
                },
                tags: {
                    type: "array",
                    items: { type: "string" },
                    description: "Tags for categorization",
                },
            },
            required: ["title"],
        };
    }
    async execute(params) {
        try {
            let topicId = params.topic_id ?? null;
            // Create topic on-the-fly if topic_name provided without topic_id
            if (!topicId && params.topic_name) {
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
            // Generate embedding for semantic search (optional)
            const textForEmbedding = params.description
                ? `${params.title}. ${params.description}`
                : params.title;
            const vector = await safeEmbed(textForEmbedding);
            const todo = await createTodo({
                topic_id: topicId,
                memory_id: params.memory_id ?? null,
                title: params.title,
                description: params.description ?? null,
                status: "open",
                priority: params.priority ?? "medium",
                due_at: params.due_at ?? null,
                tags: params.tags ?? [],
                vector,
            });
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(todo, null, 2),
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
export class UpdateTodoTool extends BaseTool {
    constructor() {
        super(...arguments);
        this.name = "update_todo";
        this.description = "Update a todo's details or status.";
        this.inputSchema = {
            type: "object",
            properties: {
                todo_id: {
                    type: "string",
                    description: "ID of the todo to update",
                },
                title: {
                    type: "string",
                    description: "New title",
                    maxLength: 150,
                },
                description: {
                    type: "string",
                    description: "New description",
                    maxLength: 1000,
                },
                status: {
                    type: "string",
                    enum: ["open", "in_progress", "done", "blocked", "cancelled"],
                    description: "New status",
                },
                priority: {
                    type: "string",
                    enum: ["low", "medium", "high", "urgent"],
                    description: "New priority",
                },
                due_at: {
                    type: ["string", "null"],
                    description: "New due date (ISO), null to remove deadline",
                },
                topic_id: {
                    type: "string",
                    description: "Reassign to different topic",
                },
                memory_id: {
                    type: "string",
                    description: "Link to different memory",
                },
                tags: {
                    type: "array",
                    items: { type: "string" },
                    description: "New tags (replaces existing)",
                },
            },
            required: ["todo_id"],
        };
    }
    async execute(params) {
        try {
            const existing = await getTodoById(params.todo_id);
            if (!existing) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Todo not found: ${params.todo_id}`,
                        },
                    ],
                    isError: true,
                };
            }
            const updates = {};
            if (params.title !== undefined)
                updates.title = params.title;
            if (params.description !== undefined)
                updates.description = params.description;
            if (params.status !== undefined)
                updates.status = params.status;
            if (params.priority !== undefined)
                updates.priority = params.priority;
            if (params.due_at !== undefined)
                updates.due_at = params.due_at;
            if (params.topic_id !== undefined)
                updates.topic_id = params.topic_id;
            if (params.memory_id !== undefined)
                updates.memory_id = params.memory_id;
            if (params.tags !== undefined)
                updates.tags = params.tags;
            // Recompute embedding if title or description changed
            if (params.title !== undefined || params.description !== undefined) {
                const newTitle = params.title ?? existing.title;
                const newDescription = params.description ?? existing.description;
                const textForEmbedding = newDescription
                    ? `${newTitle}. ${newDescription}`
                    : newTitle;
                updates.vector = await safeEmbed(textForEmbedding);
            }
            const todo = await updateTodo(params.todo_id, updates);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(todo, null, 2),
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
export class ListTodosTool extends BaseTool {
    constructor() {
        super(...arguments);
        this.name = "list_todos";
        this.description = "List todos with filtering. Default returns open items sorted by priority.";
        this.inputSchema = {
            type: "object",
            properties: {
                topic_id: {
                    type: "string",
                    description: "Filter by topic",
                },
                status_filter: {
                    type: "array",
                    items: {
                        type: "string",
                        enum: ["open", "in_progress", "done", "blocked", "cancelled"],
                    },
                    description: "Filter by status(es)",
                    default: ["open", "in_progress", "blocked"],
                },
                priority_filter: {
                    type: "array",
                    items: {
                        type: "string",
                        enum: ["low", "medium", "high", "urgent"],
                    },
                    description: "Filter by priority(ies)",
                },
                tag_filter: {
                    type: "array",
                    items: { type: "string" },
                    description: "Filter by tag(s), AND logic",
                },
                overdue_only: {
                    type: "boolean",
                    description: "Only show overdue todos",
                    default: false,
                },
                include_description: {
                    type: "boolean",
                    description: "Include description in results",
                    default: false,
                },
                sort_by: {
                    type: "string",
                    enum: ["priority", "due_at", "created_at", "updated_at"],
                    description: "Sort field",
                    default: "priority",
                },
                limit: {
                    type: "number",
                    description: "Maximum results to return",
                    default: 20,
                    maximum: 50,
                },
            },
        };
    }
    async execute(params) {
        try {
            const statusFilter = params.status_filter ?? ["open", "in_progress", "blocked"];
            let todos = await listTodos({
                topic_id: params.topic_id,
                status_filter: statusFilter,
                priority_filter: params.priority_filter,
                tag_filter: params.tag_filter,
                overdue_only: params.overdue_only ?? false,
                limit: params.limit ?? 20,
            });
            // Sort
            const sortBy = params.sort_by ?? "priority";
            todos.sort((a, b) => {
                switch (sortBy) {
                    case "priority":
                        return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
                    case "due_at":
                        if (!a.due_at && !b.due_at)
                            return 0;
                        if (!a.due_at)
                            return 1;
                        if (!b.due_at)
                            return -1;
                        return a.due_at.localeCompare(b.due_at);
                    case "created_at":
                        return b.created_at.localeCompare(a.created_at);
                    case "updated_at":
                        return b.updated_at.localeCompare(a.updated_at);
                    default:
                        return 0;
                }
            });
            // Build summaries
            const now = nowISO();
            const includeDescription = params.include_description ?? false;
            const summaries = await Promise.all(todos.map(async (t) => {
                const topic = t.topic_id ? await getTopicById(t.topic_id) : null;
                const isOverdue = t.due_at !== null &&
                    t.due_at < now &&
                    (t.status === "open" || t.status === "in_progress" || t.status === "blocked");
                const summary = {
                    id: t.id,
                    title: t.title,
                    status: t.status,
                    priority: t.priority,
                    due_at: t.due_at,
                    topic_name: topic?.name ?? null,
                    is_overdue: isOverdue,
                    created_at: t.created_at,
                };
                if (includeDescription && t.description) {
                    summary.description = t.description;
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
export class DeleteTodoTool extends BaseTool {
    constructor() {
        super(...arguments);
        this.name = "delete_todo";
        this.description = "Delete a todo. Prefer setting status to 'cancelled' for audit trail.";
        this.inputSchema = {
            type: "object",
            properties: {
                todo_id: {
                    type: "string",
                    description: "ID of the todo to delete",
                },
            },
            required: ["todo_id"],
        };
    }
    async execute(params) {
        try {
            const existing = await getTodoById(params.todo_id);
            if (!existing) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Todo not found: ${params.todo_id}`,
                        },
                    ],
                    isError: true,
                };
            }
            await deleteTodo(params.todo_id);
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
