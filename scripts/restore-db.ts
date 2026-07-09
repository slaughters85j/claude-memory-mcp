/**
 * Restore a memory-store backup produced by scripts/backup-db.ts.
 *
 *   npx tsx scripts/restore-db.ts --from <tarball> --to <dir> [--force]
 *
 * Verifies the tarball's sha256 against its sibling manifest before extracting,
 * refuses to overwrite an existing .lance database unless --force, then runs the
 * same internal-consistency checks the backup used and reports per-table row
 * counts and versions. Prints — but does not perform — the config change needed
 * to point Claude Desktop at the restored database.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { DbState, sha256File, verifyInternalConsistency } from "./backup-db.js";

export async function restoreDatabase(opts: {
  from: string;
  to: string;
  force?: boolean;
}): Promise<{ restoredDb: string; state: DbState }> {
  const { from, to, force = false } = opts;

  if (!fs.existsSync(from)) throw new Error(`Tarball not found: ${from}`);

  const manifestPath = from.replace(/\.tar\.gz$/, ".manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found beside tarball: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { sha256: string; source: string };

  const actualSha = sha256File(from);
  if (actualSha !== manifest.sha256) {
    throw new Error(`Checksum mismatch: tarball ${actualSha} != manifest ${manifest.sha256}. Refusing to restore a corrupted archive.`);
  }

  const dbName = path.basename(manifest.source);
  const restoredDb = path.join(to, dbName);

  for (const target of [to, restoredDb]) {
    if (fs.existsSync(target) && fs.readdirSync(target).some((e) => e.endsWith(".lance")) && !force) {
      throw new Error(`${target} already contains a .lance database. Pass --force to overwrite.`);
    }
  }

  fs.mkdirSync(to, { recursive: true });
  execFileSync("tar", ["-xzf", from, "-C", to]);
  if (!fs.existsSync(restoredDb)) {
    throw new Error(`Extracted archive did not contain ${dbName}`);
  }

  const state = await verifyInternalConsistency(restoredDb);

  console.log(`Restored: ${restoredDb}`);
  for (const [name, s] of Object.entries(state)) {
    console.log(`  ${name}: ${s.count} rows @ v${s.version}`);
  }
  console.log(`\nTo use this database, set the memory-server args in`);
  console.log(`~/Library/Application Support/Claude/claude_desktop_config.json to point at:`);
  console.log(`  ${restoredDb}`);
  console.log(`(then relaunch Claude Desktop). This script does not modify that file.`);

  return { restoredDb, state };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const from = args[args.indexOf("--from") + 1];
  const to = args[args.indexOf("--to") + 1];
  const force = args.includes("--force");
  if (!args.includes("--from") || !args.includes("--to") || !from || !to) {
    console.error("Usage: tsx scripts/restore-db.ts --from <tarball> --to <dir> [--force]");
    process.exit(2);
  }
  await restoreDatabase({ from: path.resolve(from), to: path.resolve(to), force });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(String((error as Error).message ?? error));
    process.exit(1);
  });
}
