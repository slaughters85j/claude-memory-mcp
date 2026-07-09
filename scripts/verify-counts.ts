/**
 * Validation for the aggregate-count functions in src/schema/memorySchema.ts.
 *
 * Regression under test: LanceDB's query builder applies a default limit of ten
 * rows when `.limit()` is never called. Every aggregate in this module used to
 * call `table.query().where(f).toArray()` and then filter in JavaScript, so all
 * of them silently truncated at ten rows regardless of how many matched. The
 * corrected versions push their predicates into SQL and use either `countRows()`
 * or the ceiling-free `scanAll()` helper.
 *
 * Every fixture below is deliberately sized above that ten-row limit, so the
 * old implementation fails these assertions and the new one passes.
 *
 * Run with:  npx tsx scripts/verify-counts.ts
 *
 * Builds a throwaway database under the system temp directory and removes it on
 * exit. It never opens the live memory store. Exits non-zero on first failure.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as lancedb from "@lancedb/lancedb";

import { DEFAULT_VECTOR_DIMENSIONS } from "../src/config.js";
import {
  EXCLUDE_SYSTEM_ROWS,
  countMemoriesByTopic,
  countOpenTodosByTopic,
  createMemory,
  createTopic,
  generateId,
  getMemoryById,
  getMemoryCountSince,
  getTopicById,
  getRecentlyUpdatedTopics,
  getStaleTopics,
  getTodoCountsByPriority,
  initializeMemoryTables,
  listMemories,
  listTodos,
  listTopics,
  memoriesTable,
  scanAll,
  searchMemoriesVector,
  sqlString,
  todosTable,
  topicsTable,
  touchTopicLastReferenced,
  updateMemory,
  updateTopic,
} from "../src/schema/memorySchema.js";
import type {
  Memory,
  Todo,
  TodoPriority,
  TodoStatus,
  Topic,
} from "../src/schema/memorySchema.js";

// ============================================================================
// Fixture sizes. Each count that the old code would have truncated is > 10.
// ============================================================================

/** LanceDB's implicit page size when `.limit()` is omitted. Upstream behavior. */
const LANCEDB_IMPLICIT_LIMIT = 10;

const RECENT_WINDOW_DAYS = 7;
const STALE_WINDOW_DAYS = 30;

const OPEN_URGENT = 12;
const OPEN_HIGH = 9;
const OPEN_MEDIUM = 11;
const OPEN_LOW = 5;
const TAGGED_OPEN_TOTAL = OPEN_URGENT + OPEN_HIGH + OPEN_MEDIUM + OPEN_LOW;

/**
 * Rows carrying an EMPTY tags list. DataFusion's `array_has` returns NULL for
 * an empty list, so a predicate written `NOT array_has(tags, '_system')` yields
 * NULL and silently discards them. EXCLUDE_SYSTEM_ROWS must count them.
 */
const EMPTY_TAG_OPEN_TODOS = 4;
const EMPTY_TAG_MEMORIES = 3;
const EMPTY_TAG_STALE_TOPICS = 2;

/** The four empty-tag todos are seeded at medium priority. */
const EXPECTED_MEDIUM = OPEN_MEDIUM + EMPTY_TAG_OPEN_TODOS;
const OPEN_TOTAL = TAGGED_OPEN_TOTAL + EMPTY_TAG_OPEN_TODOS;

/** Closed todos, all marked urgent, so only the status filter can exclude them. */
const DONE_TODOS = 6;

/** Open todos assigned to TOPIC_A. Above the implicit limit on purpose. */
const TOPIC_A_OPEN_TODOS = 14;

const MEMORIES_ADDED_RECENTLY = 13;
const MEMORIES_UPDATED_RECENTLY = 11;
const MEMORIES_UNTOUCHED = 5;
/** Subset of the recently added memories that belong to TOPIC_A. */
const TOPIC_A_MEMORIES = 12;
/** Tagged plus untagged memories created inside the recent window. */
const EXPECTED_ADDED = MEMORIES_ADDED_RECENTLY + EMPTY_TAG_MEMORIES;

const STALE_ACTIVE_TOPICS = 13;
const OTHER_RECENT_TOPICS = 4;
/** Stale but archived. getStaleTopics must exclude these on status. */
const STALE_ARCHIVED_TOPICS = 2;
const EXPECTED_STALE = STALE_ACTIVE_TOPICS + EMPTY_TAG_STALE_TOPICS;

