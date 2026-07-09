import * as lancedb from "@lancedb/lancedb";
export type TopicStatus = "active" | "paused" | "completed" | "archived";
export interface Topic {
    id: string;
    name: string;
    description: string;
    tags: string[];
    status: TopicStatus;
    importance: number;
    created_at: string;
    updated_at: string;
    last_referenced_at: string;
}
export type MemoryKind = "decision" | "insight" | "context" | "preference" | "outcome" | "blocker" | "reference" | "other";
export interface Memory {
    id: string;
    topic_id: string | null;
    title: string;
    content: string;
    kind: MemoryKind;
    tags: string[];
    importance: number;
    created_at: string;
    updated_at: string;
    conversation_summary: string | null;
    supersedes_id: string | null;
    vector: number[] | null;
}
export type TodoStatus = "open" | "in_progress" | "done" | "blocked" | "cancelled";
export type TodoPriority = "low" | "medium" | "high" | "urgent";
export interface Todo {
    id: string;
    topic_id: string | null;
    memory_id: string | null;
    title: string;
    description: string | null;
    status: TodoStatus;
    priority: TodoPriority;
    due_at: string | null;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
    tags: string[];
    vector: number[] | null;
}
export interface TopicSummary {
    id: string;
    name: string;
    status: TopicStatus;
    importance: number;
    memory_count?: number;
    open_todo_count?: number;
    last_referenced_at: string;
}
export interface MemorySearchResult {
    id: string;
    title: string;
    kind: MemoryKind;
    topic_name: string | null;
    importance: number;
    similarity_score: number;
    updated_at: string;
    tags: string[];
    content?: string;
}
export interface TodoSummary {
    id: string;
    title: string;
    status: TodoStatus;
    priority: TodoPriority;
    due_at: string | null;
    topic_name: string | null;
    is_overdue: boolean;
    created_at: string;
    description?: string;
}
export declare const TOPICS_TABLE_NAME = "topics";
export declare const MEMORIES_TABLE_NAME = "memories";
export declare const TODOS_TABLE_NAME = "todos";
export declare let topicsTable: lancedb.Table | null;
export declare let memoriesTable: lancedb.Table | null;
export declare let todosTable: lancedb.Table | null;
/**
 * Advance every module-level table handle to the latest committed version.
 *
 * A LanceDB `Table` handle pins the manifest version it was opened at. A read
 * never advances it; only a write performed by *that same handle* does (verified
 * empirically against @lancedb/lancedb 0.15 — see scripts/verify-staleness.ts).
 * Claude Desktop runs several claude-memory-mcp processes from one config entry,
 * so each process's handle otherwise serves reads from the version of its own
 * last write and never sees another process's committed rows.
 *
 * `checkoutLatest()` re-reads the newest manifest in place (~0.12ms on the live
 * topics table at 111 manifests, well under 1ms — measured), so after this call
 * the handle sees every other process's commits. Call it exactly once at the top
 * of each MCP tool handler, under the handler mutex (see src/concurrency.ts), so
 * the pinned version holds for the whole handler and no concurrent handler
 * advances it mid-scan — which is what makes scanAll's count-then-read atomic.
 *
 * Tolerates an uninitialized handle by throwing the same "not initialized" error
 * the CRUD helpers throw.
 */
export declare function refreshTables(): Promise<void>;
export declare function generateId(): string;
export declare function nowISO(): string;
/**
 * Escape a value for use as a SQL string literal in a LanceDB filter.
 * DataFusion follows the SQL standard, where an embedded single quote is
 * escaped by doubling it.
 */
export declare function sqlString(value: string): string;
/**
 * Parenthesized, comma-separated list of escaped string literals for an
 * `IN (...)` clause, e.g. `('open', 'in_progress')`. Escapes every value rather
 * than trusting a TypeScript enum to constrain the runtime input it is given.
 */
export declare function sqlStringList(values: readonly string[]): string;
/**
 * A validated numeric SQL literal. A number has no quoting to escape, so instead
 * of interpolating it we reject anything that is not a finite number outright.
 * MCP tool arguments are untyped at runtime, so a caller passing the string
 * "0 OR 1=1" for a numeric filter would otherwise inject arbitrary SQL into a
 * comparison — the escaping guard cannot see an unquoted interpolation.
 */
