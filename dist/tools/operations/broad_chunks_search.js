import { chunksVectorStore } from "../../lancedb/client.js";
import { BaseTool } from "../base/tool.js";
export class BroadSearchTool extends BaseTool {
    constructor() {
        super(...arguments);
        this.name = "all_chunks_search";
        this.description = "Search for relevant document chunks in the vector store across all documents. Use with caution as it can return information from irrelevant sources. Requires RAG seeding (npm run seed).";
        this.inputSchema = {
            type: "object",
            properties: {
                text: {
                    type: "string",
                    description: "Search string",
                    default: {},
                }
            },
            required: ["text"],
        };
    }
    async execute(params) {
        try {
            if (!chunksVectorStore) {
                return {
                    content: [
                        { type: "text", text: "All chunks search is not available. Run 'npm run seed' to index documents first." },
                    ],
                    isError: true,
                };
            }
            const retriever = chunksVectorStore.asRetriever();
            const results = await retriever.invoke(params.text);
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
