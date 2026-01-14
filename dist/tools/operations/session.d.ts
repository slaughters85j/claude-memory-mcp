/**
 * Session Tools
 *
 * get_session_context: Quick status check at conversation start.
 * Surfaces unfinished work and recent activity without Claude having to ask multiple questions.
 */
import { BaseTool, ToolParams, ToolResponse } from "../base/tool.js";
interface GetSessionContextParams extends ToolParams {
    include_overdue?: boolean;
    include_high_priority?: boolean;
    recent_days?: number;
    active_topics_only?: boolean;
}
export declare class GetSessionContextTool extends BaseTool<GetSessionContextParams> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            include_overdue: {
                type: string;
                description: string;
                default: boolean;
            };
            include_high_priority: {
                type: string;
                description: string;
                default: boolean;
            };
            recent_days: {
                type: string;
                description: string;
                default: number;
            };
            active_topics_only: {
                type: string;
                description: string;
                default: boolean;
            };
        };
    };
    execute(params: GetSessionContextParams): Promise<ToolResponse>;
}
export {};