/** Exercises sqlString(). A raw interpolation of this id produces invalid SQL. */
const APOSTROPHE_TOPIC_ID = "o'brien";
const APOSTROPHE_MEMORIES = 3;

const TOPIC_A_ID = generateId();
const TOPIC_OTHER_ID = generateId();

// ============================================================================
// Helpers
// ============================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Negative values yield future timestamps, used for never-overdue due dates. */
const daysAgo = (n: number): string => new Date(Date.now() - n * MS_PER_DAY).toISOString();

const zeroVector = (): number[] => new Array(DEFAULT_VECTOR_DIMENSIONS).fill(0);

let checksRun = 0;

function check(label: string, body: () => void): void {
  body();
  checksRun += 1;
  console.log(`  pass   ${label}`);
}

// ============================================================================
// Fixtures
// ============================================================================

async function seedTopics(): Promise<void> {
  const rows: Topic[] = [];

  const makeTopic = (
    id: string,
    status: Topic["status"],
    ageDays: number,
    tags: string[] = ["seed"],
  ): Topic => ({
    id,
    name: `topic-${id.slice(0, 8)}`,
    description: "seeded fixture",
    tags,
    status,
    importance: 0.5,
    created_at: daysAgo(ageDays),
    updated_at: daysAgo(ageDays),
    last_referenced_at: daysAgo(ageDays),
  });

  rows.push(makeTopic(TOPIC_A_ID, "active", 1));
  rows.push(makeTopic(TOPIC_OTHER_ID, "active", 1));
  for (let i = 0; i < OTHER_RECENT_TOPICS; i += 1) rows.push(makeTopic(generateId(), "active", 1));
  for (let i = 0; i < STALE_ACTIVE_TOPICS; i += 1) rows.push(makeTopic(generateId(), "active", 90));
  for (let i = 0; i < STALE_ARCHIVED_TOPICS; i += 1) rows.push(makeTopic(generateId(), "archived", 90));
  for (let i = 0; i < EMPTY_TAG_STALE_TOPICS; i += 1) rows.push(makeTopic(generateId(), "active", 90, []));

  await topicsTable!.add(rows as unknown as Record<string, unknown>[]);
}

async function seedMemories(): Promise<void> {
  const rows: Memory[] = [];

  const makeMemory = (
    topicId: string,
    createdDaysAgo: number,
    updatedDaysAgo: number,
    tags: string[] = ["seed"],
  ): Memory => ({
    id: generateId(),
    topic_id: topicId,
    title: "seeded memory",
    content: "seeded fixture",
    kind: "insight",
    tags,
    importance: 0.5,
    created_at: daysAgo(createdDaysAgo),
    updated_at: daysAgo(updatedDaysAgo),
    conversation_summary: "seeded",
    supersedes_id: "none",
    vector: zeroVector(),
  });

  // Created inside the window. TOPIC_A_MEMORIES of them belong to TOPIC_A.
  for (let i = 0; i < MEMORIES_ADDED_RECENTLY; i += 1) {
    rows.push(makeMemory(i < TOPIC_A_MEMORIES ? TOPIC_A_ID : TOPIC_OTHER_ID, 1, 1));
  }
  // Created inside the window with no tags at all. Must still be counted.
  for (let i = 0; i < EMPTY_TAG_MEMORIES; i += 1) rows.push(makeMemory(TOPIC_OTHER_ID, 1, 1, []));
  // Created long ago, touched inside the window.
  for (let i = 0; i < MEMORIES_UPDATED_RECENTLY; i += 1) rows.push(makeMemory(TOPIC_OTHER_ID, 60, 2));
  // Created long ago, untouched.
  for (let i = 0; i < MEMORIES_UNTOUCHED; i += 1) rows.push(makeMemory(TOPIC_OTHER_ID, 60, 60));
  // Untouched, under a topic id containing a single quote.
  for (let i = 0; i < APOSTROPHE_MEMORIES; i += 1) rows.push(makeMemory(APOSTROPHE_TOPIC_ID, 60, 60));

  await memoriesTable!.add(rows as unknown as Record<string, unknown>[]);
}

