/**
 * Null Embedding Provider
 *
 * Used when embeddings are disabled or no provider is available.
 * CRUD operations still work, but semantic search is unavailable.
 */
export class NullEmbeddingProvider {
    constructor() {
        this.name = "none";
        this.dimensions = 0;
    }
    async embed(texts) {
        throw new Error("No embedding provider configured. Semantic search unavailable. " +
            "CRUD operations work, but search_memories will use text-based fallback.");
    }
    async embedSingle(text) {
        throw new Error("No embedding provider configured. Semantic search unavailable. " +
            "CRUD operations work, but search_memories will use text-based fallback.");
    }
    isAvailable() {
        return false;
    }
}