export declare function sqlNumber(value: number): string;
/**
 * Predicate fragment excluding the `_system` sentinel rows that
 * initializeMemoryTables writes for schema inference. Pushed into SQL so the
 * query engine applies it, rather than a JavaScript filter running over an
 * already-truncated page of results.
 *
 * The `IS NOT TRUE` is load-bearing and must not be simplified to `NOT`.
 * DataFusion's `array_has` returns NULL rather than false when the list is
 * empty, and `NOT NULL` is NULL, which no row satisfies. Written as `NOT
 * array_has(...)` this predicate silently discards every row whose `tags` is
 * `[]`. `IS NOT TRUE` matches both false and NULL, restoring parity with the
 * JavaScript filter it replaced, where `[].includes("_system")` was false.
 *
 * See scripts/verify-counts.ts, which asserts that the naive form loses rows.
 */
export declare const EXCLUDE_SYSTEM_ROWS = "array_has(tags, '_system') IS NOT TRUE";
/** Times scanAll re-reads when the matching set changes between count and scan. */
export declare const SCAN_STABILITY_ATTEMPTS = 5;
/**
 * Return every row matching `filter`, as one consistent set, with no implicit
 * ceiling. LanceDB's query builder applies a default limit of 10 when `.limit()`
 * is never called, so an unbounded `.toArray()` silently truncates.
 *
 * `countRows()` and the row read are two separate operations. checkout(version)
 * mutates the shared table handle in place (verified against @lancedb/lancedb
 * 0.15), so it cannot pin a snapshot on these module-level tables. Instead this
 * detects a concurrent insert: request one more row than the count. If it comes
 * back, the set grew mid-scan — discard and retry. If it does not, every match
 * was retrieved (a row deleted mid-scan only lowers the count, still complete;
 * `matches === 0` requests limit(1) and returns [] only when nothing appeared).
 * A set changing faster than SCAN_STABILITY_ATTEMPTS reads throws rather than
 * returning a partial result — loud failure is correct, and at ~80 rows with
 * three writers it will not fire in practice.
 *
 * Pass `columns` to project only the fields you need — e.g. to avoid
 * materializing the 384-float `vector` column when scanning todos or memories.
 * When projecting, `T` should describe just the selected columns.
 */
export declare function scanAll<T>(table: lancedb.Table, filter: string, columns?: string[]): Promise<T[]>;
/**
 * `column IN ('a', 'b', ...)` with every value escaped. Used for status,
 * priority, kind and topic-id membership tests pushed into SQL.
 */
export declare function inListSQL(column: string, values: readonly string[]): string;
/**
 * Conjunction of `array_has` clauses requiring every tag to be present — the
 * SQL equivalent of `tags.every(t => row.tags.includes(t))`, so tag filtering
 * runs in the engine instead of over an already-truncated page of rows.
 */
export declare function requireAllTagsSQL(tags: readonly string[]): string;
/**
 * Normalize a row read via toArray() into plain JS. List/vector columns come
 * back as Arrow Vector proxies that add() re-serializes incorrectly (tag strings
 * blanked, floats nulled); Array.from() materializes their real values. Used by
 * the dedupe cleanup, which re-adds rows it read via toArray().
 */
export declare function toPlainRow(row: Record<string, unknown>): Record<string, unknown>;
/** LanceDB surfaces a lost commit race as an unresolved "Commit conflict" error. */
export declare function isCommitConflict(error: unknown): boolean;
/**
 * Run an atomic write, retrying on LanceDB commit conflicts. LanceDB uses
 * optimistic concurrency and does not auto-resolve conflicting commits — the
 * loser must rerun against the latest version.
 *
 * The retry is only real because it refreshes the table handle first. A commit
 * conflict means another process committed since this handle's pinned version;
 * that write never advances *this* handle (only its own writes do). Without the
 * refresh, `op` would re-read the same stale version and re-build a commit
 * against it, hitting the identical conflict every attempt until the loop gives
 * up — a delay loop, not a retry (proven in scripts/verify-staleness.ts). The
 * refresh (`checkoutLatest` on every handle) advances the handle so `op`'s
 * re-read sees the winning write and its new commit targets the latest version.
 * That is what actually merges the two writes and closes the read-modify-write
 * lost-update window — `op` must re-read current state each attempt for it to
 * hold, which the update helpers do (getXById then updateColumns).
 *
 * `refresh` is injectable so a test can drive a single stale handle; production
 * callers use the default (refreshTables, refreshing all three module handles).
 */
