/**
 * Acceptance tests for the hardening pass:
 *   Task 1 — every SQL value is escaped; a source-level guard forbids raw
 *            interpolation.
 *   Task 2 — scanAll() returns a single consistent set, detecting a concurrent
 *            insert and retrying, and failing loudly if the set never settles.
 *
 * Run with:  npx tsx scripts/verify-hardening.ts
 * Builds a throwaway database under the system temp directory; never touches the
 * live store. Exits non-zero on first failure.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as lancedb from "@lancedb/lancedb";

import { DEFAULT_VECTOR_DIMENSIONS } from "../src/config.js";
import {
  EXCLUDE_SYSTEM_ROWS,
  SCAN_STABILITY_ATTEMPTS,
  countMemoriesByTopic,
  countOpenTodosByTopic,
  createMemory,
  createTodo,
  createTopic,
  deleteTopic,
  generateId,
  getTopicById,
  getTopicByName,
  initializeMemoryTables,
  listMemories,
  listTopics,
  nowISO,
  scanAll,
  sqlString,
  todosTable,
  topicsTable,
  updateTopic,
} from "../src/schema/memorySchema.js";
import type { Topic } from "../src/schema/memorySchema.js";
import { findSqlEscapeViolations } from "./check-sql-escaping.js";

const zeroVector = (): number[] => new Array(DEFAULT_VECTOR_DIMENSIONS).fill(0);

let checksRun = 0;
function check(label: string, body: () => void): void {
  body();
  checksRun += 1;
  console.log(`  pass   ${label}`);
}

/** Minimal Table stand-in for unit-testing scanAll's control flow. */
function stubTable(opts: { count: () => number; rows: () => unknown[] }): lancedb.Table {
  const builder = {
    where: () => builder,
    select: () => builder,
    limit: () => builder,
    toArray: async () => opts.rows(),
  };
  return {
    countRows: async () => opts.count(),
    query: () => builder,
  } as unknown as lancedb.Table;
}

// ============================================================================
// Task 1 — SQL escaping
// ============================================================================

async function task1(): Promise<void> {
  console.log("\nTask 1: SQL escaping round-trips hostile input");

  const trickyName = `O'Brien's "FALCONS" \\ Radar`;
  const topic = await createTopic({
    name: trickyName, description: "d", tags: ["it's"], status: "active", importance: 0.5,
  } as never);

  // An id that itself contains a single quote (added directly; ids are usually uuids).
  const weirdId = "id-with-'-quote";
  await topicsTable!.add([{
    id: weirdId, name: "weird", description: "d", tags: ["seed"], status: "active",
    importance: 0.5, created_at: nowISO(), updated_at: nowISO(), last_referenced_at: nowISO(),
  }] as never);

  const byName = await getTopicByName(trickyName);
  check("getTopicByName round-trips a name with quote, apostrophe and backslash", () => {
    assert.ok(byName, "expected to find the topic by its hostile name");
    assert.equal(byName!.id, topic.id);
  });

  const byWeirdId = await getTopicById(weirdId);
  check("getTopicById round-trips an id containing a single quote", () => {
    assert.ok(byWeirdId);
    assert.equal(byWeirdId!.name, "weird");
  });

  const updated = await updateTopic(weirdId, { importance: 0.9 });
  check("updateTopic targets the apostrophe id, not the wrong row", () => {
    assert.ok(updated);
    assert.equal(updated!.importance, 0.9);
  });

  await createMemory({
    topic_id: weirdId, title: "m", content: "c", kind: "insight", tags: ["it's"], importance: 0.5,
    conversation_summary: "s", supersedes_id: "none", vector: zeroVector(),
  } as never);
  const memCount = await countMemoriesByTopic(weirdId);
  check("countMemoriesByTopic handles an apostrophe topic id", () => {
    assert.equal(memCount, 1);
  });

  await createTodo({
    topic_id: weirdId, memory_id: "none", title: "t", description: "d", status: "open",
    priority: "high", due_at: null, tags: ["a"], vector: zeroVector(),
  } as never);
  const todoCount = await countOpenTodosByTopic(weirdId);
  check("countOpenTodosByTopic handles an apostrophe topic id", () => {
    assert.equal(todoCount, 1);
  });

  const nameSearch = await listTopics({ name_search: "O'Brien" });
  check("listTopics name_search matches an apostrophe query", () => {
    assert.ok(nameSearch.some((t) => t.id === topic.id));
  });

  const taggedMemories = await listMemories({ tag_filter: ["it's"] });
  check("listMemories tag_filter matches an apostrophe tag", () => {
    assert.ok(taggedMemories.length >= 1);
    assert.ok(taggedMemories.every((m) => [...m.tags].includes("it's")));
  });

  const deleted = await deleteTopic(weirdId);
  const afterDelete = await getTopicById(weirdId);
  check("deleteTopic removes exactly the apostrophe-id row", () => {
    assert.equal(deleted, true);
    assert.equal(afterDelete, null);
  });

  console.log("\nTask 1: source-level escaping guard");
  const srcRoot = fileURLToPath(new URL("../src", import.meta.url));
  const realViolations = findSqlEscapeViolations(srcRoot);
  check("guard finds zero raw SQL interpolation under src/", () => {
    assert.deepEqual(realViolations, [], `unexpected violations: ${JSON.stringify(realViolations)}`);
  });

  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlfix-"));
  // A line that splices a value straight into SQL — the exact pattern the guard forbids.
  fs.writeFileSync(path.join(fixtureDir, "bad.ts"), "const q = `id = '${userInput}'`;\n");
  const fixtureViolations = findSqlEscapeViolations(fixtureDir);
  check("guard flags a deliberately malformed fixture", () => {
    assert.equal(fixtureViolations.length, 1);
    assert.equal(fixtureViolations[0].line, 1);
  });
  fs.rmSync(fixtureDir, { recursive: true, force: true });
}

