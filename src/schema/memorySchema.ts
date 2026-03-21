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

  const existing = await getTopicById(id);
  if (!existing) return null;

  const updated: Topic = {
    ...existing,
    ...updates,
    updated_at: nowISO(),
  };

  // LanceDB update requires delete + add for full record updates
  await topicsTable.delete(`id = '${id}'`);
  await topicsTable.add([updated as unknown as Record<string, unknown>]);
  return updated;
}

export async function getTopicById(id: string): Promise<Topic | null> {
  if (!topicsTable) throw new Error("Topics table not initialized");

  const results = await topicsTable.query().where(`id = '${id}'`).limit(1).toArray();
  return results.length > 0 ? results[0] as unknown as Topic : null;
}

export async function getTopicByName(name: string): Promise<Topic | null> {
  if (!topicsTable) throw new Error("Topics table not initialized");

  const results = await topicsTable.query().where(`name = '${name}'`).limit(1).toArray();
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

  let query = topicsTable.query();

  // Build WHERE conditions
  const conditions: string[] = [];

  if (filters.status_filter && filters.status_filter.length > 0) {
    const statusList = filters.status_filter.map(s => `'${s}'`).join(", ");
    conditions.push(`status IN (${statusList})`);
  }

  if (filters.min_importance !== undefined) {
    conditions.push(`importance >= ${filters.min_importance}`);
  }

  // Apply conditions
  if (conditions.length > 0) {
    query = query.where(conditions.join(" AND "));
  }

  const limit = filters.limit ?? 20;
  let results = await query.limit(limit * 2).toArray(); // Get more to filter

  // Client-side filtering for complex conditions
  let topics = results as unknown as Topic[];

  // Filter by name search
  if (filters.name_search) {
    const search = filters.name_search.toLowerCase();
    topics = topics.filter(t => t.name.toLowerCase().includes(search));
  }

  // Filter by tags (AND logic)
  if (filters.tag_filter && filters.tag_filter.length > 0) {
    topics = topics.filter(t =>
      filters.tag_filter!.every(tag => t.tags.includes(tag))
    );
  }

  // Filter out system records
  topics = topics.filter(t => !t.tags.includes("_system"));

  // Deduplicate by ID (can happen due to delete+add update pattern)
  const seen = new Set<string>();
  topics = topics.filter(t => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });

  return topics.slice(0, limit);
}

export async function deleteTopic(id: string): Promise<boolean> {
  if (!topicsTable) throw new Error("Topics table not initialized");

  await topicsTable.delete(`id = '${id}'`);
  return true;
}

export async function touchTopicLastReferenced(id: string): Promise<void> {
  if (!topicsTable) throw new Error("Topics table not initialized");

  const existing = await getTopicById(id);
  if (!existing) return;

  const updated = {
    ...existing,
    last_referenced_at: nowISO(),
  };

  await topicsTable.delete(`id = '${id}'`);
  await topicsTable.add([updated as unknown as Record<string, unknown>]);
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

  const existing = await getMemoryById(id);
  if (!existing) return null;

  const updated: Memory = {
    ...existing,
    ...updates,
    updated_at: nowISO(),
  };

  // LanceDB update requires delete + add for full record updates
  await memoriesTable.delete(`id = '${id}'`);
  await memoriesTable.add([updated as unknown as Record<string, unknown>]);
  return updated;
}

