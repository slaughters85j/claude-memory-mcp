import { catalogVectorStore } from "../../lancedb/client.js";
import { BaseTool, ToolParams } from "../base/tool.js";

export interface CatalogSearchParams extends ToolParams {
  text: string;
}

export class CatalogSearchTool extends BaseTool<CatalogSearchParams> {
  name = "catalog_search";
  description = "Search for relevant documents in the catalog. Requires RAG seeding (npm run seed).";
  inputSchema = {
    type: "object" as const,
    properties: {
      text: {
        type: "string",
        description: "Search string",
        default: {},
      },
    },
    required: ["text"],
  };

  async execute(params: CatalogSearchParams) {
    try {
      if (!catalogVectorStore) {
        return {
          content: [
            { type: "text" as const, text: "Catalog search is not available. Run 'npm run seed' to index documents first." },
          ],
          isError: true,
        };
      }

      const retriever = catalogVectorStore.asRetriever({});
      const results = await retriever.invoke(params.text);

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(results, null, 2) },
        ],
        isError: false,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }
}
