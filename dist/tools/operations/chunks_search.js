import { chunksVectorStore } from "../../lancedb/client.js";
import { BaseTool } from "../base/tool.js";
export class ChunksSearchTool extends BaseTool {
    constructor() {
        super(...arguments);
        this.name = "chunks_search";
        this.description = "Search for relevant document chunks in the vector store based on a source document from the catalog. Requires RAG seeding (npm run seed).";
        this.inputSchema = {
            type: "object",
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
    }
    async execute(params) {
        try {
            if (!chunksVectorStore) {
                return {
                    content: [
                        { type: "text", text: "Chunks search is not available. Run 'npm run seed' to index documents first." },
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
                            type: "text",
                            text: JSON.stringify(results.filter((result) => result.metadata.source === params.source), null, 2),
                        },
                    ],
                    isError: false,
                };
            }
            return {
                content: [
                    { type: "text", text: JSON.stringify(results, null, 2) },
                ],
                isError: false,
            };
        }
        catch (error) {
            return this.handleError(error);
        }
    }
}
