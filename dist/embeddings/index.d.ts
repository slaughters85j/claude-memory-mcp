/**
 * Embedding Provider Factory
 *
 * Priority:
 * 1. ONNX local (default, no config needed)
 * 2. OpenAI if OPENAI_API_KEY is set and PREFER_OPENAI_EMBEDDINGS=true
 * 3. Null provider if DISABLE_EMBEDDINGS=true
 */
import { EmbeddingProvider } from "./provider.js";
export type { EmbeddingProvider } from "./provider.js";
export { OnnxEmbeddingProvider } from "./onnxProvider.js";
export { OpenAIEmbeddingProvider } from "./openaiProvider.js";
export { NullEmbeddingProvider } from "./nullProvider.js";
export declare function createEmbeddingProvider(): EmbeddingProvider;
export declare function getEmbeddingProvider(): EmbeddingProvider;
/**
 * Get the vector dimensions for the current provider.
 * Returns a default dimension (384) if provider not yet initialized.
 */
export declare function getVectorDimensions(): number;
/**
 * Safely generate an embedding, returning null if provider unavailable.
 */
export declare function safeEmbed(text: string): Promise<number[] | null>;
/**
 * Safely generate embeddings for multiple texts.
 */
export declare function safeEmbedBatch(texts: string[]): Promise<Array<number[] | null>>;