export declare function withCommitRetry<T>(op: () => Promise<T>, refresh?: () => Promise<void>): Promise<T>;
export declare const PRIORITY_ORDER: Record<TodoPriority, number>;
/** Strip the vector field from a single Todo */
export declare function stripTodoVector(todo: Todo): Omit<Todo, 'vector'>;
/** Strip the vector field from a single Memory */
export declare function stripMemoryVector(memory: Memory): Omit<Memory, 'vector'>;
/** Strip vector fields from an array of Todos */
export declare function stripTodoVectors(todos: Todo[]): Omit<Todo, 'vector'>[];
/** Strip vector fields from an array of Memories */
export declare function stripMemoryVectors(memories: Memory[]): Omit<Memory, 'vector'>[];
export declare function initializeMemoryTables(db: lancedb.Connection, vectorDimensions: number): Promise<void>;
export declare function createTopic(data: Omit<Topic, "id" | "created_at" | "updated_at" | "last_referenced_at">): Promise<Topic>;
export declare function updateTopic(id: string, updates: Partial<Omit<Topic, "id" | "created_at">>): Promise<Topic | null>;
export declare function getTopicById(id: string): Promise<Topic | null>;
export declare function getTopicByName(name: string): Promise<Topic | null>;
export declare function listTopics(filters: {
    status_filter?: TopicStatus[];
    tag_filter?: string[];
    name_search?: string;
    min_importance?: number;
    limit?: number;
}): Promise<Topic[]>;
export declare function deleteTopic(id: string): Promise<boolean>;
export declare function touchTopicLastReferenced(id: string): Promise<void>;
/**
 * Touch a topic's last_referenced_at, swallowing any failure.
 *
 * `last_referenced_at` is derived metadata, not user data. Tool handlers call
 * this *after* the user's memory/todo write has already committed durably, or as
 * a read-side effect. A throw here must never fail the handler and make the
 * caller believe a durable write was lost — that false failure is exactly what
 * drove retried add_memory calls into duplicate rows (see
 * scripts/audit-duplicates.ts). Swallowing it cannot mask a *user-data* write
 * failure: the memory/todo/topic writes propagate their own errors, and a
 * genuinely broken topics table still fails loudly on create_topic/update_topic,
 * which do not route through here — only this timestamp touch is suppressed.
 */
export declare function safeTouchTopicLastReferenced(id: string): Promise<void>;
export declare function createMemory(data: Omit<Memory, "id" | "created_at" | "updated_at">): Promise<Memory>;
export declare function updateMemory(id: string, updates: Partial<Omit<Memory, "id" | "created_at">>): Promise<Memory | null>;
export declare function getMemoryById(id: string): Promise<Memory | null>;
export declare function listMemories(filters: {
    topic_id?: string;
    topic_ids?: string[];
    kind_filter?: MemoryKind[];
    tag_filter?: string[];
    min_importance?: number;
    since?: string;
    until?: string;
    limit?: number;
}): Promise<Memory[]>;
export declare function searchMemoriesVector(queryVector: number[], filters: {
    topic_id?: string;
    topic_ids?: string[];
    kind_filter?: MemoryKind[];
    tag_filter?: string[];
    min_importance?: number;
    since?: string;
}, limit?: number): Promise<Array<Memory & {
    _distance: number;
}>>;
export declare function deleteMemory(id: string): Promise<boolean>;
export declare function getMemoriesBySupersedes(supersededId: string): Promise<Memory | null>;
export declare function countMemoriesByTopic(topicId: string): Promise<number>;
export declare function createTodo(data: Omit<Todo, "id" | "created_at" | "updated_at" | "completed_at">): Promise<Todo>;
export declare function updateTodo(id: string, updates: Partial<Omit<Todo, "id" | "created_at">>): Promise<Todo | null>;
export declare function getTodoById(id: string): Promise<Todo | null>;
export declare function listTodos(filters: {
    topic_id?: string;
    status_filter?: TodoStatus[];
    priority_filter?: TodoPriority[];
    tag_filter?: string[];
    overdue_only?: boolean;
    memory_id?: string;
    limit?: number;
}): Promise<Todo[]>;
export declare function deleteTodo(id: string): Promise<boolean>;
export declare function countOpenTodosByTopic(topicId: string): Promise<number>;
export declare function getTodoCountsByPriority(): Promise<Record<TodoPriority, number>>;
export declare function getOverdueTodos(): Promise<Todo[]>;
export declare function getHighPriorityTodos(): Promise<Todo[]>;
export declare function getRecentlyUpdatedTopics(days?: number): Promise<Topic[]>;
export declare function getStaleTopics(staleDays?: number): Promise<Topic[]>;
export declare function getMemoryCountSince(days: number): Promise<{
    added: number;
    updated: number;
}>;
