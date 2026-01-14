import { BaseTool } from "./base/tool.js";
import { BroadSearchTool } from "./operations/broad_chunks_search.js";
import { CatalogSearchTool } from "./operations/catalog_search.js";
import { ChunksSearchTool } from "./operations/chunks_search.js";
import { McpError, ErrorCode, Tool } from "@modelcontextprotocol/sdk/types.js";

// Memory system tools
import { GetSessionContextTool } from "./operations/session.js";
import {
  CreateTopicTool,
  UpdateTopicTool,
  ListTopicsTool,
  GetTopicTool,
  DeleteTopicTool,
} from "./operations/topics.js";
import {
  AddMemoryTool,
  UpdateMemoryTool,
  SearchMemoriesTool,
  GetMemoryTool,
  GetMemoryTimelineTool,
  DeleteMemoryTool,
} from "./operations/memories.js";
import {
  AddTodoTool,
  UpdateTodoTool,
  ListTodosTool,
  DeleteTodoTool,
} from "./operations/todos.js";
import {
  PruneStaleDataTool,
  ExportTopicTool,
} from "./operations/maintenance.js";

export class ToolRegistry {
  private tools: Map<string, BaseTool<any>> = new Map();

  constructor() {
    // Existing RAG tools
    this.registerTool(new ChunksSearchTool());
    this.registerTool(new CatalogSearchTool());
    this.registerTool(new BroadSearchTool());

    // Session tools
    this.registerTool(new GetSessionContextTool());

    // Topic tools
    this.registerTool(new CreateTopicTool());
    this.registerTool(new UpdateTopicTool());
    this.registerTool(new ListTopicsTool());
    this.registerTool(new GetTopicTool());
    this.registerTool(new DeleteTopicTool());

    // Memory tools
    this.registerTool(new AddMemoryTool());
    this.registerTool(new UpdateMemoryTool());
    this.registerTool(new SearchMemoriesTool());
    this.registerTool(new GetMemoryTool());
    this.registerTool(new GetMemoryTimelineTool());
    this.registerTool(new DeleteMemoryTool());

    // Todo tools
    this.registerTool(new AddTodoTool());
    this.registerTool(new UpdateTodoTool());
    this.registerTool(new ListTodosTool());
    this.registerTool(new DeleteTodoTool());

    // Maintenance tools
    this.registerTool(new PruneStaleDataTool());
    this.registerTool(new ExportTopicTool());
  }

  registerTool(tool: BaseTool<any>) {
    this.tools.set(tool.name, tool);
  }

  getTool(name: string): BaseTool<any> | undefined {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return tool;
  }

  getAllTools(): BaseTool<any>[] {
    return Array.from(this.tools.values());
  }

  getToolSchemas(): Tool[] {
    return this.getAllTools().map((tool) => {
      const inputSchema = tool.inputSchema as any;
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: {
          type: "object",
          properties: inputSchema.properties || {},
          ...(inputSchema.required && { required: inputSchema.required }),
        },
      };
    });
  }
}
