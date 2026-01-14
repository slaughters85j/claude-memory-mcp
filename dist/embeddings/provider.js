/**
 * Embedding Provider Interface
 *
 * Abstracts embedding generation to support multiple backends:
 * - Local ONNX (default, preferred for low latency)
 * - OpenAI API (fallback)
 * - Null provider (graceful degradation when embeddings unavailable)
 */
export {};
