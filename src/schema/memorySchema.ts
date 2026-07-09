import * as lancedb from "@lancedb/lancedb";
import { v4 as uuidv4 } from "uuid";

// ============================================================================
// Type Definitions
// ============================================================================

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

export type MemoryKind =
  | "decision"
  | "insight"
  | "context"
  | "preference"
  | "outcome"
  | "blocker"
  | "reference"
  | "other";

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

// Summary types for compact responses
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

// ============================================================================
// Table Names
// ============================================================================

export const TOPICS_TABLE_NAME = "topics";
export const MEMORIES_TABLE_NAME = "memories";
export const TODOS_TABLE_NAME = "todos";

// ============================================================================
// Table References (populated by initializeMemoryTables)
// ============================================================================

export let topicsTable: lancedb.Table | null = null;
export let memoriesTable: lancedb.Table | null = null;
export let todosTable: lancedb.Table | null = null;

// ============================================================================
// Helper Functions
// ============================================================================

export function generateId(): string {
  return uuidv4();
}

export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Escape a value for use as a SQL string literal in a LanceDB filter.
 * DataFusion follows the SQL standard, where an embedded single quote is
 * escaped by doubling it.
 */
export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`; // sql-escape-allowed
}

/**
 * Parenthesized, comma-separated list of escaped string literals for an
 * `IN (...)` clause, e.g. `('open', 'in_progress')`. Escapes every value rather
 * than trusting a TypeScript enum to constrain the runtime input it is given.
 */
export function sqlStringList(values: readonly string[]): string {
  return `(${values.map(sqlString).join(", ")})`;
}

/**
 * A validated numeric SQL literal. A number has no quoting to escape, so instead
 * of interpolating it we reject anything that is not a finite number outright.
 * MCP tool arguments are untyped at runtime, so a caller passing the string
 * "0 OR 1=1" for a numeric filter would otherwise inject arbitrary SQL into a
 * comparison — the escaping guard cannot see an unquoted interpolation.
 */
export function sqlNumber(value: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected a finite number for a SQL numeric literal, got ${JSON.stringify(value)}`);
  }
  return String(value);
}

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
export const EXCLUDE_SYSTEM_ROWS = "array_has(tags, '_system') IS NOT TRUE";

/** Times scanAll re-reads when the matching set changes between count and scan. */
export const SCAN_STABILITY_ATTEMPTS = 5;

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
export async function scanAll<T>(
  table: lancedb.Table,
  filter: string,
  columns?: string[],
): Promise<T[]> {
  for (let attempt = 0; attempt < SCAN_STABILITY_ATTEMPTS; attempt += 1) {
    const matches = await table.countRows(filter);
    let query = table.query().where(filter);
    if (columns) query = query.select(columns);
    const rows = await query.limit(matches + 1).toArray();
    if (rows.length <= matches) {
      return rows as unknown as T[];
    }
    // rows.length > matches: the matching set grew during the read. Retry.
  }
  throw new Error("scanAll: '" + filter + "' is changing faster than it can be scanned");
}

/**
 * `column IN ('a', 'b', ...)` with every value escaped. Used for status,
 * priority, kind and topic-id membership tests pushed into SQL.
 */
export function inListSQL(column: string, values: readonly string[]): string {
  return `${column} IN ${sqlStringList(values)}`;
}

/**
 * Conjunction of `array_has` clauses requiring every tag to be present — the
 * SQL equivalent of `tags.every(t => row.tags.includes(t))`, so tag filtering
 * runs in the engine instead of over an already-truncated page of rows.
 */
export function requireAllTagsSQL(tags: readonly string[]): string {
  return tags.map((tag) => `array_has(tags, ${sqlString(tag)})`).join(" AND ");
}

/**
 * Normalize a row read via toArray() into plain JS. List/vector columns come
 * back as Arrow Vector proxies that add() re-serializes incorrectly (tag strings
 * blanked, floats nulled); Array.from() materializes their real values. Used by
 * the dedupe cleanup, which re-adds rows it read via toArray().
 */
export function toPlainRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] =
      value != null && typeof value === "object" && Symbol.iterator in (value as object)
        ? Array.from(value as Iterable<unknown>)
        : value;
  }
  return out;
}

/**
 * Column values accepted by LanceDB's table.update(). The cast at call sites is
 * needed only because a Partial<> spread widens each field to include undefined,
 * which the update signature (correctly) rejects; callers pass defined values.
 */