export async function getMemoryById(id: string): Promise<Memory | null> {
  if (!memoriesTable) throw new Error("Memories table not initialized");

  const results = await memoriesTable.query().where(`id = '${id}'`).limit(1).toArray();
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

  let query = memoriesTable.query();
  const conditions: string[] = [];

  if (filters.topic_id) {
    conditions.push(`topic_id = '${filters.topic_id}'`);
  }

  if (filters.kind_filter && filters.kind_filter.length > 0) {
    const kindList = filters.kind_filter.map(k => `'${k}'`).join(", ");
    conditions.push(`kind IN (${kindList})`);
  }

  if (filters.min_importance !== undefined) {
    conditions.push(`importance >= ${filters.min_importance}`);
  }

  if (conditions.length > 0) {
    query = query.where(conditions.join(" AND "));
  }

  const limit = filters.limit ?? 20;
  let results = await query.limit(limit * 2).toArray();
  let memories = results as unknown as Memory[];

  // Client-side filtering
  if (filters.topic_ids && filters.topic_ids.length > 0) {
    memories = memories.filter(m => m.topic_id && filters.topic_ids!.includes(m.topic_id));
  }

  if (filters.tag_filter && filters.tag_filter.length > 0) {
    memories = memories.filter(m =>
      filters.tag_filter!.every(tag => m.tags.includes(tag))
    );
  }

  if (filters.since) {
    memories = memories.filter(m => m.updated_at >= filters.since!);
  }

  if (filters.until) {
    memories = memories.filter(m => m.updated_at <= filters.until!);
  }

  // Filter out system records
  memories = memories.filter(m => !m.tags.includes("_system"));

  // Deduplicate by ID
  const seen = new Set<string>();
  memories = memories.filter(m => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  return memories.slice(0, limit);
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

  let query = memoriesTable.vectorSearch(queryVector);

  const conditions: string[] = [];

  if (filters.topic_id) {
    conditions.push(`topic_id = '${filters.topic_id}'`);
  }

  if (filters.kind_filter && filters.kind_filter.length > 0) {
    const kindList = filters.kind_filter.map(k => `'${k}'`).join(", ");
    conditions.push(`kind IN (${kindList})`);
  }

  if (filters.min_importance !== undefined) {
    conditions.push(`importance >= ${filters.min_importance}`);
  }

  if (conditions.length > 0) {
    query = query.where(conditions.join(" AND "));
  }

  let results = await query.limit(limit * 2).toArray();
  let memories = results as unknown as Array<Memory & { _distance: number }>;

  // Client-side filtering
  if (filters.topic_ids && filters.topic_ids.length > 0) {
    memories = memories.filter(m => m.topic_id && filters.topic_ids!.includes(m.topic_id));
  }

  if (filters.tag_filter && filters.tag_filter.length > 0) {
    memories = memories.filter(m =>
      filters.tag_filter!.every(tag => m.tags.includes(tag))
    );
  }

  if (filters.since) {
    memories = memories.filter(m => m.updated_at >= filters.since!);
  }

  // Filter out system records
  memories = memories.filter(m => !m.tags.includes("_system"));

  return memories.slice(0, limit);
}

export async function deleteMemory(id: string): Promise<boolean> {
  if (!memoriesTable) throw new Error("Memories table not initialized");

  await memoriesTable.delete(`id = '${id}'`);
  return true;
}

export async function getMemoriesBySupersedes(supersededId: string): Promise<Memory | null> {
  if (!memoriesTable) throw new Error("Memories table not initialized");

  const results = await memoriesTable.query().where(`supersedes_id = '${supersededId}'`).limit(1).toArray();
  return results.length > 0 ? results[0] as unknown as Memory : null;
}

export async function countMemoriesByTopic(topicId: string): Promise<number> {
  if (!memoriesTable) throw new Error("Memories table not initialized");

  const results = await memoriesTable.query().where(`topic_id = '${topicId}'`).toArray();
  return results.filter((m: any) => !m.tags?.includes("_system")).length;
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

  const updated: Todo = {
    ...existing,
    ...updates,
    updated_at: now,
    completed_at: completedAt,
  };

  // LanceDB update requires delete + add for full record updates
  await todosTable.delete(`id = '${id}'`);
  await todosTable.add([updated as unknown as Record<string, unknown>]);
  return updated;
}

export async function getTodoById(id: string): Promise<Todo | null> {
  if (!todosTable) throw new Error("Todos table not initialized");

  const results = await todosTable.query().where(`id = '${id}'`).limit(1).toArray();
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

  let query = todosTable.query();
  const conditions: string[] = [];

  if (filters.topic_id) {
    conditions.push(`topic_id = '${filters.topic_id}'`);
  }

  if (filters.memory_id) {
    conditions.push(`memory_id = '${filters.memory_id}'`);
  }

  if (filters.status_filter && filters.status_filter.length > 0) {
    const statusList = filters.status_filter.map(s => `'${s}'`).join(", ");
    conditions.push(`status IN (${statusList})`);
  }

  if (filters.priority_filter && filters.priority_filter.length > 0) {
    const priorityList = filters.priority_filter.map(p => `'${p}'`).join(", ");
    conditions.push(`priority IN (${priorityList})`);
  }

  if (conditions.length > 0) {
    query = query.where(conditions.join(" AND "));
  }

  const limit = filters.limit ?? 20;
  let results = await query.limit(limit * 2).toArray();
  let todos = results as unknown as Todo[];

  // Client-side filtering
  if (filters.tag_filter && filters.tag_filter.length > 0) {
    todos = todos.filter(t =>
      filters.tag_filter!.every(tag => t.tags.includes(tag))
    );
  }

  if (filters.overdue_only) {
    const now = nowISO();
    todos = todos.filter(t =>
      t.due_at &&
      t.due_at < now &&
      (t.status === "open" || t.status === "in_progress" || t.status === "blocked")
    );
  }

  // Filter out system records
  todos = todos.filter(t => !t.tags.includes("_system"));

  // Deduplicate by ID
  const seen = new Set<string>();
  todos = todos.filter(t => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });

  return todos.slice(0, limit);
}

