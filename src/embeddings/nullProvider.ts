/**
 * Null Embedding Provider
 *
 * Used when embeddings are disabled or no provider is available.
 * CRUD operations still work, but semantic search is unavailable.
 */

import { EmbeddingProvider } from "./provider.js";

export class NullEmbeddingProvider implements EmbeddingProvider {
  readonly name = "none";
  readonly dimensions = 0;

  async embed(texts: string[]): Promise<number[][]> {
    throw new Error(
      "No embedding provider configured. Semantic search unavailable. " +
      "CRUD operations work, but search_memories will use text-based fallback."
    );
  }

  async embedSingle(text: string): Promise<number[]> {
    throw new Error(
      "No embedding provider configured. Semantic search unavailable. " +
      "CRUD operations work, but search_memories will use text-based fallback."
    );
  }

  isAvailable(): boolean {
    return false;
  }
}
