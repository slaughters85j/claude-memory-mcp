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
export declare class OnnxEmbeddingProvider implements EmbeddingProvider {
    readonly name = "all-MiniLM-L6-v2";
    readonly dimensions = 384;
    private extractor;
    private initialized;
    private initPromise;
    initialize(): Promise<void>;
    private _doInitialize;
    embed(texts: string[]): Promise<number[][]>;
    embedSingle(text: string): Promise<number[]>;
    isAvailable(): boolean;
}
