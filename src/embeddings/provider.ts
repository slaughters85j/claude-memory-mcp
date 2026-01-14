/**
 * Embedding Provider Interface
 *
 * Abstracts embedding generation to support multiple backends:
 * - Local ONNX (default, preferred for low latency)
 * - OpenAI API (fallback)
 * - Null provider (graceful degradation when embeddings unavailable)
 */

export interface EmbeddingProvider {
  /** Human-readable name of the provider/model */
  readonly name: string;

  /** Dimensionality of the embedding vectors */
  readonly dimensions: number;

  /** Generate embeddings for multiple texts */
  embed(texts: string[]): Promise<number[][]>;

  /** Generate embedding for a single text */
  embedSingle(text: string): Promise<number[]>;

  /** Check if the provider is available and ready */
  isAvailable(): boolean;

  /** Initialize the provider (lazy loading for ONNX) */
  initialize?(): Promise<void>;
}