// ============================================================================
// Task 2 — scanAll consistency
// ============================================================================

async function task2(): Promise<void> {
  console.log("\nTask 2: scanAll consistency");

  let toArrayCalls = 0;
  const retryStub = stubTable({
    // matches=1, but the first read returns 2 rows (a row appeared), the second 1.
    count: () => 1,
    rows: () => (toArrayCalls++ === 0 ? [{ id: "a" }, { id: "b" }] : [{ id: "a" }]),
  });
  const retryResult = await scanAll<{ id: string }>(retryStub, "status = 'open'");
  check("scanAll retries once when the set grows, then returns the stable read", () => {
    assert.equal(toArrayCalls, 2);
    assert.equal(retryResult.length, 1);
  });

  const growStub = stubTable({ count: () => 1, rows: () => [{ id: "a" }, { id: "b" }] });
  let growError: Error | null = null;
  try {
    await scanAll(growStub, "topic_id = 'abc'");
  } catch (error) {
    growError = error as Error;
  }
  check(`scanAll throws after ${SCAN_STABILITY_ATTEMPTS} attempts, naming the filter`, () => {
    assert.ok(growError, "expected scanAll to throw when the set never settles");
    assert.match(growError!.message, /topic_id = 'abc'/);
    assert.match(growError!.message, /faster than it can be scanned/);
  });

  const scanRows = Array.from({ length: 37 }, (_, i) => ({
    id: generateId(), name: `scan-${i}`, description: "d", tags: ["scan37"], status: "active",
    importance: 0.5, created_at: nowISO(), updated_at: nowISO(), last_referenced_at: nowISO(),
  }));
  await topicsTable!.add(scanRows as never);
  const all37 = await scanAll<Topic>(topicsTable!, `array_has(tags, ${sqlString("scan37")})`);
  check("scanAll returns all 37 rows of a 37-row match set", () => {
    assert.equal(all37.length, 37);
  });

  const none = await scanAll<Topic>(topicsTable!, `array_has(tags, ${sqlString("no-such-tag")})`);
  check("scanAll returns [] for a filter matching nothing", () => {
    assert.deepEqual(none, []);
  });

  await todosTable!.add([{
    id: generateId(), topic_id: "t", memory_id: "none", title: "x", description: "d",
    status: "open", priority: "high", due_at: null, created_at: nowISO(), updated_at: nowISO(),
    completed_at: null, tags: ["projtest"], vector: zeroVector(),
  }] as never);
  const projected = await scanAll<{ priority: string }>(
    todosTable!, `array_has(tags, ${sqlString("projtest")}) AND ${EXCLUDE_SYSTEM_ROWS}`, ["priority"],
  );
  check("scanAll projection returns only the selected column", () => {
    assert.equal(projected.length, 1);
    assert.ok("priority" in projected[0]);
    assert.ok(!("title" in projected[0]));
  });
}

// ============================================================================
// Entry point
// ============================================================================

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-memory-hardening-"));
  try {
    const db = await lancedb.connect(dir);
    await initializeMemoryTables(db, DEFAULT_VECTOR_DIMENSIONS);
    await task1();
    await task2();
    console.log(`\n${checksRun} hardening checks passed against ${dir}\n`);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort temp cleanup; never mask a real check failure.
    }
  }
}

main().catch((error: unknown) => {
  console.error("\nFAILED\n");
  console.error(error);
  process.exitCode = 1;
});
