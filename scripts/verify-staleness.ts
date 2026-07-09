/**
 * Acceptance tests for fix/stale-table-handles.
 *
 *   Task 1 — refreshTables() advances a stale handle to the latest committed
 *            version; a read alone never does.
 *   Task 2 — runExclusive() serializes handler bodies so a refresh never fires
 *            inside another handler's scan.
 *   Task 3 — withCommitRetry() only resolves a stale update conflict because it
 *            refreshes the handle before retrying; delete the refresh and the
 *            identical conflict recurs until the loop gives up.
 *   Task 4 — a durable write followed by a failing last_referenced_at touch is
 *            reported as success, exactly once, with a warning to stderr.
 *
 * Run with:  npx tsx scripts/verify-staleness.ts
 * Builds throwaway databases under the system temp directory; never touches the
 * live store. Exits non-zero on the first failed assertion.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as lancedb from "@lancedb/lancedb";

import { DEFAULT_VECTOR_DIMENSIONS } from "../src/config.js";
import {
  createMemory,
  createTopic,
  initializeMemoryTables,
  isCommitConflict,
  memoriesTable,
  refreshTables,
  safeTouchTopicLastReferenced,
  topicsTable,
  withCommitRetry,
} from "../src/schema/memorySchema.js";
import { runExclusive } from "../src/concurrency.js";
import { safeEmbed } from "../src/embeddings/index.js";
import { AddMemoryTool } from "../src/tools/operations/memories.js";

let checksRun = 0;
function check(label: string, condition: boolean, detail = ""): void {
  if (!condition) throw new Error(`FAILED: ${label}${detail ? ` — ${detail}` : ""}`);
  checksRun += 1;
  console.log(`  pass   ${label}`);
}

function mkdb(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function manifestsOnDisk(dbDir: string, table: string): string[] {
  try {
    return fs.readdirSync(path.join(dbDir, `${table}.lance`, "_versions")).sort();
  } catch {
    return [];
  }
}

const seedRow = (id: string, n: number) => ({ id, n, v: [n / 10, n / 10] });

// ============================================================================
// Task 1 — refreshTables() / checkoutLatest semantics, and the null guard
// ============================================================================

async function nullGuard(): Promise<void> {
  console.log("\nTask 1: refreshTables() null-handle guard");
  // Before any initializeMemoryTables, the module handles are null.
  let threw = false;
  try {
    await refreshTables();
  } catch (error) {
    threw = /not initialized/.test((error as Error).message);
  }
  check("refreshTables() throws the 'not initialized' error when a handle is null", threw);
}

async function checkoutSemantics(): Promise<void> {
  console.log("\nTask 1: a read does not advance a handle; checkoutLatest() does");
  const dir = mkdb("stale-checkout-");
  const connA = await lancedb.connect(dir);
  const connB = await lancedb.connect(dir);
  const a = await connA.createTable("t", [seedRow("x", 1), seedRow("y", 2), seedRow("z", 3)]);
  const b = await connB.openTable("t");

  const v0 = await b.version();
  const c0 = await b.countRows();
  await a.add([seedRow("a1", 4)]);
  await a.add([seedRow("a2", 5)]);

  // A read on B (countRows) must not have advanced it.
  check("stale handle still reports the old row count after the writer appended", (await b.countRows()) === c0, `got ${await b.countRows()}, expected ${c0}`);
  check("stale handle still reports the old version", (await b.version()) === v0, `got ${await b.version()}, expected ${v0}`);

  const manifests = manifestsOnDisk(dir, "t");
  check("both the old and new manifests exist on disk (B read valid data, not corrupt)", manifests.includes("1.manifest") && manifests.includes("3.manifest"), manifests.join(","));

  await b.checkoutLatest();
  check("checkoutLatest() brings the handle current (count)", (await b.countRows()) === c0 + 2);
  check("checkoutLatest() brings the handle current (version)", (await b.version()) > v0);

  fs.rmSync(dir, { recursive: true, force: true });
}

async function refreshTablesReal(): Promise<void> {
  console.log("\nTask 1: refreshTables() advances the live module handles");
  const dir = mkdb("stale-refresh-");
  const db = await lancedb.connect(dir);
  await initializeMemoryTables(db, DEFAULT_VECTOR_DIMENSIONS);
  const before = await topicsTable!.countRows();

  // A second connection writes a topic; the module handle cannot see it yet.
  const other = await lancedb.connect(dir);
  const otherTopics = await other.openTable("topics");
  await otherTopics.add([{
    id: "refresh-probe", name: "refresh-probe", description: "d", tags: ["probe"], status: "active",
    importance: 0.5, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    last_referenced_at: new Date().toISOString(),
  }]);

  check("module topics handle is stale before refresh", (await topicsTable!.countRows()) === before);
  await refreshTables();
  check("refreshTables() makes the module topics handle see the other writer's row", (await topicsTable!.countRows()) === before + 1);

  fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================================
// Task 1/appends — an append from a stale handle commutes, losing no rows
// ============================================================================

async function appendCommutes(): Promise<void> {
  console.log("\nTask 1: an append from a stale handle commutes (no lost rows)");
  const dir = mkdb("stale-append-");
  const connA = await lancedb.connect(dir);
  const connB = await lancedb.connect(dir);
  const a = await connA.createTable("t", [seedRow("x", 1)]);
  const b = await connB.openTable("t");

  await a.add([seedRow("a1", 2)]); // B is now stale
  await b.add([seedRow("b1", 3)]); // append from the stale handle
  await a.checkoutLatest();
  await b.checkoutLatest();

  const ids = (await a.query().limit(100).toArray()).map((r: any) => String(r.id)).sort();
  check("the other writer's row survives the stale-handle append", ids.includes("a1"));
  check("the stale handle's own append survives", ids.includes("b1"));
  check("no rows lost (x, a1, b1 all present)", ids.length === 3, ids.join(","));

  fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================================
// Task 3 — withCommitRetry regression guard
// ============================================================================

/** Build two handles to one row, then commit a conflicting update from the first
 *  so the second is genuinely stale on that row. */
