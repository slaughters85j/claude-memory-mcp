/**
 * Maintenance Tools
 *
 * prune_stale_data: Clean up old, low-importance data
 * export_topic: Export topic data for archiving or sharing
 */
import { BaseTool, ToolParams, ToolResponse } from "../base/tool.js";
interface PruneStaleDataParams extends ToolParams {
    dry_run?: boolean;
    memory_max_age_days?: number;
    completed_todo_max_age_days?: number;
    min_importance_threshold?: number;
}
export declare class PruneStaleDataTool extends BaseTool<PruneStaleDataParams> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            dry_run: {
                type: string;
                description: string;
                default: boolean;
            };
            memory_max_age_days: {
                type: string;
                description: string;
                default: number;
            };
            completed_todo_max_age_days: {
                type: string;
                description: string;
                default: number;
            };
            min_importance_threshold: {
                type: string;
                description: string;
                default: number;
            };
        };
    };
    execute(params: PruneStaleDataParams): Promise<ToolResponse>;
}
interface ExportTopicParams extends ToolParams {
    topic_id: string;
    format?: "json" | "markdown";
    include_completed_todos?: boolean;
}
export declare class ExportTopicTool extends BaseTool<ExportTopicParams> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            topic_id: {
                type: string;
                description: string;
            };
            format: {
                type: string;
                enum: string[];
                description: string;
                default: string;
            };
            include_completed_todos: {
                type: string;
                description: string;
                default: boolean;
            };
        };
        required: string[];
    };
    execute(params: ExportTopicParams): Promise<ToolResponse>;
}
export {};