export async function deleteTodo(id: string): Promise<boolean> {
  if (!todosTable) throw new Error("Todos table not initialized");

  await todosTable.delete(`id = '${id}'`);
  return true;
}

export async function countOpenTodosByTopic(topicId: string): Promise<number> {
  if (!todosTable) throw new Error("Todos table not initialized");

  const results = await todosTable.query()
    .where(`topic_id = '${topicId}' AND status IN ('open', 'in_progress', 'blocked')`)
    .toArray();
  return results.filter((t: any) => !t.tags?.includes("_system")).length;
}

export async function getTodoCountsByPriority(): Promise<Record<TodoPriority, number>> {
  if (!todosTable) throw new Error("Todos table not initialized");

  const results = await todosTable.query()
    .where(`status IN ('open', 'in_progress', 'blocked')`)
    .toArray();

  const todos = (results as unknown as Todo[]).filter(t => !t.tags.includes("_system"));

  const counts: Record<TodoPriority, number> = {
    urgent: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  for (const todo of todos) {
    counts[todo.priority]++;
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

  const results = await topicsTable.query().toArray();
  const topics = (results as unknown as Topic[])
    .filter(t => !t.tags.includes("_system"))
    .filter(t => t.updated_at >= cutoffISO || t.last_referenced_at >= cutoffISO);

  return topics.sort((a, b) => b.last_referenced_at.localeCompare(a.last_referenced_at));
}

export async function getStaleTopics(staleDays: number = 30): Promise<Topic[]> {
  if (!topicsTable) throw new Error("Topics table not initialized");

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - staleDays);
  const cutoffISO = cutoff.toISOString();

  const results = await topicsTable.query()
    .where(`status = 'active'`)
    .toArray();

  const topics = (results as unknown as Topic[])
    .filter(t => !t.tags.includes("_system"))
    .filter(t => t.last_referenced_at < cutoffISO);

  return topics;
}

export async function getMemoryCountSince(days: number): Promise<{ added: number; updated: number }> {
  if (!memoriesTable) throw new Error("Memories table not initialized");

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffISO = cutoff.toISOString();

  const results = await memoriesTable.query().toArray();
  const memories = (results as unknown as Memory[]).filter(m => !m.tags.includes("_system"));

  const added = memories.filter(m => m.created_at >= cutoffISO).length;
  const updated = memories.filter(m => m.updated_at >= cutoffISO && m.created_at < cutoffISO).length;

  return { added, updated };
}
