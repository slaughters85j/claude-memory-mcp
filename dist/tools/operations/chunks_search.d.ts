import { BaseTool, ToolParams } from "../base/tool.js";
export interface ChunksSearchParams extends ToolParams {
    text: string;
    source?: string;
}
export declare class ChunksSearchTool extends BaseTool<ChunksSearchParams> {
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
            source: {
                type: string;
                description: string;
                default: {};
            };
        };
        required: string[];
    };
    execute(params: ChunksSearchParams): Promise<import("../base/tool.js").ToolResponse>;
}
