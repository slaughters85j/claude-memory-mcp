# Compacting the memory store

`scripts/compact-db.sh` reduces LanceDB fragmentation (`optimize()`) and prunes
old version history (`cleanup_old_versions()`). Both are irreversible, so run it
with the memory servers stopped and let it take its pre-run backup.

## Why the servers must be stopped

The store is written by `node dist/index.js … memory-db` processes launched by
Claude Desktop (and by each Claude Code session). Compacting while they write can
conflict, and the store lives in iCloud Drive, so a mid-sync rewrite is risky.
Those servers run *under* Claude Desktop — including the one serving an active
Claude Code chat — so the app itself must be quit; a chat cannot stop its own
server from inside itself.

## Procedure

1. Quit Claude Desktop entirely (⌘Q). This stops every memory server.
2. Confirm none remain (should print nothing):

   ```
   pgrep -fl "dist/index.js.*memory-db"
   ```

3. Run the compaction from Terminal:

   ```
   cd "/Users/system-backup/Library/Mobile Documents/com~apple~CloudDocs/Claude.AI Persistent Memory/claude-memory-mcp"
   scripts/compact-db.sh --dry-run   # optional: preview row/version counts
   scripts/compact-db.sh             # answer y at the live-store prompt
   ```

4. Reopen Claude Desktop.

## What it does

- Backs up to `~/Backups/claude-memory/precompact-<UTC-timestamp>.tar.gz` first.
- Runs `compact_files()` on each table, then `cleanup_old_versions(older_than=7 days)`.
- Reads each table back to prove it still opens under the pinned 0.15 reader.

Expected result: `topics` collapses from ~1,600 versions to a handful, and the
28M store shrinks noticeably.

## Deduplicating legacy rows (one-time)

The old delete+add update path could race into duplicate-id rows under
concurrent writers (and blanked tag strings as a side effect).
`scripts/dedupe-rows.ts` collapses any duplicates, keeping the newest copy per
id. The atomic `table.update()` fix prevents new duplicates, so this is a
one-time cleanup.

1. Quit Claude Desktop.
2. `git pull` (gets the atomic-update fix and this script).
3. Preview, then run:

   ```
   npx tsx scripts/dedupe-rows.ts --dry-run
   npx tsx scripts/dedupe-rows.ts
   ```

   It backs up to `~/Backups/claude-memory/prededupe-<UTC>.tar.gz`, keeps the
   newest row per id, and integrity-checks the result.
4. Reopen Claude Desktop.

The `table.update()` fix updates all rows sharing an id (rather than adding
more), so it is safe even before the dedupe runs — the ordering is not critical.

## If something looks wrong

Restore from the most recent pre-run tarball (`precompact-*` or `prededupe-*`):

```
cd "/Users/system-backup/Library/Mobile Documents/com~apple~CloudDocs/Claude.AI Persistent Memory"
mv memory-db memory-db.broken
tar -xzf ~/Backups/claude-memory/<newest-backup>.tar.gz
```
