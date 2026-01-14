/**
 * OpenAI Embedding Provider
 *
 * Uses OpenAI's text-embedding-3-small model via API.
 * Requires OPENAI_API_KEY environment variable.
 *
 * Use as fallback when ONNX is unavailable or when you
 * prefer OpenAI embeddings (set PREFER_OPENAI_EMBEDDINGS=true).
 */
import { EmbeddingProvider } from "./provider.js";
export declare class OpenAIEmbeddingProvider implements EmbeddingProvider {
    readonly name = "text-embedding-3-small";
    readonly dimensions = 1536;
    private apiKey;
    constructor(apiKey: string);
    embed(texts: string[]): Promise<number[][]>;
    embedSingle(text: string): Promise<number[]>;
    isAvailable(): boolean;
}
