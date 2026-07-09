/**
 * Acceptance tests for the backup/restore layer (Task 3).
 *
 * Run with:  npx tsx scripts/verify-backup.ts
 * Builds throwaway source and destination databases under the system temp
 * directory; never touches the live store or the real backup root. Exits
 * non-zero on first failure.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as lancedb from "@lancedb/lancedb";

import { DEFAULT_VECTOR_DIMENSIONS } from "../src/config.js";
import {
  generateId,
  initializeMemoryTables,
  memoriesTable,
  nowISO,
  todosTable,
  topicsTable,
} from "../src/schema/memorySchema.js";
import { backupDatabase, sha256File, snapshotDatabase } from "./backup-db.js";
import { restoreDatabase } from "./restore-db.js";

const zeroVector = (): number[] => new Array(DEFAULT_VECTOR_DIMENSIONS).fill(0);

let checksRun = 0;
function check(label: string, body: () => void): void {
  body();
  checksRun += 1;
  console.log(`  pass   ${label}`);
}

const tempDirs: string[] = [];
function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function buildSource(): Promise<string> {
  const root = tmp("bk-src-");
  const dbPath = path.join(root, "memory-db");
  const db = await lancedb.connect(dbPath);
  await initializeMemoryTables(db, DEFAULT_VECTOR_DIMENSIONS); // writes one _system row per table

  const topics = Array.from({ length: 20 }, (_, i) => ({
    id: generateId(), name: `topic-${i}`, description: "d", tags: ["seed"], status: "active",
    importance: 0.5, created_at: nowISO(), updated_at: nowISO(), last_referenced_at: nowISO(),
  }));
  await topicsTable!.add(topics as never);

  const memories = Array.from({ length: 15 }, (_, i) => ({
    id: generateId(), topic_id: topics[0].id, title: `m-${i}`, content: "c", kind: "insight",
    tags: i === 0 ? [] : ["seed"], // at least one row with an empty tag list
    importance: 0.5, created_at: nowISO(), updated_at: nowISO(), conversation_summary: "s",
    supersedes_id: "none", vector: zeroVector(),
  }));
  await memoriesTable!.add(memories as never);

  const todos = Array.from({ length: 10 }, (_, i) => ({
    id: generateId(), topic_id: topics[0].id, memory_id: "none", title: `t-${i}`, description: "d",
    status: "open", priority: "high", due_at: null, created_at: nowISO(), updated_at: nowISO(),
    completed_at: null, tags: ["seed"], vector: zeroVector(),
  }));
  await todosTable!.add(todos as never);

  return dbPath;
}

async function main(): Promise<void> {
  console.log("\nTask 3: backup + restore");
  const source = await buildSource();
  const srcState = await snapshotDatabase(source);
  const totalRows = Object.values(srcState).reduce((n, s) => n + s.count, 0);
  check("temp source has all three tables and > 40 rows", () => {
    assert.deepEqual(Object.keys(srcState).sort(), ["memories", "todos", "topics"]);
    assert.ok(totalRows > 40, `only ${totalRows} rows`);
  });

  const dest = tmp("bk-dest-");
  const result = await backupDatabase({ source, dest });
  assert.ok(result, "backup returned no result");

  check("backup writes tarball and manifest", () => {
    assert.ok(fs.existsSync(result!.tarball));
    assert.ok(fs.existsSync(result!.manifest));
  });
  check("manifest sha256 matches a fresh hash of the tarball", () => {
    const manifest = JSON.parse(fs.readFileSync(result!.manifest, "utf8"));
    assert.equal(manifest.sha256, result!.sha256);
    assert.equal(result!.sha256, sha256File(result!.tarball));
  });
  check("manifest records per-table counts and versions and a git head", () => {
    const manifest = JSON.parse(fs.readFileSync(result!.manifest, "utf8"));
    assert.equal(manifest.tables.topics.count, srcState.topics.count);
    assert.ok(typeof manifest.tables.memories.version === "number");
    assert.ok(manifest.git.length > 0);
  });

  // Checksum refusal: corrupt a copy of the tarball by one byte.
  const badTarball = path.join(dest, "corrupt.tar.gz");
  fs.copyFileSync(result!.tarball, badTarball);
  fs.copyFileSync(result!.manifest, badTarball.replace(/\.tar\.gz$/, ".manifest.json"));
  const bytes = fs.readFileSync(badTarball);
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  fs.writeFileSync(badTarball, bytes);
  let checksumError: Error | null = null;
  try {
    await restoreDatabase({ from: badTarball, to: tmp("bk-bad-"), force: true });
  } catch (error) {
    checksumError = error as Error;
  }
  check("restore refuses a tarball whose sha256 does not match its manifest", () => {
    assert.ok(checksumError);
    assert.match(checksumError!.message, /Checksum mismatch/);
  });

  // Restore the good tarball and compare to the source.
  const restoreTo = tmp("bk-restore-");
  const { restoredDb, state } = await restoreDatabase({ from: result!.tarball, to: restoreTo });
  check("restored per-table counts, versions and id sets match the source", () => {
    assert.ok(fs.existsSync(restoredDb));
    for (const name of Object.keys(srcState)) {
      assert.equal(state[name].count, srcState[name].count, `${name} count`);
      assert.equal(state[name].version, srcState[name].version, `${name} version`);
      assert.deepEqual(new Set(state[name].ids), new Set(srcState[name].ids), `${name} ids`);
    }
  });

  // iCloud destination guard.
  let guardError: Error | null = null;
  try {
    await backupDatabase({ source, dest: path.join(os.tmpdir(), "fake-com~apple~CloudDocs", "Backups") });
  } catch (error) {
    guardError = error as Error;
  }
  check("iCloud destination guard rejects a com~apple~CloudDocs path", () => {
    assert.ok(guardError);
    assert.match(guardError!.message, /iCloud/);
  });

  // Dry-run writes nothing.
  const dryDest = tmp("bk-dry-");
  const before = fs.readdirSync(dryDest);
  await backupDatabase({ source, dest: dryDest, dryRun: true });
  check("--dry-run writes nothing to the destination", () => {
    assert.deepEqual(fs.readdirSync(dryDest), before);
  });

  console.log(`\n${checksRun} backup checks passed\n`);
}

main()
  .catch((error: unknown) => {
    console.error("\nFAILED\n");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  });