async function seedTodos(): Promise<void> {
  const rows: Todo[] = [];

  const makeTodo = (
    priority: TodoPriority,
    status: TodoStatus,
    topicId: string,
    tags: string[] = ["seed"],
  ): Todo => ({
    id: generateId(),
    topic_id: topicId,
    memory_id: "none",
    title: "seeded todo",
    description: "seeded fixture",
    status,
    priority,
    due_at: daysAgo(-3650),
    created_at: daysAgo(1),
    updated_at: daysAgo(1),
    completed_at: daysAgo(1),
    tags,
    vector: zeroVector(),
  });

  const openPlan: Array<[TodoPriority, number]> = [
    ["urgent", OPEN_URGENT],
    ["high", OPEN_HIGH],
    ["medium", OPEN_MEDIUM],
    ["low", OPEN_LOW],
  ];

  let openIndex = 0;
  for (const [priority, count] of openPlan) {
    for (let i = 0; i < count; i += 1) {
      const topicId = openIndex < TOPIC_A_OPEN_TODOS ? TOPIC_A_ID : TOPIC_OTHER_ID;
      rows.push(makeTodo(priority, "open", topicId));
      openIndex += 1;
    }
  }

  // Urgent but closed. Only the status predicate can exclude these.
  for (let i = 0; i < DONE_TODOS; i += 1) rows.push(makeTodo("urgent", "done", TOPIC_A_ID));

  // Open, medium priority, no tags at all. Assigned to TOPIC_OTHER so they do
  // not perturb TOPIC_A_OPEN_TODOS. A `NOT array_has(...)` predicate loses them.
  for (let i = 0; i < EMPTY_TAG_OPEN_TODOS; i += 1) {
    rows.push(makeTodo("medium", "open", TOPIC_OTHER_ID, []));
  }

  await todosTable!.add(rows as unknown as Record<string, unknown>[]);
}

// ============================================================================
// Assertions
// ============================================================================

