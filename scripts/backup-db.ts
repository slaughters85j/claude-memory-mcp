/**
 * Application-consistent backup of the LanceDB memory store.
 *
 * Runs in TypeScript via tsx using the repo's own @lancedb/lancedb — no second
 * LanceDB (the compaction script had to pin a Python one to match the on-disk
 * format; a second version in the backup path would be a liability).
 *
 * This is the LOGICAL-corruption layer. Hardware failure, theft, and `rm -rf`
 * are a human's responsibility (a Time Machine or off-machine destination); this
 * script warns if none is configured but does not perform it.
 *
 *   npx tsx scripts/backup-db.ts [--dry-run] [--dest <path>]
 *
 * Never writes to the source. The only mutating LanceDB calls a backup could
 * make — add/update/delete/mergeInsert — must not appear in this file.
 */
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as lancedb from "@lancedb/lancedb";

import { EXCLUDE_SYSTEM_ROWS } from "../src/schema/memorySchema.js";

// ── Tunables ────────────────────────────────────────────────────────────────
export const BACKUP_ROOT = path.join(os.homedir(), "Backups", "claude-memory");
export const RETAIN_DAYS = 30;
export const MIN_RETAINED_BACKUPS = 7;
export const FREE_SPACE_MULTIPLIER = 5;
export const VERIFY_RETRY_ATTEMPTS = 2;

/** Fragment directories, copied after the manifests (see copyTable). */
const TABLE_COPY_ORDER = ["data", "_deletions", "_transactions"];
const MANIFEST_DIR = "_versions";
/** Rows carrying the schema-inference sentinel. Constant, not interpolated. */
const SENTINEL_FILTER = "array_has(tags, '_system')";
/** Tables that carry a `_system` sentinel and the tag invariant. */
const MEMORY_TABLES = new Set(["topics", "memories", "todos"]);
/** Cross-process interlock shared with compact-db.sh. */
const LOCK_DIR = path.join(os.homedir(), ".claude-memory-maintenance.lock");
const LOCK_STALE_MS = 60 * 60 * 1000;

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
/** The live store: sibling of the repo, never inside it. */
export const LIVE_DB = path.resolve(REPO_ROOT, "..", "memory-db");

// ── Types ─────────────────────────────────────────────────────────────────────
export interface TableState {
  version: number;
  count: number;
  ids: string[];
}
export type DbState = Record<string, TableState>;

export interface BackupResult {
  tarball: string;
  manifest: string;
  sha256: string;
  bytes: number;
  state: DbState;
}

// ── Filesystem helpers ────────────────────────────────────────────────────────

/** realpath resolving through symlinks even if the tail does not exist yet. */
export function realpathBestEffort(target: string): string {
  let current = path.resolve(target);
  const tail: string[] = [];
  while (!fs.existsSync(current)) {
    tail.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const base = fs.existsSync(current) ? fs.realpathSync(current) : current;
  return tail.length ? path.join(base, ...tail) : base;
}

/** True if a path resolves into the iCloud Drive tree. */
export function isInsideICloud(target: string): boolean {
  return /Mobile Documents|com~apple~CloudDocs/.test(realpathBestEffort(target));
}

function dirSizeBytes(target: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(target, entry.name);
    try {
      if (entry.isDirectory()) total += dirSizeBytes(full);
      else if (entry.isFile()) total += fs.statSync(full).size;
    } catch {
      // Entry vanished between readdir and stat (a concurrent writer); count 0.
    }
  }
  return total;
}

function freeBytes(target: string): number {
  const anchor = realpathBestEffort(target);
  let probe = anchor;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const st = fs.statfsSync(probe);
  return st.bavail * st.bsize;
}

export function sha256File(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function utcStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function gitHead(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT }).toString().trim();
  } catch {
    return "unknown";
  }
}

