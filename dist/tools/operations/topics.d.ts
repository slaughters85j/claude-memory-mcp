/**
 * Topic Tools
 *
 * Topics are conceptual buckets for organizing memories.
 * Projects, themes, domains - anything that groups related memories together.
 */
import { BaseTool, ToolParams, ToolResponse } from "../base/tool.js";
import { TopicStatus } from "../../schema/memorySchema.js";
interface CreateTopicParams extends ToolParams {
    name: string;
    description?: string;
    tags?: string[];
    importance?: number;
    status?: "active" | "paused";
}
export declare class CreateTopicTool extends BaseTool<CreateTopicParams> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            name: {
                type: string;
                description: string;
                maxLength: number;
            };
            description: {
                type: string;
                description: string;
                maxLength: number;
            };
            tags: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            importance: {
                type: string;
                description: string;
                minimum: number;
                maximum: number;
                default: number;
            };
            status: {
                type: string;
                enum: string[];
                description: string;
                default: string;
            };
        };
        required: string[];
    };
    execute(params: CreateTopicParams): Promise<ToolResponse>;
}
interface UpdateTopicParams extends ToolParams {
    topic_id: string;
    name?: string;
    description?: string;
    tags?: string[];
    importance?: number;
    status?: TopicStatus;
}
export declare class UpdateTopicTool extends BaseTool<UpdateTopicParams> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            topic_id: {
                type: string;
                description: string;
            };
            name: {
                type: string;
                description: string;
                maxLength: number;
            };
            description: {
                type: string;
                description: string;
                maxLength: number;
            };
            tags: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            importance: {
                type: string;
                description: string;
                minimum: number;
                maximum: number;
            };
            status: {
                type: string;
                enum: string[];
                description: string;
            };
        };
        required: string[];
    };
    execute(params: UpdateTopicParams): Promise<ToolResponse>;
}
interface ListTopicsParams extends ToolParams {
    status_filter?: TopicStatus[];
    tag_filter?: string[];
    name_search?: string;
    min_importance?: number;
    include_memory_counts?: boolean;
    include_todo_counts?: boolean;
    limit?: number;
}
export declare class ListTopicsTool extends BaseTool<ListTopicsParams> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            status_filter: {
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
            name_search: {
                type: string;
                description: string;
            };
            min_importance: {
                type: string;
                description: string;
            };
            include_memory_counts: {
                type: string;
                description: string;
                default: boolean;
            };
            include_todo_counts: {
                type: string;
                description: string;
                default: boolean;
            };
            limit: {
                type: string;
                description: string;
                default: number;
                maximum: number;
            };
        };
    };
    execute(params: ListTopicsParams): Promise<ToolResponse>;
}
interface GetTopicParams extends ToolParams {
    topic_id: string;
    include_memories?: boolean;
    memory_limit?: number;
    include_todos?: boolean;
    todo_status_filter?: string[];
}
export declare class GetTopicTool extends BaseTool<GetTopicParams> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            topic_id: {
                type: string;
                description: string;
            };
            include_memories: {
                type: string;
                description: string;
                default: boolean;
            };
            memory_limit: {
                type: string;
                description: string;
                default: number;
            };
            include_todos: {
                type: string;
                description: string;
                default: boolean;
            };
            todo_status_filter: {
                type: string;
                items: {
                    type: string;
                    enum: string[];
                };
                description: string;
                default: string[];
            };
        };
        required: string[];
    };
    execute(params: GetTopicParams): Promise<ToolResponse>;
}
interface DeleteTopicParams extends ToolParams {
    topic_id: string;
    memory_action?: "orphan" | "delete";
    todo_action?: "orphan" | "delete";
}
export declare class DeleteTopicTool extends BaseTool<DeleteTopicParams> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            topic_id: {
                type: string;
                description: string;
            };
            memory_action: {
                type: string;
                enum: string[];
                description: string;
                default: string;
            };
            todo_action: {
                type: string;
                enum: string[];
                description: string;
                default: string;
            };
        };
        required: string[];
    };
    execute(params: DeleteTopicParams): Promise<ToolResponse>;
}
export {};
