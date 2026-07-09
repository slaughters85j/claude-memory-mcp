/**
 * One-time cleanup: collapse duplicate-id rows that the old delete()+add()
 * update pattern produced under concurrent writers, keeping the newest copy per
 * id (by last_referenced_at, else updated_at).
 *
 * Run with the memory servers stopped (quit Claude Desktop) so no concurrent
 * writer recreates duplicates mid-run, and AFTER the mergeInsert/update fix is
 * deployed so none reappear. Takes a backup before mutating.
 *
 *   npx tsx scripts/dedupe-rows.ts [DB_PATH] [--dry-run]
 *
 * Idempotent: a second run finds nothing to do.
 */
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as lancedb from "@lancedb/lancedb";
import { toPlainRow } from "../src/schema/memorySchema.js";

const LIVE_STORE =
  "/Users/system-backup/Library/Mobile Documents/com~apple~CloudDocs/Claude.AI Persistent Memory/memory-db";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const dbPath = args.find((a) => !a.startsWith("-")) ?? LIVE_STORE;
const backupDir = process.env.BACKUP_DIR ?? path.join(os.homedir(), "Backups", "claude-memory");

/** Newest-wins timestamp column, preferring last_referenced_at. */
function newestColumn(fieldNames: string[]): string {
  return ["last_referenced_at", "updated_at", "created_at"].find((c) => fieldNames.includes(c)) ?? "id";
}

interface Plan {
  name: string;
  tsCol: string;
  dupIds: Map<string, Record<string, unknown>[]>;
  distinctCount: number;
}

async function main(): Promise<void> {
  if (!fs.existsSync(dbPath)) {
    console.error(`Database path does not exist: ${dbPath}`);
    process.exit(1);
  }
  console.log(`Target: ${dbPath}`);
  console.log(`Mode  : ${dryRun ? "DRY RUN (no changes)" : "DEDUPE (mutating)"}\n`);

  const db = await lancedb.connect(dbPath);
  const names = await db.tableNames();

  // Plan read-only first, so a dry run reports without backing up or mutating.
  const plan: Plan[] = [];
  let totalExtra = 0;
  for (const name of names) {
    const table = await db.openTable(name);
    const schema = await table.schema();
    const tsCol = newestColumn(schema.fields.map((f) => f.name));
    const rows = (await table.query().limit(await table.countRows()).toArray()) as Record<string, unknown>[];
    const byId = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const id = String(row.id);
      (byId.get(id) ?? byId.set(id, []).get(id)!).push(row);
    }
    const dupIds = new Map([...byId].filter(([, copies]) => copies.length > 1));
    const extra = [...dupIds.values()].reduce((sum, copies) => sum + copies.length - 1, 0);
    totalExtra += extra;
    console.log(
      `${name}: rows=${rows.length} distinct=${byId.size} duplicate_ids=${dupIds.size} extra_rows=${extra} (newest by ${tsCol})`,
    );
    if (dupIds.size > 0) plan.push({ name, tsCol, dupIds, distinctCount: byId.size });
  }

  if (totalExtra === 0) {
    console.log("\nNo duplicate rows. Nothing to do.");
    return;
  }
  if (dryRun) {
    console.log(`\n[dry-run] would remove ${totalExtra} duplicate row(s), keeping the newest per id.`);
    return;
  }

  // Back up before mutating.
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const backup = path.join(backupDir, `prededupe-${stamp}.tar.gz`);
  execSync(
    `tar -czf ${JSON.stringify(backup)} -C ${JSON.stringify(path.dirname(dbPath))} ${JSON.stringify(path.basename(dbPath))}`,
  );
  console.log(`\nBackup -> ${backup}\n`);

  for (const { name, tsCol, dupIds } of plan) {
    const table = await db.openTable(name);
    for (const [id, copies] of dupIds) {
      // toPlainRow: copies came from toArray() as Arrow proxies, which add()
      // re-serializes incorrectly (blanked tags, nulled vectors) unless normalized.
      const winner = toPlainRow(copies.reduce((a, b) => (String(a[tsCol]) >= String(b[tsCol]) ? a : b)));
      await table.delete(`id = '${id.replace(/'/g, "''")}'`);
      await table.add([winner]);
      console.log(`  ${name}: id=${id.slice(0, 8)} kept ${tsCol}=${String(winner[tsCol])} (removed ${copies.length - 1})`);
    }
  }

  // Integrity check: every deduped table must now hold exactly its pre-run
  // distinct-id count, with no duplicates left. The backup is the recovery path
  // if this ever fails.
  for (const { name, distinctCount } of plan) {
    const table = await db.openTable(name);
    const rows = (await table.query().limit(await table.countRows()).toArray()) as Record<string, unknown>[];
    const distinct = new Set(rows.map((r) => String(r.id)));
    if (rows.length !== distinctCount || distinct.size !== rows.length) {
      throw new Error(
        `${name}: post-dedupe integrity check failed (physical=${rows.length} distinct=${distinct.size} expected=${distinctCount}); restore from ${backup}`,
      );
    }
  }
  console.log(`\nDone. Removed ${totalExtra} duplicate row(s).`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