/** Copy a `<table>.lance` directory manifests-first, fragments after. */
function copyTable(srcLance: string, dstLance: string): void {
  fs.mkdirSync(dstLance, { recursive: true });
  const entries = fs.readdirSync(srcLance);
  // Copy the manifests (_versions) FIRST — this pins the copy to a version vK —
  // then the fragment directories (data/_deletions/_transactions). Concurrent
  // writers only APPEND (compaction, which deletes fragments, is locked out by
  // the maintenance lock), so the fragment dirs read afterwards are a superset of
  // what vK references: every fragment vK points to is guaranteed present. This
  // is the correctness argument for a hot copy taken without stopping the
  // writers. (Copying manifests LAST would instead capture the newest manifest,
  // which references the newest fragments — some written after the fragment dirs
  // were read — a dangling copy. verify+retry is the backstop, not the guarantee.)
  const ordered = [
    ...(entries.includes(MANIFEST_DIR) ? [MANIFEST_DIR] : []),
    ...TABLE_COPY_ORDER.filter((d) => entries.includes(d)),
    ...entries.filter((e) => !TABLE_COPY_ORDER.includes(e) && e !== MANIFEST_DIR),
  ];
  for (const name of ordered) {
    fs.cpSync(path.join(srcLance, name), path.join(dstLance, name), { recursive: true });
  }
}

function copyDatabase(source: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const src = path.join(source, entry.name);
    const dst = path.join(dest, entry.name);
    if (entry.isDirectory() && entry.name.endsWith(".lance")) copyTable(src, dst);
    else fs.cpSync(src, dst, { recursive: true });
  }
}

// ── LanceDB read helpers (read-only; no add/update/delete/mergeInsert here) ────

async function allIds(table: lancedb.Table, count: number): Promise<string[]> {
  const rows = (await table.query().select(["id"]).limit(count + 1).toArray()) as Array<{ id: unknown }>;
  return rows.map((r) => String(r.id));
}

/** Point-in-time record of every table's version, row count, and id set. */
export async function snapshotDatabase(dbPath: string): Promise<DbState> {
  const db = await lancedb.connect(dbPath);
  const state: DbState = {};
  for (const name of await db.tableNames()) {
    const table = await db.openTable(name);
    const count = await table.countRows();
    state[name] = { version: await table.version(), count, ids: await allIds(table, count) };
  }
  return state;
}

/**
 * Self-contained consistency checks for any memory database, returning its
 * state. For each memory table: exactly one `_system` row, and the invariant
 * `system + kept === total` (the check that caught the array_has([]) NULL bug
 * and must never be dropped). Throws on the first failure.
 */
export async function verifyInternalConsistency(dbPath: string): Promise<DbState> {
  const db = await lancedb.connect(dbPath);
  const state: DbState = {};
  for (const name of await db.tableNames()) {
    const table = await db.openTable(name);
    const total = await table.countRows();
    if (MEMORY_TABLES.has(name)) {
      const sentinel = await table.countRows(SENTINEL_FILTER);
      const kept = await table.countRows(EXCLUDE_SYSTEM_ROWS);
      if (sentinel !== 1) {
        throw new Error(`${name}: expected exactly one _system sentinel row, found ${sentinel}`);
      }
      if (sentinel + kept !== total) {
        throw new Error(`${name}: tag invariant broken (${sentinel} system + ${kept} kept !== ${total} total)`);
      }
    }
    state[name] = { version: await table.version(), count: total, ids: await allIds(table, total) };
  }
  return state;
}

/**
 * A copy is valid when it is internally consistent AND, per table, its version
 * is at least the recorded source version and every recorded source id is
 * present. A row legitimately deleted mid-copy is the only benign failure and
 * the caller resolves it by re-snapshotting and retrying.
 */
export async function verifyDatabase(dbPath: string, expected: DbState): Promise<void> {
  const actual = await verifyInternalConsistency(dbPath);
  for (const [name, exp] of Object.entries(expected)) {
    const got = actual[name];
    if (!got) throw new Error(`${name}: table missing from copy`);
    if (got.version < exp.version) {
      throw new Error(`${name}: copy version ${got.version} is behind source version ${exp.version}`);
    }
    const present = new Set(got.ids);
    const missing = exp.ids.filter((id) => !present.has(id));
    if (missing.length > 0) {
      throw new Error(`${name}: ${missing.length} source id(s) missing from copy (e.g. ${missing[0]})`);
    }
  }
}