async function runChecks(): Promise<void> {
  console.log("\nsqlString escaping");
  check("doubles an embedded single quote", () => {
    assert.equal(sqlString(APOSTROPHE_TOPIC_ID), "'o''brien'");
    assert.equal(sqlString("plain"), "'plain'");
  });

  await assert.rejects(
    async () => memoriesTable!.countRows(`topic_id = '${APOSTROPHE_TOPIC_ID}'`),
    "raw interpolation of an apostrophe must produce invalid SQL, proving the escape is load-bearing",
  );
  checksRun += 1;
  console.log("  pass   raw interpolation of an apostrophe is rejected by the engine");

  console.log("\nempty tag lists (array_has NULL semantics)");
  const safeCount = await todosTable!.countRows(EXCLUDE_SYSTEM_ROWS);
  const naiveCount = await todosTable!.countRows("NOT array_has(tags, '_system')");
  check("EXCLUDE_SYSTEM_ROWS uses IS NOT TRUE, not a bare NOT", () => {
    assert.match(EXCLUDE_SYSTEM_ROWS, /IS NOT TRUE/);
  });
  check(`the bare NOT form silently drops the ${EMPTY_TAG_OPEN_TODOS} untagged todos`, () => {
    assert.equal(
      safeCount - naiveCount,
      EMPTY_TAG_OPEN_TODOS,
      "if this stops holding, DataFusion changed array_has() null semantics for empty lists",
    );
  });

  console.log("\nupstream LanceDB behavior");
  const naive = await todosTable!.query().where("status = 'open'").toArray();
  check(`query() without .limit() truncates to ${LANCEDB_IMPLICIT_LIMIT} of ${OPEN_TOTAL} matches`, () => {
    assert.equal(naive.length, LANCEDB_IMPLICIT_LIMIT);
  });

  console.log("\ngetTodoCountsByPriority");
  const counts = await getTodoCountsByPriority();
  check("returns exact per-priority counts above the implicit limit", () => {
    assert.deepEqual(counts, {
      urgent: OPEN_URGENT,
      high: OPEN_HIGH,
      medium: EXPECTED_MEDIUM,
      low: OPEN_LOW,
    });
  });
  check("untagged open todos are counted, not dropped", () => {
    assert.equal(counts.medium, OPEN_MEDIUM + EMPTY_TAG_OPEN_TODOS);
  });
  check("total open exceeds the implicit limit", () => {
    const total = counts.urgent + counts.high + counts.medium + counts.low;
    assert.equal(total, OPEN_TOTAL);
    assert.ok(total > LANCEDB_IMPLICIT_LIMIT);
  });
  check("closed todos are excluded by status, not by priority", () => {
    assert.equal(counts.urgent, OPEN_URGENT, `${DONE_TODOS} done urgent todos must not be counted`);
  });

  console.log("\ncountOpenTodosByTopic");
  const topicAOpen = await countOpenTodosByTopic(TOPIC_A_ID);
  check(`returns ${TOPIC_A_OPEN_TODOS} open todos, not ${LANCEDB_IMPLICIT_LIMIT}`, () => {
    assert.equal(topicAOpen, TOPIC_A_OPEN_TODOS);
    assert.ok(topicAOpen > LANCEDB_IMPLICIT_LIMIT);
  });
  check("closed todos on the same topic are excluded", () => {
    assert.equal(topicAOpen, TOPIC_A_OPEN_TODOS, `${DONE_TODOS} done todos also carry TOPIC_A_ID`);
  });

  console.log("\ncountMemoriesByTopic");
  const topicAMemories = await countMemoriesByTopic(TOPIC_A_ID);
  const apostropheMemories = await countMemoriesByTopic(APOSTROPHE_TOPIC_ID);
  check(`returns ${TOPIC_A_MEMORIES} memories, above the implicit limit`, () => {
    assert.equal(topicAMemories, TOPIC_A_MEMORIES);
    assert.ok(topicAMemories > LANCEDB_IMPLICIT_LIMIT);
  });
  check("a topic id containing an apostrophe is counted correctly", () => {
    assert.equal(apostropheMemories, APOSTROPHE_MEMORIES);
  });

  console.log("\ngetMemoryCountSince");
  const activity = await getMemoryCountSince(RECENT_WINDOW_DAYS);
  check("separates newly created from newly updated, counting untagged rows", () => {
    assert.deepEqual(activity, {
      added: EXPECTED_ADDED,
      updated: MEMORIES_UPDATED_RECENTLY,
    });
    assert.ok(activity.added > LANCEDB_IMPLICIT_LIMIT);
    assert.ok(activity.updated > LANCEDB_IMPLICIT_LIMIT);
  });

  console.log("\ngetStaleTopics");
  const stale = await getStaleTopics(STALE_WINDOW_DAYS);
  check(`returns all ${EXPECTED_STALE} stale topics, including the untagged ones`, () => {
    assert.equal(stale.length, EXPECTED_STALE);
    assert.ok(stale.length > LANCEDB_IMPLICIT_LIMIT);
    assert.equal(stale.filter((t) => t.tags.length === 0).length, EMPTY_TAG_STALE_TOPICS);
  });
  check("excludes archived topics and the _system row", () => {
    assert.ok(stale.every((t) => t.status === "active"));
    assert.ok(stale.every((t) => !t.tags.includes("_system")));
  });

  console.log("\ngetRecentlyUpdatedTopics");
  const recent = await getRecentlyUpdatedTopics(RECENT_WINDOW_DAYS);
  const expectedRecent = 2 + OTHER_RECENT_TOPICS;
  check(`returns the ${expectedRecent} recent topics, sorted by last reference`, () => {
    assert.equal(recent.length, expectedRecent);
    assert.ok(recent.every((t) => !t.tags.includes("_system")));
    const refs = recent.map((t) => t.last_referenced_at);
    assert.deepEqual(refs, [...refs].sort().reverse());
  });

  console.log("\nscanAll");
  const openRows = await scanAll<Todo>(todosTable!, `status = 'open' AND ${EXCLUDE_SYSTEM_ROWS}`);
  check(`returns all ${OPEN_TOTAL} rows with no ceiling`, () => {
    assert.equal(openRows.length, OPEN_TOTAL);
    assert.ok(openRows.every((t) => !t.tags.includes("_system")));
  });

  const none = await scanAll<Todo>(todosTable!, "status = 'open' AND title = 'no-such-title'");
  check("returns an empty array when nothing matches", () => {
    assert.deepEqual(none, []);
  });

  // ==========================================================================
  // List/search functions: predicates pushed into SQL. The old code fetched
  // limit*2 rows and filtered in JavaScript, so any of these above the implicit
  // ten-row limit would have truncated. limit is set well above the fixtures so
  // that a correct implementation returns every match.
  // ==========================================================================

  console.log("\nlistTodos (predicates in SQL, no implicit ceiling)");
  const openList = await listTodos({ status_filter: ["open"], limit: 100 });
  check(`returns all ${OPEN_TOTAL} open todos, not a truncated page`, () => {
    assert.equal(openList.length, OPEN_TOTAL);
    assert.ok(openList.length > LANCEDB_IMPLICIT_LIMIT);
    assert.ok(openList.every((t) => t.status === "open"));
    assert.ok(openList.every((t) => !t.tags.includes("_system")));
  });
  const taggedOpen = await listTodos({ status_filter: ["open"], tag_filter: ["seed"], limit: 100 });
  check(`tag_filter runs in SQL: ${TAGGED_OPEN_TOTAL} tagged, dropping the ${EMPTY_TAG_OPEN_TODOS} untagged`, () => {
    assert.equal(taggedOpen.length, TAGGED_OPEN_TOTAL);
    assert.ok(taggedOpen.every((t) => t.tags.includes("seed")));
  });

  console.log("\nlistMemories (since window in SQL)");
  const recentMemories = await listMemories({ since: daysAgo(RECENT_WINDOW_DAYS), limit: 100 });
  const expectedRecentMemories =
    MEMORIES_ADDED_RECENTLY + EMPTY_TAG_MEMORIES + MEMORIES_UPDATED_RECENTLY;
  check(`returns all ${expectedRecentMemories} recently-updated memories`, () => {
    assert.equal(recentMemories.length, expectedRecentMemories);
    assert.ok(recentMemories.length > LANCEDB_IMPLICIT_LIMIT);
    assert.ok(recentMemories.every((m) => !m.tags.includes("_system")));
  });

  console.log("\nlistTopics (name_search in SQL)");
  const seededTopics =
    2 + OTHER_RECENT_TOPICS + STALE_ACTIVE_TOPICS + STALE_ARCHIVED_TOPICS + EMPTY_TAG_STALE_TOPICS;
  const named = await listTopics({ name_search: "topic", limit: 100 });
  check(`contains() matches all ${seededTopics} seeded topics, none truncated`, () => {
    assert.equal(named.length, seededTopics);
    assert.ok(named.length > LANCEDB_IMPLICIT_LIMIT);
    assert.ok(named.every((t) => !t.tags.includes("_system")));
  });

  console.log("\nsearchMemoriesVector (prefilter, no under-return)");
  const nearAll = await searchMemoriesVector(zeroVector(), { topic_id: TOPIC_A_ID }, 100);
  const nearFew = await searchMemoriesVector(zeroVector(), { topic_id: TOPIC_A_ID }, 5);
  check(`prefilter returns all ${TOPIC_A_MEMORIES} matches; limit caps among matches`, () => {
    assert.equal(nearAll.length, TOPIC_A_MEMORIES);
    assert.equal(nearFew.length, 5);
    assert.ok(nearAll.every((m) => m.topic_id === TOPIC_A_ID));
    assert.ok(nearAll.every((m) => !m.tags.includes("_system")));
  });

  console.log("\ndedup headroom (transient delete+add duplicates)");
  const DUP_TAG = "duptest";
  const dupId = generateId();
  const makeDupTopic = (id: string): Topic => ({
    id,
    name: `dup-${id.slice(0, 8)}`,
    description: "duplicate fixture",
    tags: [DUP_TAG],
    status: "active",
    importance: 0.5,
    created_at: daysAgo(1),
    updated_at: daysAgo(1),
    last_referenced_at: daysAgo(1),
  });
  // A duplicate-id pair (the delete+add artifact) plus two distinct rows, all
  // tagged DUP_TAG: four physical rows, three distinct ids.
  await topicsTable!.add([
    makeDupTopic(dupId),
    makeDupTopic(dupId),
    makeDupTopic(generateId()),
    makeDupTopic(generateId()),
  ] as unknown as Record<string, unknown>[]);
  const dupPage = await listTopics({ tag_filter: [DUP_TAG], limit: 2 });
  check("returns a full page of distinct rows despite a duplicate-id pair", () => {
    assert.equal(dupPage.length, 2);
    assert.equal(new Set(dupPage.map((t) => t.id)).size, 2);
  });

  console.log("\natomic updates (no duplicate rows under concurrency)");
  const raceId = generateId();
  await topicsTable!.add([
    {
      id: raceId,
      name: "race",
      description: "race fixture",
      tags: ["seed"],
      status: "active",
      importance: 0.5,
      created_at: daysAgo(1),
      updated_at: daysAgo(1),
      last_referenced_at: daysAgo(1),
    },
  ] as unknown as Record<string, unknown>[]);
  // Fire many concurrent touches and updates at one id. The old delete+add
  // pattern interleaved into duplicate rows; mergeInsert/update commit atomically,
  // so the row count must stay at exactly one.
  // Promise.all rejects if any op exhausts its conflict retries, so a clean
  // resolve also asserts the retry wrapper actually resolves the races.
  await Promise.all([
    ...Array.from({ length: 5 }, () => touchTopicLastReferenced(raceId)),
    ...Array.from({ length: 3 }, (_, i) => updateTopic(raceId, { description: `edit-${i}` })),
  ]);
  const raceCount = await topicsTable!.countRows(`id = ${sqlString(raceId)}`);
  check("concurrent touch+update on one id leaves exactly one row", () => {
    assert.equal(raceCount, 1);
  });

  console.log("\ncolumn-update fidelity (tags preserved, null vectors tolerated)");
  const fidTopic = await createTopic({
    name: "fidelity",
    description: "d",
    tags: ["alpha", "beta"],
    status: "active",
    importance: 0.5,
  } as never);
  await updateTopic(fidTopic.id, { importance: 0.9 });
  const afterImportance = await getTopicById(fidTopic.id);
  check("updateTopic leaves untouched tags intact (no Arrow-proxy corruption)", () => {
    assert.deepEqual([...afterImportance!.tags], ["alpha", "beta"]);
    assert.equal(afterImportance!.importance, 0.9);
  });
  await updateTopic(fidTopic.id, { tags: ["gamma"] });
  const afterTags = await getTopicById(fidTopic.id);
  check("updateTopic can change the tags list", () => {
    assert.deepEqual([...afterTags!.tags], ["gamma"]);
  });

  const vecMemory = await createMemory({
    topic_id: fidTopic.id,
    title: "m",
    content: "c",
    kind: "insight",
    tags: ["x", "y"],
    importance: 0.5,
    conversation_summary: "s",
    supersedes_id: "none",
    vector: zeroVector(),
  } as never);
  await updateMemory(vecMemory.id, { importance: 0.8 });
  const afterMem = await getMemoryById(vecMemory.id);
  check("updateMemory preserves tags and vector when updating a scalar column", () => {
    assert.equal(afterMem!.importance, 0.8);
    assert.deepEqual([...afterMem!.tags], ["x", "y"]);
    assert.equal((afterMem!.vector as number[]).length, DEFAULT_VECTOR_DIMENSIONS);
  });

  // The content-edit path recomputes the embedding and updates the vector column;
  // 0.5 is exactly representable in float32, so it compares cleanly.
  await updateMemory(vecMemory.id, {
    content: "edited",
    vector: new Array(DEFAULT_VECTOR_DIMENSIONS).fill(0.5),
  } as never);
  const afterVec = await getMemoryById(vecMemory.id);
  check("updateMemory writes a new vector correctly (content-edit path)", () => {
    assert.equal(afterVec!.content, "edited");
    assert.equal(Array.from(afterVec!.vector as Iterable<number>)[0], 0.5);
  });
}

// ============================================================================
// Entry point
// ============================================================================

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-memory-verify-"));
  try {
    const db = await lancedb.connect(dir);
    await initializeMemoryTables(db, DEFAULT_VECTOR_DIMENSIONS);

    await seedTopics();
    await seedMemories();
    await seedTodos();

    await runChecks();

    console.log(`\n${checksRun} checks passed against ${dir}\n`);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort temp cleanup; never let it mask a real check failure.
    }
  }
}

main().catch((error: unknown) => {
  console.error("\nFAILED\n");
  console.error(error);
  process.exitCode = 1;
});
