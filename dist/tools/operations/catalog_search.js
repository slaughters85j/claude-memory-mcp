import { catalogVectorStore } from "../../lancedb/client.js";
import { BaseTool } from "../base/tool.js";
export class CatalogSearchTool extends BaseTool {
    constructor() {
        super(...arguments);
        this.name = "catalog_search";
        this.description = "Search for relevant documents in the catalog. Requires RAG seeding (npm run seed).";
        this.inputSchema = {
            type: "object",
            properties: {
                text: {
                    type: "string",
                    description: "Search string",
                    default: {},
                },
            },
            required: ["text"],
        };
    }
    async execute(params) {
        try {
            if (!catalogVectorStore) {
                return {
                    content: [
                        { type: "text", text: "Catalog search is not available. Run 'npm run seed' to index documents first." },
                    ],
                    isError: true,
                };
            }
            const retriever = catalogVectorStore.asRetriever({});
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