// ── Retention ─────────────────────────────────────────────────────────────────

/** Delete tarballs+manifests older than RETAIN_DAYS, keeping >= MIN_RETAINED_BACKUPS. */
export function pruneOldBackups(dest: string, dryRun: boolean): string[] {
  const tarballs = fs
    .readdirSync(dest)
    .filter((f) => f.endsWith(".tar.gz"))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(dest, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime); // newest first
  const cutoff = Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  tarballs.forEach((entry, index) => {
    const keptSoFar = index; // how many newer tarballs are retained ahead of this one
    if (entry.mtime >= cutoff) return;
    if (keptSoFar < MIN_RETAINED_BACKUPS) return; // never drop below the floor
    removed.push(entry.name);
    if (!dryRun) {
      fs.rmSync(path.join(dest, entry.name), { force: true });
      const manifest = path.join(dest, entry.name.replace(/\.tar\.gz$/, ".manifest.json"));
      fs.rmSync(manifest, { force: true });
    }
  });
  return removed;
}

// ── Backup ────────────────────────────────────────────────────────────────────

export async function backupDatabase(opts: {
  source: string;
  dest: string;
  dryRun?: boolean;
}): Promise<BackupResult | null> {
  const { source, dest, dryRun = false } = opts;

  if (isInsideICloud(dest)) {
    throw new Error(`Refusing: destination ${dest} resolves inside iCloud Drive — a backup inside the thing being backed up is not a backup.`);
  }
  if (!fs.existsSync(source)) throw new Error(`Source database does not exist: ${source}`);

  const sourceBytes = dirSizeBytes(source);
  const needed = FREE_SPACE_MULTIPLIER * sourceBytes;
  const available = freeBytes(dest);
  if (available < needed) {
    throw new Error(`Refusing: destination has ${(available / 1e6).toFixed(1)}MB free, need ${(needed / 1e6).toFixed(1)}MB (${FREE_SPACE_MULTIPLIER}x source).`);
  }

  // Step 3: point-in-time reference for verification.
  let state = await snapshotDatabase(source);
  const tablesSummary = Object.entries(state)
    .map(([n, s]) => `${n}=${s.count}@v${s.version}`)
    .join(" ");

  console.log(`Source : ${source} (${(sourceBytes / 1e6).toFixed(1)}MB, ${tablesSummary})`);
  console.log(`Dest   : ${dest}`);
  console.log(`Mode   : ${dryRun ? "DRY RUN (no writes)" : "BACKUP"}`);

  if (dryRun) {
    const wouldPrune = fs.existsSync(dest) ? pruneOldBackups(dest, true) : [];
    console.log(`[dry-run] would write <stamp>.tar.gz + .manifest.json to ${dest}`);
    console.log(`[dry-run] would prune ${wouldPrune.length} backup(s): ${wouldPrune.join(", ") || "none"}`);
    return null;
  }

  fs.mkdirSync(dest, { recursive: true });
  const stamp = utcStamp();
  const staging = path.join(dest, `.staging-${stamp}`);
  const stagedDb = path.join(staging, path.basename(source));

  // Steps 4-6: copy fragments-first, verify, retry on failure.
  let verified = false;
  for (let attempt = 0; attempt < VERIFY_RETRY_ATTEMPTS; attempt += 1) {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    copyDatabase(source, stagedDb);
    try {
      await verifyDatabase(stagedDb, state);
      verified = true;
      break;
    } catch (error) {
      console.error(`  verification failed (attempt ${attempt + 1}/${VERIFY_RETRY_ATTEMPTS}): ${(error as Error).message}`);
      fs.rmSync(staging, { recursive: true, force: true });
      // A row legitimately deleted mid-copy is the only benign cause; re-snapshot
      // fully (replace, not merge — a table dropped mid-run must not linger).
      state = await snapshotDatabase(source);
    }
  }
  if (!verified) {
    throw new Error("Backup verification failed after retries; no tarball written.");
  }

  // Step 7: tarball, checksum, manifest.
  const tarball = path.join(dest, `${stamp}.tar.gz`);
  execFileSync("tar", ["-czf", tarball, "-C", staging, path.basename(source)]);
  fs.rmSync(staging, { recursive: true, force: true });
  const sha256 = sha256File(tarball);
  const bytes = fs.statSync(tarball).size;
  const manifest = path.join(dest, `${stamp}.manifest.json`);
  fs.writeFileSync(
    manifest,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        source,
        sha256,
        bytes,
        git: gitHead(),
        tables: Object.fromEntries(Object.entries(state).map(([n, s]) => [n, { count: s.count, version: s.version }])),
      },
      null,
      2,
    ) + "\n",
  );

  // Step 8: prune, but only now that this run verified.
  const pruned = pruneOldBackups(dest, false);

  console.log(`Wrote  : ${path.basename(tarball)} (${(bytes / 1e6).toFixed(1)}MB, sha256 ${sha256.slice(0, 12)}…)`);
  console.log(`Pruned : ${pruned.length} old backup(s)`);
  return { tarball, manifest, sha256, bytes, state };
}

