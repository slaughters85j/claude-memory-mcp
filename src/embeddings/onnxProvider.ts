/**
 * ONNX Embedding Provider
 *
 * Uses @xenova/transformers to run embedding models locally.
 * Default model: all-MiniLM-L6-v2 (384 dimensions)
 *
 * Benefits:
 * - Zero latency from API round-trips
 * - No cost
 * - Works offline
 * - No API key management
 */

import { EmbeddingProvider } from "./provider.js";

export class OnnxEmbeddingProvider implements EmbeddingProvider {
  readonly name = "all-MiniLM-L6-v2";
  readonly dimensions = 384;

  private extractor: any = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize();
    await this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    try {
      console.error("Loading ONNX embedding model (first time may download ~80MB)...");

      // Dynamic import to allow graceful fallback if not installed
      const { pipeline } = await import("@xenova/transformers");

      // Use feature-extraction pipeline with the MiniLM model
      this.extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
        quantized: true, // Use quantized model for faster inference
      });

      this.initialized = true;
      console.error("ONNX embedding model loaded successfully");
    } catch (error) {
      console.error("Failed to initialize ONNX embedding provider:", error);
      throw error;
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const embeddings: number[][] = [];

    for (const text of texts) {
      // Run through the model
      const output = await this.extractor(text, {
        pooling: "mean",
        normalize: true,
      });

      // Convert to regular array
      const embedding = Array.from(output.data as Float32Array);
      embeddings.push(embedding);
    }

    return embeddings;
  }

  async embedSingle(text: string): Promise<number[]> {
    const results = await this.embed([text]);
    return results[0];
  }

  isAvailable(): boolean {
    return true; // Always available once dependency is installed
  }
}
