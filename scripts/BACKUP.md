# Backups

`scripts/backup-db.ts` takes an application-consistent copy of the LanceDB
memory store while the three Claude Desktop server processes keep writing. It
uses the repo's own `@lancedb/lancedb` — no second LanceDB version in the backup
path.

```
npm run backup                 # back up the live store to ~/Backups/claude-memory
npm run backup -- --dry-run    # run every check, write nothing
npm run backup -- --dest <p>   # override the destination (still iCloud-guarded)
```

## What it protects against

**Logical corruption only.** iCloud Drive is replication, not backup — it
propagated the tag corruption to every device as faithfully as it propagates
good data. These tarballs are the layer that lets you roll back a bad write.
Hardware failure, theft, and `rm -rf` are **not** covered until an off-machine
destination (Time Machine, an external disk, or cloud storage outside iCloud)
exists. The script prints a warning when `tmutil` reports no Time Machine
destination; that warning is the reminder to add one.

## The hot-copy correctness argument

The store is copied without stopping the writers, so the copy could otherwise
catch a manifest that references a fragment a concurrent compaction just deleted.
Two things prevent that:

1. **Copy order.** Each `<table>.lance` directory is copied fragments-first
   (`data`, `_deletions`, `_transactions`) and **manifests (`_versions`) last**.
   Lance writes fragments before the manifest that references them, so a manifest
   present in the copy is guaranteed to have its fragments present.
2. **Verify + retry.** After copying, the copy is opened and checked: each
   table's version is at least the source version recorded before the copy,
   exactly one `_system` sentinel row exists per memory table, the invariant
   `system + kept === total` holds (the check that caught the `array_has([])`
   NULL bug), and every source id captured before the copy is present. A row
   legitimately deleted mid-copy is the only benign failure; the copy is
   discarded, the source re-snapshotted, and the copy retried
   (`VERIFY_RETRY_ATTEMPTS`).

A `mkdir`-based lock at `~/.claude-memory-maintenance.lock`, respected by both
`backup-db.ts` and `compact-db.sh`, additionally prevents a backup and a
compaction from running at the same time (a lock older than an hour is treated
as stale and stolen).

## Retention

- `RETAIN_DAYS = 30` — tarballs older than this are pruned…
- `MIN_RETAINED_BACKUPS = 7` — …but never below this many, and never at all if
  the current run's verification did not pass.
- `FREE_SPACE_MULTIPLIER = 5` — the run refuses unless the destination has at
  least 5× the source size free.

Each tarball has a sibling `<stamp>.manifest.json` recording the UTC timestamp,
per-table row counts and versions, the sha256 of the tarball, the source path,
the byte size, and the repo's git HEAD.

## Restore

```
npm run restore -- --from <tarball> --to <dir> [--force]
```

Verifies the tarball's sha256 against its sibling manifest before extracting,
refuses to overwrite an existing `.lance` database unless `--force`, runs the
same internal-consistency checks, and reports per-table row counts and versions.
It prints — but does not perform — the change needed to point Claude Desktop at
the restored database (edit the memory-server path in
`~/Library/Application Support/Claude/claude_desktop_config.json`, then relaunch).

## Scheduling (daily 03:15)

`launchd/com.ubiquitousanalytics.claude-memory-backup.plist` runs the backup
daily. It is not loaded by this repo; install it yourself:

```
cp "launchd/com.ubiquitousanalytics.claude-memory-backup.plist" ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ubiquitousanalytics.claude-memory-backup.plist
```

Logs go to `~/Library/Logs/claude-memory-backup.log`. Remove with
`launchctl bootout gui/$(id -u)/com.ubiquitousanalytics.claude-memory-backup`.
