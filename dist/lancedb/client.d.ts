import * as lancedb from "@lancedb/lancedb";
import { LanceDB } from "@langchain/community/vectorstores/lancedb";
export declare let client: lancedb.Connection;
export declare let chunksTable: lancedb.Table | null;
export declare let chunksVectorStore: LanceDB | null;
export declare let catalogTable: lancedb.Table | null;
export declare let catalogVectorStore: LanceDB | null;
export declare function connectToLanceDB(databaseUrl: string, chunksTableName: string, catalogTableName: string): Promise<void>;
export declare function closeLanceDB(): Promise<void>;
