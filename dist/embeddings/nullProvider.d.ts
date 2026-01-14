/**
 * Null Embedding Provider
 *
 * Used when embeddings are disabled or no provider is available.
 * CRUD operations still work, but semantic search is unavailable.
 */
import { EmbeddingProvider } from "./provider.js";
export declare class NullEmbeddingProvider implements EmbeddingProvider {
    readonly name = "none";
    readonly dimensions = 0;
    embed(texts: string[]): Promise<number[][]>;
    embedSingle(text: string): Promise<number[]>;
    isAvailable(): boolean;
}