// ── Live-run wrapper (lock + hardware-backup warning) ─────────────────────────

function warnIfNoHardwareBackup(): void {
  let hasDestination = false;
  try {
    const out = execFileSync("tmutil", ["destinationinfo"], { stdio: ["ignore", "pipe", "ignore"] }).toString();
    hasDestination = !/No destinations configured/i.test(out) && /Name|URL|ID/.test(out);
  } catch {
    hasDestination = false;
  }
  if (!hasDestination) {
    console.warn("WARNING: no Time Machine destination configured. This backup protects against LOGICAL corruption only — hardware failure, theft, and `rm -rf` remain uncovered until an off-machine destination exists.");
  }
}

function acquireLock(): void {
  const nonce = `${process.pid}-${process.hrtime.bigint()}`;
  try {
    fs.mkdirSync(LOCK_DIR);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const age = Date.now() - fs.statSync(LOCK_DIR).mtimeMs;
    if (age < LOCK_STALE_MS) {
      throw new Error(`Maintenance lock held at ${LOCK_DIR} (age ${(age / 1000).toFixed(0)}s). Another backup or compaction is running; remove it if stale.`);
    }
    console.warn(`Stealing stale maintenance lock (age ${(age / 60000).toFixed(0)}min).`);
    fs.rmSync(LOCK_DIR, { recursive: true, force: true });
    fs.mkdirSync(LOCK_DIR);
  }
  // Write a unique token then read it back: if two processes both stole the same
  // stale lock, the last writer wins and the loser sees a foreign token and backs
  // off, so only one ever proceeds.
  const ownerFile = path.join(LOCK_DIR, "owner");
  fs.writeFileSync(ownerFile, `backup-db ${nonce}\n`);
  if (!fs.readFileSync(ownerFile, "utf8").includes(nonce)) {
    throw new Error("Lost a race for the maintenance lock; try again.");
  }
}

function releaseLock(): void {
  fs.rmSync(LOCK_DIR, { recursive: true, force: true });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const destIndex = args.indexOf("--dest");
  const dest = destIndex >= 0 ? path.resolve(args[destIndex + 1]) : BACKUP_ROOT;

  warnIfNoHardwareBackup();

  if (dryRun) {
    await backupDatabase({ source: LIVE_DB, dest, dryRun: true });
    return;
  }

  acquireLock();
  try {
    await backupDatabase({ source: LIVE_DB, dest, dryRun: false });
  } finally {
    releaseLock();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(String((error as Error).message ?? error));
    process.exit(1);
  });
}