type UpdateValues = Record<string, string | number | boolean | null | number[] | string[]>;

/** Atomically update named columns of the row with this id. */
async function updateColumns(table: lancedb.Table, id: string, values: UpdateValues): Promise<void> {
  await table.update({ where: `id = ${sqlString(id)}`, values });
}

/** Times an atomic write is retried when it loses a commit race. */
const COMMIT_RETRY_ATTEMPTS = 12;

/** LanceDB surfaces a lost commit race as an unresolved "Commit conflict" error. */
function isCommitConflict(error: unknown): boolean {
  return error instanceof Error && /commit conflict/i.test(error.message);
}

/**
 * Run an atomic write, retrying on LanceDB commit conflicts. LanceDB uses
 * optimistic concurrency and does not auto-resolve conflicting commits — the
 * loser must rerun against the latest version. `op` should re-read current state
 * each attempt, so a retry merges with the winning write instead of clobbering
 * it (this is also what closes the read-modify-write lost-update window).
 */
async function withCommitRetry<T>(op: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await op();
    } catch (error) {
      if (!isCommitConflict(error) || attempt >= COMMIT_RETRY_ATTEMPTS - 1) throw error;
      // Jittered backoff so concurrent writers don't retry in lockstep.
      const delayMs = (attempt + 1) * 8 + Math.random() * 12;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// Priority ordering for sorting
export const PRIORITY_ORDER: Record<TodoPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ============================================================================
// Vector Stripping Utilities
// ============================================================================
// LanceDB stores embedding vectors on every record. These are only useful for
// internal similarity search and must NEVER be serialized to MCP responses —
// each vector is ~384 float64 values that burn thousands of tokens for zero
// conversational value.

/** Strip the vector field from a single Todo */
export function stripTodoVector(todo: Todo): Omit<Todo, 'vector'> {
  const { vector: _v, ...rest } = todo;
  return rest;
}

/** Strip the vector field from a single Memory */
export function stripMemoryVector(memory: Memory): Omit<Memory, 'vector'> {
  const { vector: _v, ...rest } = memory;
  return rest;
}

/** Strip vector fields from an array of Todos */
export function stripTodoVectors(todos: Todo[]): Omit<Todo, 'vector'>[] {
  return todos.map(stripTodoVector);
}

/** Strip vector fields from an array of Memories */
export function stripMemoryVectors(memories: Memory[]): Omit<Memory, 'vector'>[] {
  return memories.map(stripMemoryVector);
}

// ============================================================================
// Schema Initialization
// ============================================================================

async function tableExists(db: lancedb.Connection, tableName: string): Promise<boolean> {
  try {
    const tables = await db.tableNames();
    return tables.includes(tableName);
  } catch {
    return false;
  }
}

export async function initializeMemoryTables(db: lancedb.Connection, vectorDimensions: number): Promise<void> {
  const now = nowISO();

  // Initialize topics table (no vectors)
  if (!(await tableExists(db, TOPICS_TABLE_NAME))) {
    console.error(`Creating ${TOPICS_TABLE_NAME} table...`);
    const initialTopic: Topic = {
      id: generateId(),
      name: "_system_init",
      description: "System initialization record - can be deleted",
      tags: ["_system"],
      status: "archived",
      importance: 0,
      created_at: now,
      updated_at: now,
      last_referenced_at: now,
    };
    topicsTable = await db.createTable(TOPICS_TABLE_NAME, [initialTopic as unknown as Record<string, unknown>]);
  } else {
    topicsTable = await db.openTable(TOPICS_TABLE_NAME);
  }

  // Initialize memories table (with vectors)
  // Note: LanceDB requires non-null values to infer column types on creation
  // We use placeholder values that will be filtered out by the _system tag
  if (!(await tableExists(db, MEMORIES_TABLE_NAME))) {
    console.error(`Creating ${MEMORIES_TABLE_NAME} table...`);
    const zeroVector = new Array(vectorDimensions).fill(0);
    const initialMemory: Memory = {
      id: generateId(),
      topic_id: "_system_placeholder", // Non-null placeholder for type inference
      title: "_system_init",
      content: "System initialization record - can be deleted",
      kind: "other",
      tags: ["_system"],
      importance: 0,
      created_at: now,
      updated_at: now,
      conversation_summary: "_system_placeholder", // Non-null placeholder
      supersedes_id: "_system_placeholder", // Non-null placeholder
      vector: zeroVector,
    };
    memoriesTable = await db.createTable(MEMORIES_TABLE_NAME, [initialMemory as unknown as Record<string, unknown>]);
  } else {
    memoriesTable = await db.openTable(MEMORIES_TABLE_NAME);
  }

  // Initialize todos table (with vectors)
  if (!(await tableExists(db, TODOS_TABLE_NAME))) {
    console.error(`Creating ${TODOS_TABLE_NAME} table...`);
    const zeroVector = new Array(vectorDimensions).fill(0);
    const initialTodo: Todo = {
      id: generateId(),
      topic_id: "_system_placeholder", // Non-null placeholder for type inference
      memory_id: "_system_placeholder", // Non-null placeholder
      title: "_system_init",
      description: "System initialization record - can be deleted",
      status: "cancelled",
      priority: "low",
      due_at: now, // Non-null placeholder
      created_at: now,
      updated_at: now,
      completed_at: now,
      tags: ["_system"],
      vector: zeroVector,
    };
    todosTable = await db.createTable(TODOS_TABLE_NAME, [initialTodo as unknown as Record<string, unknown>]);
  } else {
    todosTable = await db.openTable(TODOS_TABLE_NAME);
  }

  console.error("Memory tables initialized successfully");
}

// ============================================================================
// CRUD Operations for Topics
// ============================================================================

export async function createTopic(data: Omit<Topic, "id" | "created_at" | "updated_at" | "last_referenced_at">): Promise<Topic> {
  if (!topicsTable) throw new Error("Topics table not initialized");

  const now = nowISO();
  const topic: Topic = {
    id: generateId(),
    ...data,
    created_at: now,
    updated_at: now,
    last_referenced_at: now,
  };

  await topicsTable.add([topic as unknown as Record<string, unknown>]);
  return topic;
}

export async function updateTopic(id: string, updates: Partial<Omit<Topic, "id" | "created_at">>): Promise<Topic | null> {
  if (!topicsTable) throw new Error("Topics table not initialized");
  const table = topicsTable;

  return withCommitRetry(async () => {
    const existing = await getTopicById(id);
    if (!existing) return null;

    const now = nowISO();
    await updateColumns(table, id, { ...updates, updated_at: now } as UpdateValues);
    return { ...existing, ...updates, updated_at: now };
  });
}

export async function getTopicById(id: string): Promise<Topic | null> {
  if (!topicsTable) throw new Error("Topics table not initialized");

  const results = await topicsTable.query().where(`id = ${sqlString(id)}`).limit(1).toArray();
  return results.length > 0 ? results[0] as unknown as Topic : null;
}

export async function getTopicByName(name: string): Promise<Topic | null> {
  if (!topicsTable) throw new Error("Topics table not initialized");

  const results = await topicsTable.query().where(`name = ${sqlString(name)}`).limit(1).toArray();
  return results.length > 0 ? results[0] as unknown as Topic : null;
}

export async function listTopics(filters: {
  status_filter?: TopicStatus[];
  tag_filter?: string[];
  name_search?: string;
  min_importance?: number;
  limit?: number;
}): Promise<Topic[]> {
  if (!topicsTable) throw new Error("Topics table not initialized");

  const limit = filters.limit ?? 20;

  // Every predicate is pushed into SQL so `.limit(limit)` is applied after
  // filtering, not before. The old code fetched limit*2 rows and filtered in
  // JavaScript, which under-returned whenever the residual filters rejected
  // more than half the page.
  const conditions: string[] = [EXCLUDE_SYSTEM_ROWS];

  if (filters.status_filter && filters.status_filter.length > 0) {
    conditions.push(inListSQL("status", filters.status_filter));
  }

  if (filters.min_importance !== undefined) {
    conditions.push(`importance >= ${sqlNumber(filters.min_importance)}`);
  }

  if (filters.tag_filter && filters.tag_filter.length > 0) {
    conditions.push(requireAllTagsSQL(filters.tag_filter));
  }

  if (filters.name_search) {
    // contains(lower(name), literal) reproduces name.toLowerCase().includes()
    // exactly; the literal carries no LIKE wildcards, so quote-escaping suffices.
    conditions.push(`contains(lower(name), ${sqlString(filters.name_search.toLowerCase())})`);
  }

  const rows = await topicsTable
    .query()
    .where(conditions.join(" AND "))
    .limit(limit)
    .toArray();

  return rows as unknown as Topic[];
}

export async function deleteTopic(id: string): Promise<boolean> {
  if (!topicsTable) throw new Error("Topics table not initialized");

  await topicsTable.delete(`id = ${sqlString(id)}`);
  return true;
}

export async function touchTopicLastReferenced(id: string): Promise<void> {
  if (!topicsTable) throw new Error("Topics table not initialized");
  const table = topicsTable;

  // Single-column atomic update, retried on conflict. This is the hot path — it
  // fires on every topic reference from multiple concurrent servers — so it must
  // not read-modify-write or delete+add, both of which race into duplicate rows.
  // update() touches only last_referenced_at and no-ops when the id is absent.
  await withCommitRetry(() =>
    table.update({
      where: `id = ${sqlString(id)}`,
      values: { last_referenced_at: nowISO() },
    }),
  );
}

// ============================================================================
// CRUD Operations for Memories
// ============================================================================

export async function createMemory(data: Omit<Memory, "id" | "created_at" | "updated_at">): Promise<Memory> {
  if (!memoriesTable) throw new Error("Memories table not initialized");

  const now = nowISO();
  const memory: Memory = {
    id: generateId(),
    ...data,
    created_at: now,
    updated_at: now,
  };

  await memoriesTable.add([memory as unknown as Record<string, unknown>]);
  return memory;
}

export async function updateMemory(id: string, updates: Partial<Omit<Memory, "id" | "created_at">>): Promise<Memory | null> {
  if (!memoriesTable) throw new Error("Memories table not initialized");
  const table = memoriesTable;

  return withCommitRetry(async () => {
    const existing = await getMemoryById(id);
    if (!existing) return null;

    const now = nowISO();
    await updateColumns(table, id, { ...updates, updated_at: now } as UpdateValues);
    return { ...existing, ...updates, updated_at: now };
  });
}

export async function getMemoryById(id: string): Promise<Memory | null> {
  if (!memoriesTable) throw new Error("Memories table not initialized");

  const results = await memoriesTable.query().where(`id = ${sqlString(id)}`).limit(1).toArray();
  return results.length > 0 ? results[0] as unknown as Memory : null;
}

export async function listMemories(filters: {
  topic_id?: string;
  topic_ids?: string[];
  kind_filter?: MemoryKind[];
  tag_filter?: string[];
  min_importance?: number;
  since?: string;
  until?: string;
  limit?: number;
}): Promise<Memory[]> {
  if (!memoriesTable) throw new Error("Memories table not initialized");

  const limit = filters.limit ?? 20;
  const conditions: string[] = [EXCLUDE_SYSTEM_ROWS];

  if (filters.topic_id) {
    conditions.push(`topic_id = ${sqlString(filters.topic_id)}`);
  }

  if (filters.topic_ids && filters.topic_ids.length > 0) {
    conditions.push(inListSQL("topic_id", filters.topic_ids));
  }

  if (filters.kind_filter && filters.kind_filter.length > 0) {
    conditions.push(inListSQL("kind", filters.kind_filter));
  }

  if (filters.min_importance !== undefined) {
    conditions.push(`importance >= ${sqlNumber(filters.min_importance)}`);
  }

  if (filters.tag_filter && filters.tag_filter.length > 0) {
    conditions.push(requireAllTagsSQL(filters.tag_filter));
  }

  if (filters.since) {
    conditions.push(`updated_at >= ${sqlString(filters.since)}`);
  }

  if (filters.until) {
    conditions.push(`updated_at <= ${sqlString(filters.until)}`);
  }

  const rows = await memoriesTable
    .query()
    .where(conditions.join(" AND "))
    .limit(limit)
    .toArray();

  return rows as unknown as Memory[];
}

export async function searchMemoriesVector(
  queryVector: number[],
  filters: {
    topic_id?: string;
    topic_ids?: string[];
    kind_filter?: MemoryKind[];
    tag_filter?: string[];
    min_importance?: number;
    since?: string;
  },
  limit: number = 10
): Promise<Array<Memory & { _distance: number }>> {
  if (!memoriesTable) throw new Error("Memories table not initialized");

  const conditions: string[] = [EXCLUDE_SYSTEM_ROWS];

  if (filters.topic_id) {
    conditions.push(`topic_id = ${sqlString(filters.topic_id)}`);
  }

  if (filters.topic_ids && filters.topic_ids.length > 0) {
    conditions.push(inListSQL("topic_id", filters.topic_ids));
  }

  if (filters.kind_filter && filters.kind_filter.length > 0) {
    conditions.push(inListSQL("kind", filters.kind_filter));
  }

  if (filters.min_importance !== undefined) {
    conditions.push(`importance >= ${sqlNumber(filters.min_importance)}`);
  }

  if (filters.tag_filter && filters.tag_filter.length > 0) {
    conditions.push(requireAllTagsSQL(filters.tag_filter));
  }

  if (filters.since) {
    conditions.push(`updated_at >= ${sqlString(filters.since)}`);
  }

  // LanceDB filters vector searches as a prefilter by default, so `.limit(limit)`
  // returns the limit nearest rows *among matches* rather than filtering an
  // already-truncated set of nearest neighbours down to fewer than limit.
  const rows = await memoriesTable
    .vectorSearch(queryVector)
    .where(conditions.join(" AND "))
    .limit(limit)
    .toArray();

  return rows as unknown as Array<Memory & { _distance: number }>;
}

export async function deleteMemory(id: string): Promise<boolean> {
  if (!memoriesTable) throw new Error("Memories table not initialized");

  await memoriesTable.delete(`id = ${sqlString(id)}`);
  return true;
}

export async function getMemoriesBySupersedes(supersededId: string): Promise<Memory | null> {
  if (!memoriesTable) throw new Error("Memories table not initialized");

  const results = await memoriesTable.query().where(`supersedes_id = ${sqlString(supersededId)}`).limit(1).toArray();
  return results.length > 0 ? results[0] as unknown as Memory : null;
}

export async function countMemoriesByTopic(topicId: string): Promise<number> {
  if (!memoriesTable) throw new Error("Memories table not initialized");

  return await memoriesTable.countRows(
    `topic_id = ${sqlString(topicId)} AND ${EXCLUDE_SYSTEM_ROWS}`,
  );
}

// ============================================================================
// CRUD Operations for Todos
// ============================================================================

export async function createTodo(data: Omit<Todo, "id" | "created_at" | "updated_at" | "completed_at">): Promise<Todo> {
  if (!todosTable) throw new Error("Todos table not initialized");

  const now = nowISO();
  const todo: Todo = {
    id: generateId(),
    ...data,
    created_at: now,
    updated_at: now,
    completed_at: null,
  };

  await todosTable.add([todo as unknown as Record<string, unknown>]);
  return todo;
}

export async function updateTodo(id: string, updates: Partial<Omit<Todo, "id" | "created_at">>): Promise<Todo | null> {
  if (!todosTable) throw new Error("Todos table not initialized");
  const table = todosTable;

  return withCommitRetry(async () => {
    const existing = await getTodoById(id);
    if (!existing) return null;

    const now = nowISO();
    let completedAt = existing.completed_at;

    // Handle status transitions
    if (updates.status) {
      if ((updates.status === "done" || updates.status === "cancelled") && !existing.completed_at) {
        completedAt = now;
      } else if (updates.status === "open" || updates.status === "in_progress" || updates.status === "blocked") {
        completedAt = null;
      }
    }

    await updateColumns(table, id, {
      ...updates,
      updated_at: now,
      completed_at: completedAt,
    } as UpdateValues);
    return { ...existing, ...updates, updated_at: now, completed_at: completedAt };
  });
}

export async function getTodoById(id: string): Promise<Todo | null> {
  if (!todosTable) throw new Error("Todos table not initialized");

  const results = await todosTable.query().where(`id = ${sqlString(id)}`).limit(1).toArray();
  return results.length > 0 ? results[0] as unknown as Todo : null;
}

export async function listTodos(filters: {
  topic_id?: string;
  status_filter?: TodoStatus[];
  priority_filter?: TodoPriority[];
  tag_filter?: string[];
  overdue_only?: boolean;
  memory_id?: string;
  limit?: number;
}): Promise<Todo[]> {
  if (!todosTable) throw new Error("Todos table not initialized");

  const limit = filters.limit ?? 20;
  const conditions: string[] = [EXCLUDE_SYSTEM_ROWS];

  if (filters.topic_id) {
    conditions.push(`topic_id = ${sqlString(filters.topic_id)}`);
  }

  if (filters.memory_id) {
    conditions.push(`memory_id = ${sqlString(filters.memory_id)}`);
  }

  if (filters.status_filter && filters.status_filter.length > 0) {
    conditions.push(inListSQL("status", filters.status_filter));
  }

  if (filters.priority_filter && filters.priority_filter.length > 0) {
    conditions.push(inListSQL("priority", filters.priority_filter));
  }

  if (filters.overdue_only) {
    // A null due_at yields `null < ...` = NULL and is excluded, matching the old
    // `t.due_at && t.due_at < now` guard.
    conditions.push(
      `due_at < ${sqlString(nowISO())} ` +
        `AND status IN ('open', 'in_progress', 'blocked')`,
    );
  }

  if (filters.tag_filter && filters.tag_filter.length > 0) {
    conditions.push(requireAllTagsSQL(filters.tag_filter));
  }

  const rows = await todosTable
    .query()
    .where(conditions.join(" AND "))
    .limit(limit)
    .toArray();

  return rows as unknown as Todo[];
}

export async function deleteTodo(id: string): Promise<boolean> {
  if (!todosTable) throw new Error("Todos table not initialized");

  await todosTable.delete(`id = ${sqlString(id)}`);
  return true;
}

export async function countOpenTodosByTopic(topicId: string): Promise<number> {
  if (!todosTable) throw new Error("Todos table not initialized");

  return await todosTable.countRows(
    `topic_id = ${sqlString(topicId)} ` +
      `AND status IN ('open', 'in_progress', 'blocked') ` +
      `AND ${EXCLUDE_SYSTEM_ROWS}`,
  );
}

export async function getTodoCountsByPriority(): Promise<Record<TodoPriority, number>> {
  if (!todosTable) throw new Error("Todos table not initialized");

  const counts: Record<TodoPriority, number> = { urgent: 0, high: 0, medium: 0, low: 0 };

  // One scan over just the priority column, rather than one countRows per
  // priority. A single snapshot means the four buckets always sum to a real
  // total, and projecting to `priority` never materializes the 384-float
  // vector. scanAll counts first, so LanceDB's default page size of 10 cannot
  // truncate the result.
  const rows = await scanAll<{ priority: TodoPriority }>(
    todosTable,
    `status IN ('open', 'in_progress', 'blocked') AND ${EXCLUDE_SYSTEM_ROWS}`,
    ["priority"],
  );

  for (const { priority } of rows) {
    counts[priority]++;
  }

  return counts;
}

export async function getOverdueTodos(): Promise<Todo[]> {
  return listTodos({
    status_filter: ["open", "in_progress", "blocked"],
    overdue_only: true,
    limit: 50,
  });
}

export async function getHighPriorityTodos(): Promise<Todo[]> {
  return listTodos({
    status_filter: ["open", "in_progress", "blocked"],
    priority_filter: ["urgent", "high"],
    limit: 50,
  });
}

// ============================================================================
// Aggregate Queries
// ============================================================================

export async function getRecentlyUpdatedTopics(days: number = 7): Promise<Topic[]> {
  if (!topicsTable) throw new Error("Topics table not initialized");

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffISO = cutoff.toISOString();

  const since = sqlString(cutoffISO);
  const topics = await scanAll<Topic>(
    topicsTable,
    `(updated_at >= ${since} OR last_referenced_at >= ${since}) AND ${EXCLUDE_SYSTEM_ROWS}`,
  );

  return topics.sort((a, b) => b.last_referenced_at.localeCompare(a.last_referenced_at));
}

export async function getStaleTopics(staleDays: number = 30): Promise<Topic[]> {
  if (!topicsTable) throw new Error("Topics table not initialized");

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - staleDays);
  const cutoffISO = cutoff.toISOString();

  return await scanAll<Topic>(
    topicsTable,
    `status = 'active' ` +
      `AND last_referenced_at < ${sqlString(cutoffISO)} ` +
      `AND ${EXCLUDE_SYSTEM_ROWS}`,
  );
}

export async function getMemoryCountSince(days: number): Promise<{ added: number; updated: number }> {
  if (!memoriesTable) throw new Error("Memories table not initialized");

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffISO = cutoff.toISOString();

  const table = memoriesTable;
  const since = sqlString(cutoffISO);

  const [added, updated] = await Promise.all([
    table.countRows(`created_at >= ${since} AND ${EXCLUDE_SYSTEM_ROWS}`),
    table.countRows(
      `updated_at >= ${since} AND created_at < ${since} AND ${EXCLUDE_SYSTEM_ROWS}`,
    ),
  ]);

  return { added, updated };
}
