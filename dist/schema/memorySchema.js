import { v4 as uuidv4 } from "uuid";
// ============================================================================
// Table Names
// ============================================================================
export const TOPICS_TABLE_NAME = "topics";
export const MEMORIES_TABLE_NAME = "memories";
export const TODOS_TABLE_NAME = "todos";
// ============================================================================
// Table References (populated by initializeMemoryTables)
// ============================================================================
export let topicsTable = null;
export let memoriesTable = null;
export let todosTable = null;
// ============================================================================
// Helper Functions
// ============================================================================
export function generateId() {
    return uuidv4();
}
export function nowISO() {
    return new Date().toISOString();
}
/**
 * Escape a value for use as a SQL string literal in a LanceDB filter.
 * DataFusion follows the SQL standard, where an embedded single quote is
 * escaped by doubling it.
 */
export function sqlString(value) {
    return `'${value.replace(/'/g, "''")}'`;
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
/**
 * Return every row matching `filter`, with no implicit ceiling.
 *
 * LanceDB's query builder applies a default limit of 10 when `.limit()` is
 * never called, so `table.query().where(f).toArray()` silently yields only the
 * first ten matches. Counting the matches first and then requesting exactly
 * that many rows keeps the scan bounded without inventing an arbitrary maximum.
 */
export async function scanAll(table, filter) {
    const matches = await table.countRows(filter);
    if (matches === 0)
        return [];
    const rows = await table.query().where(filter).limit(matches).toArray();
    return rows;
}
/**
 * `column IN ('a', 'b', ...)` with every value escaped. Used for status,
 * priority, kind and topic-id membership tests pushed into SQL.
 */
export function inListSQL(column, values) {
    return `${column} IN (${values.map(sqlString).join(", ")})`;
}
/**
 * Conjunction of `array_has` clauses requiring every tag to be present — the
 * SQL equivalent of `tags.every(t => row.tags.includes(t))`, so tag filtering
 * runs in the engine instead of over an already-truncated page of rows.
 */
export function requireAllTagsSQL(tags) {
    return tags.map((tag) => `array_has(tags, ${sqlString(tag)})`).join(" AND ");
}
/**
 * Drop rows whose id was already seen. The delete+add update pattern can
 * transiently surface an old and a new copy of the same row; this collapses
 * them. It is the only post-fetch reducer left on the list queries now that
 * all predicates are pushed into SQL, so it can no longer cause the wholesale
 * under-return the old "fetch limit*2, then filter" pattern did.
 */
export function dedupById(rows) {
    const seen = new Set();
    return rows.filter((row) => {
        if (seen.has(row.id))
            return false;
        seen.add(row.id);
        return true;
    });
}
// Priority ordering for sorting
export const PRIORITY_ORDER = {
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
export function stripTodoVector(todo) {
    const { vector: _v, ...rest } = todo;
    return rest;
}
/** Strip the vector field from a single Memory */
export function stripMemoryVector(memory) {
    const { vector: _v, ...rest } = memory;
    return rest;
}
/** Strip vector fields from an array of Todos */
export function stripTodoVectors(todos) {
    return todos.map(stripTodoVector);
}
/** Strip vector fields from an array of Memories */
export function stripMemoryVectors(memories) {
    return memories.map(stripMemoryVector);
}
// ============================================================================
// Schema Initialization
// ============================================================================
async function tableExists(db, tableName) {
    try {
        const tables = await db.tableNames();
        return tables.includes(tableName);
    }
    catch {
        return false;
    }
}
export async function initializeMemoryTables(db, vectorDimensions) {
    const now = nowISO();
    // Initialize topics table (no vectors)
    if (!(await tableExists(db, TOPICS_TABLE_NAME))) {
        console.error(`Creating ${TOPICS_TABLE_NAME} table...`);
        const initialTopic = {
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
        topicsTable = await db.createTable(TOPICS_TABLE_NAME, [initialTopic]);
    }
    else {
        topicsTable = await db.openTable(TOPICS_TABLE_NAME);
    }
    // Initialize memories table (with vectors)
    // Note: LanceDB requires non-null values to infer column types on creation
    // We use placeholder values that will be filtered out by the _system tag
    if (!(await tableExists(db, MEMORIES_TABLE_NAME))) {
        console.error(`Creating ${MEMORIES_TABLE_NAME} table...`);
        const zeroVector = new Array(vectorDimensions).fill(0);
        const initialMemory = {
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
        memoriesTable = await db.createTable(MEMORIES_TABLE_NAME, [initialMemory]);
    }
    else {
        memoriesTable = await db.openTable(MEMORIES_TABLE_NAME);
    }
    // Initialize todos table (with vectors)
    if (!(await tableExists(db, TODOS_TABLE_NAME))) {
        console.error(`Creating ${TODOS_TABLE_NAME} table...`);
        const zeroVector = new Array(vectorDimensions).fill(0);
        const initialTodo = {
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
        todosTable = await db.createTable(TODOS_TABLE_NAME, [initialTodo]);
    }
    else {
        todosTable = await db.openTable(TODOS_TABLE_NAME);
    }
    console.error("Memory tables initialized successfully");
}
// ============================================================================
// CRUD Operations for Topics
// ============================================================================
export async function createTopic(data) {
    if (!topicsTable)
        throw new Error("Topics table not initialized");
    const now = nowISO();
    const topic = {
        id: generateId(),
        ...data,
        created_at: now,
        updated_at: now,
        last_referenced_at: now,
    };
    await topicsTable.add([topic]);
    return topic;
}
export async function updateTopic(id, updates) {
    if (!topicsTable)
        throw new Error("Topics table not initialized");
    const existing = await getTopicById(id);
    if (!existing)
        return null;
    const updated = {
        ...existing,
        ...updates,
        updated_at: nowISO(),
    };
    // LanceDB update requires delete + add for full record updates
    await topicsTable.delete(`id = '${id}'`);
    await topicsTable.add([updated]);
    return updated;
}
export async function getTopicById(id) {
    if (!topicsTable)
        throw new Error("Topics table not initialized");
    const results = await topicsTable.query().where(`id = '${id}'`).limit(1).toArray();
    return results.length > 0 ? results[0] : null;
}
export async function getTopicByName(name) {
    if (!topicsTable)
        throw new Error("Topics table not initialized");
    const results = await topicsTable.query().where(`name = '${name}'`).limit(1).toArray();
    return results.length > 0 ? results[0] : null;
}
export async function listTopics(filters) {
    if (!topicsTable)
        throw new Error("Topics table not initialized");
    const limit = filters.limit ?? 20;
    // Every predicate is pushed into SQL so `.limit(limit)` is applied after
    // filtering, not before. The old code fetched limit*2 rows and filtered in
    // JavaScript, which under-returned whenever the residual filters rejected
    // more than half the page.
    const conditions = [EXCLUDE_SYSTEM_ROWS];
    if (filters.status_filter && filters.status_filter.length > 0) {
        conditions.push(inListSQL("status", filters.status_filter));
    }
    if (filters.min_importance !== undefined) {
        conditions.push(`importance >= ${filters.min_importance}`);
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
    return dedupById(rows);
}
export async function deleteTopic(id) {
    if (!topicsTable)
        throw new Error("Topics table not initialized");
    await topicsTable.delete(`id = '${id}'`);
    return true;
}
export async function touchTopicLastReferenced(id) {
    if (!topicsTable)
        throw new Error("Topics table not initialized");
    const existing = await getTopicById(id);
    if (!existing)
        return;
    const updated = {
        ...existing,
        last_referenced_at: nowISO(),
    };
    await topicsTable.delete(`id = '${id}'`);
    await topicsTable.add([updated]);
}
// ============================================================================
// CRUD Operations for Memories
// ============================================================================
export async function createMemory(data) {
    if (!memoriesTable)
        throw new Error("Memories table not initialized");
    const now = nowISO();
    const memory = {
        id: generateId(),
        ...data,
        created_at: now,
        updated_at: now,
    };
    await memoriesTable.add([memory]);
    return memory;
}
export async function updateMemory(id, updates) {
    if (!memoriesTable)
        throw new Error("Memories table not initialized");
    const existing = await getMemoryById(id);
    if (!existing)
        return null;
    const updated = {
        ...existing,
        ...updates,
        updated_at: nowISO(),
    };
    // LanceDB update requires delete + add for full record updates
    await memoriesTable.delete(`id = '${id}'`);
    await memoriesTable.add([updated]);
    return updated;
}
export async function getMemoryById(id) {
    if (!memoriesTable)
        throw new Error("Memories table not initialized");
    const results = await memoriesTable.query().where(`id = '${id}'`).limit(1).toArray();
    return results.length > 0 ? results[0] : null;
}
export async function listMemories(filters) {
    if (!memoriesTable)
        throw new Error("Memories table not initialized");
    const limit = filters.limit ?? 20;
    const conditions = [EXCLUDE_SYSTEM_ROWS];
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
        conditions.push(`importance >= ${filters.min_importance}`);
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
    return dedupById(rows);
}
export async function searchMemoriesVector(queryVector, filters, limit = 10) {
    if (!memoriesTable)
        throw new Error("Memories table not initialized");
    const conditions = [EXCLUDE_SYSTEM_ROWS];
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
        conditions.push(`importance >= ${filters.min_importance}`);
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
    return dedupById(rows);
}
export async function deleteMemory(id) {
    if (!memoriesTable)
        throw new Error("Memories table not initialized");
    await memoriesTable.delete(`id = '${id}'`);
    return true;
}
export async function getMemoriesBySupersedes(supersededId) {
    if (!memoriesTable)
        throw new Error("Memories table not initialized");
    const results = await memoriesTable.query().where(`supersedes_id = '${supersededId}'`).limit(1).toArray();
    return results.length > 0 ? results[0] : null;
}
export async function countMemoriesByTopic(topicId) {
    if (!memoriesTable)
        throw new Error("Memories table not initialized");
    return await memoriesTable.countRows(`topic_id = ${sqlString(topicId)} AND ${EXCLUDE_SYSTEM_ROWS}`);
}
// ============================================================================
// CRUD Operations for Todos
// ============================================================================
export async function createTodo(data) {
    if (!todosTable)
        throw new Error("Todos table not initialized");
    const now = nowISO();
    const todo = {
        id: generateId(),
        ...data,
        created_at: now,
        updated_at: now,
        completed_at: null,
    };
    await todosTable.add([todo]);
    return todo;
}
export async function updateTodo(id, updates) {
    if (!todosTable)
        throw new Error("Todos table not initialized");
    const existing = await getTodoById(id);
    if (!existing)
        return null;
    const now = nowISO();
    let completedAt = existing.completed_at;
    // Handle status transitions
    if (updates.status) {
        if ((updates.status === "done" || updates.status === "cancelled") && !existing.completed_at) {
            completedAt = now;
        }
        else if (updates.status === "open" || updates.status === "in_progress" || updates.status === "blocked") {
            completedAt = null;
        }
    }
    const updated = {
        ...existing,
        ...updates,
        updated_at: now,
        completed_at: completedAt,
    };
    // LanceDB update requires delete + add for full record updates
    await todosTable.delete(`id = '${id}'`);
    await todosTable.add([updated]);
    return updated;
}
export async function getTodoById(id) {
    if (!todosTable)
        throw new Error("Todos table not initialized");
    const results = await todosTable.query().where(`id = '${id}'`).limit(1).toArray();
    return results.length > 0 ? results[0] : null;
}
export async function listTodos(filters) {
    if (!todosTable)
        throw new Error("Todos table not initialized");
    const limit = filters.limit ?? 20;
    const conditions = [EXCLUDE_SYSTEM_ROWS];
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
        conditions.push(`due_at < ${sqlString(nowISO())} ` +
            `AND status IN ('open', 'in_progress', 'blocked')`);
    }
    if (filters.tag_filter && filters.tag_filter.length > 0) {
        conditions.push(requireAllTagsSQL(filters.tag_filter));
    }
    const rows = await todosTable
        .query()
        .where(conditions.join(" AND "))
        .limit(limit)
        .toArray();
    return dedupById(rows);
}
export async function deleteTodo(id) {
    if (!todosTable)
        throw new Error("Todos table not initialized");
    await todosTable.delete(`id = '${id}'`);
    return true;
}
export async function countOpenTodosByTopic(topicId) {
    if (!todosTable)
        throw new Error("Todos table not initialized");
    return await todosTable.countRows(`topic_id = ${sqlString(topicId)} ` +
        `AND status IN ('open', 'in_progress', 'blocked') ` +
        `AND ${EXCLUDE_SYSTEM_ROWS}`);
}
export async function getTodoCountsByPriority() {
    if (!todosTable)
        throw new Error("Todos table not initialized");
    const table = todosTable;
    const priorities = ["urgent", "high", "medium", "low"];
    const entries = await Promise.all(priorities.map(async (priority) => [
        priority,
        await table.countRows(`status IN ('open', 'in_progress', 'blocked') ` +
            `AND priority = ${sqlString(priority)} ` +
            `AND ${EXCLUDE_SYSTEM_ROWS}`),
    ]));
    return Object.fromEntries(entries);
}
export async function getOverdueTodos() {
    return listTodos({
        status_filter: ["open", "in_progress", "blocked"],
        overdue_only: true,
        limit: 50,
    });
}
export async function getHighPriorityTodos() {
    return listTodos({
        status_filter: ["open", "in_progress", "blocked"],
        priority_filter: ["urgent", "high"],
        limit: 50,
    });
}
// ============================================================================
// Aggregate Queries
// ============================================================================
export async function getRecentlyUpdatedTopics(days = 7) {
    if (!topicsTable)
        throw new Error("Topics table not initialized");
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffISO = cutoff.toISOString();
    const since = sqlString(cutoffISO);
    const topics = await scanAll(topicsTable, `(updated_at >= ${since} OR last_referenced_at >= ${since}) AND ${EXCLUDE_SYSTEM_ROWS}`);
    return topics.sort((a, b) => b.last_referenced_at.localeCompare(a.last_referenced_at));
}
export async function getStaleTopics(staleDays = 30) {
    if (!topicsTable)
        throw new Error("Topics table not initialized");
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - staleDays);
    const cutoffISO = cutoff.toISOString();
    return await scanAll(topicsTable, `status = 'active' ` +
        `AND last_referenced_at < ${sqlString(cutoffISO)} ` +
        `AND ${EXCLUDE_SYSTEM_ROWS}`);
}
export async function getMemoryCountSince(days) {
    if (!memoriesTable)
        throw new Error("Memories table not initialized");
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffISO = cutoff.toISOString();
    const table = memoriesTable;
    const since = sqlString(cutoffISO);
    const [added, updated] = await Promise.all([
        table.countRows(`created_at >= ${since} AND ${EXCLUDE_SYSTEM_ROWS}`),
        table.countRows(`updated_at >= ${since} AND created_at < ${since} AND ${EXCLUDE_SYSTEM_ROWS}`),
    ]);
    return { added, updated };
}
