/**
 * Memory Tools
 *
 * Memories are atomic knowledge items: decisions, insights, context, notes.
 * Supports semantic search when embeddings are available, falls back to text search.
 */
import { BaseTool, ToolParams, ToolResponse } from "../base/tool.js";
import { MemoryKind } from "../../schema/memorySchema.js";
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
export declare class AddMemoryTool extends BaseTool<AddMemoryParams> {
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
            content: {
                type: string;
                description: string;
                maxLength: number;
            };
            kind: {
                type: string;
                enum: string[];
                description: string;
                default: string;
            };
            topic_id: {
                type: string;
                description: string;
            };
            topic_name: {
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
            importance: {
                type: string;
                description: string;
                minimum: number;
                maximum: number;
                default: number;
            };
            conversation_summary: {
                type: string;
                description: string;
                maxLength: number;
            };
            supersedes_id: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute(params: AddMemoryParams): Promise<ToolResponse>;
}
interface UpdateMemoryParams extends ToolParams {
    memory_id: string;
    title?: string;
    content?: string;
    kind?: MemoryKind;
    topic_id?: string | null;
    tags?: string[];
    importance?: number;
}
export declare class UpdateMemoryTool extends BaseTool<UpdateMemoryParams> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            memory_id: {
                type: string;
                description: string;
            };
            title: {
                type: string;
                description: string;
                maxLength: number;
            };
            content: {
                type: string;
                description: string;
                maxLength: number;
            };
            kind: {
                type: string;
                enum: string[];
                description: string;
            };
            topic_id: {
                type: string[];
                description: string;
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
        };
        required: string[];
    };
    execute(params: UpdateMemoryParams): Promise<ToolResponse>;
}
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
export declare class SearchMemoriesTool extends BaseTool<SearchMemoriesParams> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            query: {
                type: string;
                description: string;
            };
            topic_id: {
                type: string;
                description: string;
            };
            topic_ids: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            kind_filter: {
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
            min_importance: {
                type: string;
                description: string;
            };
            since: {
                type: string;
                description: string;
            };
            include_content: {
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
        required: string[];
    };
    execute(params: SearchMemoriesParams): Promise<ToolResponse>;
}
interface GetMemoryParams extends ToolParams {
    memory_id: string;
    include_linked_todos?: boolean;
    include_supersession_chain?: boolean;
}
export declare class GetMemoryTool extends BaseTool<GetMemoryParams> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            memory_id: {
                type: string;
                description: string;
            };
            include_linked_todos: {
                type: string;
                description: string;
                default: boolean;
            };
            include_supersession_chain: {
                type: string;
                description: string;
                default: boolean;
            };
        };
        required: string[];
    };
    execute(params: GetMemoryParams): Promise<ToolResponse>;
}
interface GetMemoryTimelineParams extends ToolParams {
    topic_id: string;
    kind_filter?: MemoryKind[];
    since?: string;
    until?: string;
    include_content?: boolean;
    limit?: number;
}
export declare class GetMemoryTimelineTool extends BaseTool<GetMemoryTimelineParams> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            topic_id: {
                type: string;
                description: string;
            };
            kind_filter: {
                type: string;
                items: {
                    type: string;
                    enum: string[];
                };
                description: string;
            };
            since: {
                type: string;
                description: string;
            };
            until: {
                type: string;
                description: string;
            };
            include_content: {
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
        required: string[];
    };
    execute(params: GetMemoryTimelineParams): Promise<ToolResponse>;
}
interface DeleteMemoryParams extends ToolParams {
    memory_id: string;
}
export declare class DeleteMemoryTool extends BaseTool<DeleteMemoryParams> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            memory_id: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute(params: DeleteMemoryParams): Promise<ToolResponse>;
}
export {};
