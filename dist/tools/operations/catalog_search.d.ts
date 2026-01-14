import { BaseTool, ToolParams } from "../base/tool.js";
export interface CatalogSearchParams extends ToolParams {
    text: string;
}
export declare class CatalogSearchTool extends BaseTool<CatalogSearchParams> {
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
    execute(params: CatalogSearchParams): Promise<import("../base/tool.js").ToolResponse>;
}
