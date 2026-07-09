import * as lancedb from "@lancedb/lancedb";
import { LanceDB } from "@langchain/community/vectorstores/lancedb";
import { OllamaEmbeddings } from "@langchain/ollama";
import * as defaults from '../config.js';
export let client;
export let chunksTable = null;
export let chunksVectorStore = null;
export let catalogTable = null;
export let catalogVectorStore = null;
export async function connectToLanceDB(databaseUrl, chunksTableName, catalogTableName) {
    try {
        console.error(`Connecting to database: ${databaseUrl}`);
        client = await lancedb.connect(databaseUrl);
        // Try to open RAG tables (optional - may not exist if not seeded)
        try {
            chunksTable = await client.openTable(chunksTableName);
            chunksVectorStore = new LanceDB(new OllamaEmbeddings({ model: defaults.EMBEDDING_MODEL }), { table: chunksTable });
            console.error(`Opened RAG table: ${chunksTableName}`);
        }
        catch (error) {
            console.error(`RAG table ${chunksTableName} not found - RAG search disabled. Run 'npm run seed' to enable.`);
        }
        try {
            catalogTable = await client.openTable(catalogTableName);
            catalogVectorStore = new LanceDB(new OllamaEmbeddings({ model: defaults.EMBEDDING_MODEL }), { table: catalogTable });
            console.error(`Opened RAG table: ${catalogTableName}`);
        }
        catch (error) {
            console.error(`RAG table ${catalogTableName} not found - catalog search disabled. Run 'npm run seed' to enable.`);
        }
    }
    catch (error) {
        console.error("LanceDB connection error:", error);
        throw error;
    }
}
export async function closeLanceDB() {
    await client?.close();
}
