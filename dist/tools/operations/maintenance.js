/**
 * Maintenance Tools
 *
 * prune_stale_data: Clean up old, low-importance data
 * export_topic: Export topic data for archiving or sharing
 */
import { BaseTool } from "../base/tool.js";
import { listMemories, listTodos, deleteMemory, deleteTodo, getTopicById, nowISO, } from "../../schema/memorySchema.js";
export class PruneStaleDataTool extends BaseTool {
    constructor() {
        super(...arguments);
        this.name = "prune_stale_data";
        this.description = "Clean up old, low-importance data. Dry-run by default to preview what would be removed.";
        this.inputSchema = {
            type: "object",
            properties: {
                dry_run: {
                    type: "boolean",
                    description: "Preview what would be removed without actually deleting",
                    default: true,
                },
                memory_max_age_days: {
                    type: "number",
                    description: "Delete memories older than this with importance < threshold",
                    default: 180,
                },
                completed_todo_max_age_days: {
                    type: "number",
                    description: "Delete completed/cancelled todos older than this",
                    default: 90,
                },
                min_importance_threshold: {
                    type: "number",
                    description: "Memories below this importance are candidates for pruning",
                    default: 0.3,
                },
            },
        };
    }
    async execute(params) {
        try {
            const dryRun = params.dry_run ?? true;
            const memoryMaxAgeDays = params.memory_max_age_days ?? 180;
            const todoMaxAgeDays = params.completed_todo_max_age_days ?? 90;
            const minImportance = params.min_importance_threshold ?? 0.3;
            // Calculate cutoff dates
            const memoryCutoff = new Date();
            memoryCutoff.setDate(memoryCutoff.getDate() - memoryMaxAgeDays);
            const memoryCutoffISO = memoryCutoff.toISOString();
            const todoCutoff = new Date();
            todoCutoff.setDate(todoCutoff.getDate() - todoMaxAgeDays);
            const todoCutoffISO = todoCutoff.toISOString();
            // Find memories to prune (old + low importance)
            const allMemories = await listMemories({ limit: 1000 });
            const memoriesToPrune = allMemories.filter((m) => m.updated_at < memoryCutoffISO &&
                m.importance < minImportance);
            // Find todos to prune (old + completed/cancelled)
            const completedTodos = await listTodos({
                status_filter: ["done", "cancelled"],
                limit: 1000,
            });
            const todosToPrune = completedTodos.filter((t) => t.completed_at && t.completed_at < todoCutoffISO);
            // Execute pruning if not dry run
            if (!dryRun) {
                for (const memory of memoriesToPrune) {
                    await deleteMemory(memory.id);
                }
                for (const todo of todosToPrune) {
                    await deleteTodo(todo.id);
                }
            }
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            memories_to_prune: memoriesToPrune.length,
                            todos_to_prune: todosToPrune.length,
                            pruned: !dryRun,
                            dry_run: dryRun,
                            ...(dryRun && memoriesToPrune.length > 0 && {
                                memory_preview: memoriesToPrune.slice(0, 5).map((m) => ({
                                    id: m.id,
                                    title: m.title,
                                    importance: m.importance,
                                    updated_at: m.updated_at,
                                })),
                            }),
                            ...(dryRun && todosToPrune.length > 0 && {
                                todo_preview: todosToPrune.slice(0, 5).map((t) => ({
                                    id: t.id,
                                    title: t.title,
                                    status: t.status,
                                    completed_at: t.completed_at,
                                })),
                            }),
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
export class ExportTopicTool extends BaseTool {
    constructor() {
        super(...arguments);
        this.name = "export_topic";
        this.description = "Export all memories and todos for a topic as a structured document. Useful for archiving or sharing.";
        this.inputSchema = {
            type: "object",
            properties: {
                topic_id: {
                    type: "string",
                    description: "ID of the topic to export",
                },
                format: {
                    type: "string",
                    enum: ["json", "markdown"],
                    description: "Export format",
                    default: "markdown",
                },
                include_completed_todos: {
                    type: "boolean",
                    description: "Include completed/cancelled todos",
                    default: false,
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
            const format = params.format ?? "markdown";
            const includeCompleted = params.include_completed_todos ?? false;
            // Get memories
            const memories = await listMemories({
                topic_id: params.topic_id,
                limit: 500,
            });
            // Get todos
            const todoStatusFilter = includeCompleted
                ? ["open", "in_progress", "blocked", "done", "cancelled"]
                : ["open", "in_progress", "blocked"];
            const todos = await listTodos({
                topic_id: params.topic_id,
                status_filter: todoStatusFilter,
                limit: 500,
            });
            let content;
            if (format === "json") {
                content = JSON.stringify({
                    topic,
                    memories: memories.map((m) => ({ ...m, vector: undefined })),
                    todos: todos.map((t) => ({ ...t, vector: undefined })),
                    exported_at: nowISO(),
                }, null, 2);
            }
            else {
                // Markdown format
                const lines = [];
                lines.push(`# ${topic.name}`);
                lines.push("");
                lines.push(`**Status:** ${topic.status}`);
                lines.push(`**Importance:** ${topic.importance}`);
                if (topic.description) {
                    lines.push(`**Description:** ${topic.description}`);
                }
                if (topic.tags.length > 0) {
                    lines.push(`**Tags:** ${topic.tags.join(", ")}`);
                }
                lines.push(`**Created:** ${topic.created_at}`);
                lines.push(`**Last Updated:** ${topic.updated_at}`);
                lines.push("");
                if (memories.length > 0) {
                    lines.push("## Memories");
                    lines.push("");
                    // Group by kind
                    const byKind = new Map();
                    for (const m of memories) {
                        const list = byKind.get(m.kind) || [];
                        list.push(m);
                        byKind.set(m.kind, list);
                    }
                    for (const [kind, kindMemories] of byKind) {
                        lines.push(`### ${kind.charAt(0).toUpperCase() + kind.slice(1)}s`);
                        lines.push("");
                        for (const m of kindMemories) {
                            lines.push(`#### ${m.title}`);
                            lines.push("");
                            lines.push(m.content);
                            lines.push("");
                            lines.push(`*Created: ${m.created_at}*`);
                            if (m.conversation_summary) {
                                lines.push(`*Context: ${m.conversation_summary}*`);
                            }
                            lines.push("");
                        }
                    }
                }
                if (todos.length > 0) {
                    lines.push("## Todos");
                    lines.push("");
                    const openTodos = todos.filter((t) => t.status === "open" || t.status === "in_progress" || t.status === "blocked");
                    const closedTodos = todos.filter((t) => t.status === "done" || t.status === "cancelled");
                    if (openTodos.length > 0) {
                        lines.push("### Open");
                        lines.push("");
                        for (const t of openTodos) {
                            const checkbox = t.status === "in_progress" ? "[-]" : "[ ]";
                            const priority = t.priority === "urgent" || t.priority === "high" ? ` **[${t.priority}]**` : "";
                            const due = t.due_at ? ` (due: ${t.due_at.split("T")[0]})` : "";
                            lines.push(`- ${checkbox} ${t.title}${priority}${due}`);
                            if (t.description) {
                                lines.push(`  - ${t.description}`);
                            }
                        }
                        lines.push("");
                    }
                    if (includeCompleted && closedTodos.length > 0) {
                        lines.push("### Completed");
                        lines.push("");
                        for (const t of closedTodos) {
                            const checkbox = t.status === "done" ? "[x]" : "[~]";
                            lines.push(`- ${checkbox} ${t.title}`);
                        }
                        lines.push("");
                    }
                }
                lines.push("---");
                lines.push(`*Exported: ${nowISO()}*`);
                content = lines.join("\n");
            }
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            content,
                            memory_count: memories.length,
                            todo_count: todos.length,
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
