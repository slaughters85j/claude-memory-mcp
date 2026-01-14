import { BaseTool, ToolParams } from "../base/tool.js";
export interface BroadSearchParams extends ToolParams {
    text: string;
}
export declare class BroadSearchTool extends BaseTool<BroadSearchParams> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            text: {
                type: string;
                description: string;
                default: {};
            };
        };
        required: string[];
    };
    execute(params: BroadSearchParams): Promise<import("../base/tool.js").ToolResponse>;
}
