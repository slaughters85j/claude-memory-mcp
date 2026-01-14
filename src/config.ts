// RAG/Document processing configuration (existing)
export const EMBEDDING_MODEL = "snowflake-arctic-embed2";
export const CATALOG_TABLE_NAME = "catalog";
export const CHUNKS_TABLE_NAME = "chunks";
export const SUMMARIZATION_MODEL = "llama3.1:8b";

// Memory system configuration
export const TOPICS_TABLE_NAME = "topics";
export const MEMORIES_TABLE_NAME = "memories";
export const TODOS_TABLE_NAME = "todos";

// Embedding provider configuration (via environment variables)
// DISABLE_EMBEDDINGS=true - Disable embeddings, CRUD only
// PREFER_OPENAI_EMBEDDINGS=true + OPENAI_API_KEY - Use OpenAI instead of ONNX
// Default: ONNX local (all-MiniLM-L6-v2, 384 dimensions)

// Default vector dimensions for memory tables
export const DEFAULT_VECTOR_DIMENSIONS = 384;