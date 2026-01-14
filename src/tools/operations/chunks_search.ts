import { chunksVectorStore } from "../../lancedb/client.js";
import { BaseTool, ToolParams } from "../base/tool.js";

export interface ChunksSearchParams extends ToolParams {
  text: string;
  source?: string;
}

export class ChunksSearchTool extends BaseTool<ChunksSearchParams> {
  name = "chunks_search";
  description = "Search for relevant document chunks in the vector store based on a source document from the catalog. Requires RAG seeding (npm run seed).";
  inputSchema = {
    type: "object" as const,
    properties: {
      text: {
        type: "string",
        description: "Search string",
        default: {},
      },
      source: {
        type: "string",
        description: "Source document to filter the search",
        default: {},
      },
    },
    required: ["text", "source"],
  };

  async execute(params: ChunksSearchParams) {
    try {
      if (!chunksVectorStore) {
        return {
          content: [
            { type: "text" as const, text: "Chunks search is not available. Run 'npm run seed' to index documents first." },
          ],
          isError: true,
        };
      }

      const retriever = chunksVectorStore.asRetriever();
      const results = await retriever.invoke(params.text);

      // Filter results by source if provided
      // TODO: this needs to be pushed down to LanceDB
      if (params.source) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                results.filter((result: any) => result.metadata.source === params.source),
                null,
                2
              ),
            },
          ],
          isError: false,
        };
      }

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
