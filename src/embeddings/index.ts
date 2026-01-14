/**
 * Embedding Provider Factory
 *
 * Priority:
 * 1. ONNX local (default, no config needed)
 * 2. OpenAI if OPENAI_API_KEY is set and PREFER_OPENAI_EMBEDDINGS=true
 * 3. Null provider if DISABLE_EMBEDDINGS=true
 */

import { EmbeddingProvider } from "./provider.js";
import { OnnxEmbeddingProvider } from "./onnxProvider.js";
import { OpenAIEmbeddingProvider } from "./openaiProvider.js";
import { NullEmbeddingProvider } from "./nullProvider.js";

export { EmbeddingProvider } from "./provider.js";
export { OnnxEmbeddingProvider } from "./onnxProvider.js";
export { OpenAIEmbeddingProvider } from "./openaiProvider.js";
export { NullEmbeddingProvider } from "./nullProvider.js";

// Singleton instance
let embeddingProvider: EmbeddingProvider | null = null;

export function createEmbeddingProvider(): EmbeddingProvider {
  if (embeddingProvider) {
    return embeddingProvider;
  }

  const disableEmbeddings = process.env.DISABLE_EMBEDDINGS === "true";
  if (disableEmbeddings) {
    console.error("Embeddings disabled via DISABLE_EMBEDDINGS=true");
    embeddingProvider = new NullEmbeddingProvider();
    return embeddingProvider;
  }

  const preferOpenAI = process.env.PREFER_OPENAI_EMBEDDINGS === "true";
  const openaiKey = process.env.OPENAI_API_KEY;

  if (preferOpenAI && openaiKey) {
    console.error("Using OpenAI embedding provider (PREFER_OPENAI_EMBEDDINGS=true)");
    embeddingProvider = new OpenAIEmbeddingProvider(openaiKey);
    return embeddingProvider;
  }

  // Default to ONNX
  console.error("Using ONNX local embedding provider (all-MiniLM-L6-v2)");
  embeddingProvider = new OnnxEmbeddingProvider();
  return embeddingProvider;
}

export function getEmbeddingProvider(): EmbeddingProvider {
  if (!embeddingProvider) {
    embeddingProvider = createEmbeddingProvider();
  }
  return embeddingProvider;
}

/**
 * Get the vector dimensions for the current provider.
 * Returns a default dimension (384) if provider not yet initialized.
 */
export function getVectorDimensions(): number {
  const provider = getEmbeddingProvider();
  // If using null provider, use 384 as default for schema compatibility
  return provider.dimensions || 384;
}

/**
 * Safely generate an embedding, returning null if provider unavailable.
 */
export async function safeEmbed(text: string): Promise<number[] | null> {
  const provider = getEmbeddingProvider();

  if (!provider.isAvailable()) {
    return null;
  }

  try {
    // Initialize if needed (for ONNX lazy loading)
    if (provider.initialize) {
      await provider.initialize();
    }
    return await provider.embedSingle(text);
  } catch (error) {
    console.error("Embedding generation failed:", error);
    return null;
  }
}

/**
 * Safely generate embeddings for multiple texts.
 */
export async function safeEmbedBatch(texts: string[]): Promise<Array<number[] | null>> {
  const provider = getEmbeddingProvider();

  if (!provider.isAvailable()) {
    return texts.map(() => null);
  }

  try {
    if (provider.initialize) {
      await provider.initialize();
    }
    return await provider.embed(texts);
  } catch (error) {
    console.error("Batch embedding generation failed:", error);
    return texts.map(() => null);
  }
}
