import { BaseTool } from "./base/tool.js";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
export declare class ToolRegistry {
    private tools;
    constructor();
    registerTool(tool: BaseTool<any>): void;
    getTool(name: string): BaseTool<any> | undefined;
    getAllTools(): BaseTool<any>[];
    getToolSchemas(): Tool[];
}