async function twoStaleHandles(dir: string, table: string): Promise<lancedb.Table> {
  const connWriter = await lancedb.connect(dir);
  const connStale = await lancedb.connect(dir);
  const writer = await connWriter.createTable(table, [seedRow("r", 0)]);
  const stale = await connStale.openTable(table);
  await writer.update({ where: "id = 'r'", values: { n: 1 } }); // stale now behind on row r
  return stale;
}

async function commitRetryGuard(): Promise<void> {
  console.log("\nTask 3: withCommitRetry resolves a stale conflict only with the refresh");
  const dir = mkdb("stale-retry-");

  // With the refresh present, the retry succeeds.
  const staleA = await twoStaleHandles(dir, "with_refresh");
  let succeeded = false;
  try {
    await withCommitRetry(
      () => staleA.update({ where: "id = 'r'", values: { n: 2 } }),
      () => staleA.checkoutLatest(),
    );
    succeeded = true;
  } catch {
    succeeded = false;
  }
  check("withCommitRetry succeeds when refresh (checkoutLatest) is present", succeeded);
  const rowA = (await staleA.query().where("id = 'r'").limit(1).toArray())[0] as any;
  check("the update actually landed (row reflects the retried write, n=2)", rowA.n === 2, `n=${rowA.n}`);

  // With the refresh deleted (a no-op), the identical conflict recurs and throws.
  const staleB = await twoStaleHandles(dir, "no_refresh");
  let conflict = false;
  try {
    await withCommitRetry(
      () => staleB.update({ where: "id = 'r'", values: { n: 2 } }),
      async () => {}, // refresh removed
    );
  } catch (error) {
    conflict = isCommitConflict(error);
  }
  check("without the refresh, withCommitRetry exhausts its attempts and throws the conflict", conflict);
  // Read the authoritative value through a fresh handle: the writer's n=1 stands
  // and the stale update (n=2) never committed.
  await staleB.checkoutLatest();
  const rowB = (await staleB.query().where("id = 'r'").limit(1).toArray())[0] as any;
  check("without the refresh, the stale update never landed (authoritative n=1)", rowB.n === 1, `n=${rowB.n}`);

  fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================================
// Task 2 — runExclusive serializes handler bodies
// ============================================================================

async function mutexSerializes(): Promise<void> {
  console.log("\nTask 2: runExclusive serializes overlapping handler bodies");

  function makeBody(state: { counter: number; max: number }) {
    return async () => {
      state.counter += 1;
      state.max = Math.max(state.max, state.counter);
      await new Promise((r) => setTimeout(r, 5)); // interleave point
      state.counter -= 1;
    };
  }

  // Control: without the mutex, overlapping bodies drive the counter above one,
  // proving the test can detect a broken mutex.
  const unguarded = { counter: 0, max: 0 };
  await Promise.all(Array.from({ length: 5 }, () => makeBody(unguarded)()));
  check("control: unguarded overlapping bodies exceed one in flight", unguarded.max > 1, `max=${unguarded.max}`);

  // With runExclusive, only one body is ever in flight.
  const guarded = { counter: 0, max: 0 };
  await Promise.all(Array.from({ length: 5 }, () => runExclusive(makeBody(guarded))));
  check("runExclusive keeps at most one body in flight", guarded.max === 1, `max=${guarded.max}`);
}

// ============================================================================
// Task 4 — a failing touch never turns a durable write into a reported failure
// ============================================================================

async function touchFailureIsSwallowed(): Promise<void> {
  console.log("\nTask 4: a failing last_referenced_at touch does not fail the write");

  // Hermetic core: safeTouchTopicLastReferenced swallows a real throw and warns.
  // Dropping the topics table makes the module handle's update raise a
  // non-commit-conflict error, which withCommitRetry does not retry.
  const dir = mkdb("stale-touch-");
  const db = await lancedb.connect(dir);
  await initializeMemoryTables(db, DEFAULT_VECTOR_DIMENSIONS);
  const topic = await createTopic({ name: "touch-topic", description: "d", tags: [], status: "active", importance: 0.5 } as never);
  await db.dropTable("topics"); // module topics handle is now broken

  const logs: string[] = [];
  const origError = console.error;
  console.error = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  let touchThrew = false;
  try {
    await safeTouchTopicLastReferenced(topic.id);
  } catch {
    touchThrew = true;
  } finally {
    console.error = origError;
  }
  check("safeTouchTopicLastReferenced does not throw when the touch fails", !touchThrew);
  check("safeTouchTopicLastReferenced logs a warning naming the topic", logs.some((l) => l.includes(topic.id) && /last_referenced_at/.test(l)), logs.join(" | "));
  fs.rmSync(dir, { recursive: true, force: true });

  // Full end-to-end: add_memory returns success + exactly one row + stderr
  // warning when the post-write touch fails. Requires an embedding provider (the
  // memory server needs one to function); skipped loudly if none is available.
  const probe = await safeEmbed("embedding availability probe");
  if (probe === null) {
    // A silent skip would make the absence of the headline integration test
    // indistinguishable from its success. Locally (a dev box with no model) a
    // graceful skip is fine — the swallow mechanism is already covered above —
    // but under CI the fixed handler MUST actually run, so fail loudly instead.
    if (process.env.CI) {
      throw new Error("add_memory end-to-end requires an embedding provider, but none is available under CI (safeEmbed returned null). The fixed handler must be exercised — ensure the ONNX model can load or the provider is configured.");
    }
    console.log("  SKIP   add_memory end-to-end: no embedding provider available locally (safeTouch swallow verified above)");
    return;
  }

  const dir2 = mkdb("stale-addmem-");
  const db2 = await lancedb.connect(dir2);
  await initializeMemoryTables(db2, DEFAULT_VECTOR_DIMENSIONS);
  const topic2 = await createTopic({ name: "addmem-topic", description: "d", tags: [], status: "active", importance: 0.5 } as never);
  await db2.dropTable("topics"); // arm the touch to fail after the memory commits

  const logs2: string[] = [];
  const origError2 = console.error;
  console.error = (...a: unknown[]) => { logs2.push(a.map(String).join(" ")); };
  let response;
  try {
    response = await new AddMemoryTool().execute({ title: "durable-under-touch-failure", content: "c", topic_id: topic2.id });
  } finally {
    console.error = origError2;
  }

  // isError===false is the property that actually prevents duplicates: reported
  // success means the caller never issues the retry that the pre-fix false
  // failure provoked. The count check below proves durability (persisted exactly
  // once, not zero), not anti-duplication — a single non-retried call could not
  // produce a duplicate regardless of the fix.
  check("add_memory returns success even though the touch failed (no false failure to retry)", response!.isError === false);
  check("add_memory logged the swallowed touch warning to stderr", logs2.some((l) => l.includes(topic2.id) && /last_referenced_at/.test(l)));
  const durable = await memoriesTable!.countRows("title = 'durable-under-touch-failure'");
  check("the memory row persisted durably exactly once despite the touch failure", durable === 1, `count=${durable}`);
  fs.rmSync(dir2, { recursive: true, force: true });
}

// ============================================================================
// Entry point
// ============================================================================

async function main(): Promise<void> {
  await nullGuard();
  await checkoutSemantics();
  await refreshTablesReal();
  await appendCommutes();
  await commitRetryGuard();
  await mutexSerializes();
  await touchFailureIsSwallowed();
  console.log(`\n${checksRun} staleness checks passed\n`);
}

main().catch((error: unknown) => {
  console.error("\nFAILED\n");
  console.error(error);
  process.exitCode = 1;
});
