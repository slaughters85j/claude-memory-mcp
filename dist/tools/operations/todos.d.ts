/**
 * Todo Tools
 *
 * Actionable items with status tracking. Link to topics and memories for context.
 */
import { BaseTool, ToolParams, ToolResponse } from "../base/tool.js";
import { TodoStatus, TodoPriority } from "../../schema/memorySchema.js";
interface AddTodoParams extends ToolParams {
    title: string;
    description?: string;
    topic_id?: string;
    topic_name?: string;
    memory_id?: string;
    priority?: TodoPriority;
    due_at?: string;
    tags?: string[];
}
export declare class AddTodoTool extends BaseTool<AddTodoParams> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            title: {
                type: string;
                description: string;
                maxLength: number;
            };
            description: {
                type: string;
                description: string;
                maxLength: number;
            };
            topic_id: {
                type: string;
                description: string;
            };
            topic_name: {
                type: string;
                description: string;
            };
            memory_id: {
                type: string;
                description: string;
            };
            priority: {
                type: string;
                enum: string[];
                description: string;
                default: string;
            };
            due_at: {
                type: string;
                description: string;
            };
            tags: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
        };
        required: string[];
    };
    execute(params: AddTodoParams): Promise<ToolResponse>;
}
interface UpdateTodoParams extends ToolParams {
    todo_id: string;
    title?: string;
    description?: string;
    status?: TodoStatus;
    priority?: TodoPriority;
    due_at?: string | null;
    topic_id?: string;
    memory_id?: string;
    tags?: string[];
}
export declare class UpdateTodoTool extends BaseTool<UpdateTodoParams> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            todo_id: {
                type: string;
                description: string;
            };
            title: {
                type: string;
                description: string;
                maxLength: number;
            };
            description: {
                type: string;
                description: string;
                maxLength: number;
            };
            status: {
                type: string;
                enum: string[];
                description: string;
            };
            priority: {
                type: string;
                enum: string[];
                description: string;
            };
            due_at: {
                type: string[];
                description: string;
            };
            topic_id: {
                type: string;
                description: string;
            };
            memory_id: {
                type: string;
                description: string;
            };
            tags: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
        };
        required: string[];
    };
    execute(params: UpdateTodoParams): Promise<ToolResponse>;
}
interface ListTodosParams extends ToolParams {
    topic_id?: string;
    status_filter?: TodoStatus[];
    priority_filter?: TodoPriority[];
    tag_filter?: string[];
    overdue_only?: boolean;
    include_description?: boolean;
    sort_by?: "priority" | "due_at" | "created_at" | "updated_at";
    limit?: number;
}
export declare class ListTodosTool extends BaseTool<ListTodosParams> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            topic_id: {
                type: string;
                description: string;
            };
            status_filter: {
                type: string;
                items: {
                    type: string;
                    enum: string[];
                };
                description: string;
                default: string[];
            };
            priority_filter: {
                type: string;
                items: {
                    type: string;
                    enum: string[];
                };
                description: string;
            };
            tag_filter: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            overdue_only: {
                type: string;
                description: string;
                default: boolean;
            };
            include_description: {
                type: string;
                description: string;
                default: boolean;
            };
            sort_by: {
                type: string;
                enum: string[];
                description: string;
                default: string;
            };
            limit: {
                type: string;
                description: string;
                default: number;
                maximum: number;
            };
        };
    };
    execute(params: ListTodosParams): Promise<ToolResponse>;
}
interface DeleteTodoParams extends ToolParams {
    todo_id: string;
}
export declare class DeleteTodoTool extends BaseTool<DeleteTodoParams> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            todo_id: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute(params: DeleteTodoParams): Promise<ToolResponse>;
}
export {};
