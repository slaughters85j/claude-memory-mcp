#!/bin/bash
#
# Compact and clean LanceDB tables for claude-memory.
#
# optimize() rewrites fragments and cleanup_old_versions() prunes the version
# history that time-travel / checkout() would use to recover. Both are
# destructive and irreversible, so this script:
#   - refuses to touch the live store without an explicit --force/confirmation,
#   - snapshots the database to a tarball BEFORE mutating anything,
#   - pins the Python LanceDB to the same 0.15 line as the Node writer so
#     optimize() cannot migrate the on-disk format to something the running
#     MCP server (which uses @lancedb/lancedb@0.15.x) can no longer open,
#   - retains a rollback window instead of deleting all old versions,
#   - reads each table back after optimizing to prove it still opens.
#
# Usage:
#   compact-db.sh [DB_PATH] [--dry-run] [--yes] [--force] [--retain-days N]
#
#   DB_PATH          Database directory. If omitted, uses the live store and
#                    requires confirmation (or --force).
#   --dry-run        Report versions/sizes and take NO destructive action.
#   --yes            Skip interactive confirmation (required in non-TTY runs).
#   --force          Allow operating on the live store without prompting.
#   --retain-days N  Keep versions newer than N days for rollback (default 7).
#
# Env overrides:
#   LANCEDB_PY_SPEC  pip spec for the Python LanceDB (default '>=0.15,<0.16';
#                    MUST track @lancedb/lancedb in package.json to avoid
#                    on-disk format drift).
#   BACKUP_DIR       Where pre-compaction tarballs are written
#                    (default ~/Backups/claude-memory).

set -euo pipefail

LIVE_STORE="/Users/system-backup/Library/Mobile Documents/com~apple~CloudDocs/Claude.AI Persistent Memory/memory-db"

DB_PATH=""
DRY_RUN=0
ASSUME_YES=0
FORCE=0
RETAIN_DAYS=7
LANCEDB_PY_SPEC="${LANCEDB_PY_SPEC:->=0.15,<0.16}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/Backups/claude-memory}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    --force) FORCE=1; shift ;;
    --retain-days) RETAIN_DAYS="${2:?--retain-days needs a number}"; shift 2 ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; exit 2 ;;
    *) DB_PATH="$1"; shift ;;
  esac
done

DB_PATH="${DB_PATH:-$LIVE_STORE}"

if [[ ! -d "$DB_PATH" ]]; then
  echo "Database path does not exist: $DB_PATH" >&2
  exit 1
fi

### Confirm y/N, refusing silently in a non-interactive shell unless --yes.
confirm() {
  [[ "$ASSUME_YES" == "1" ]] && return 0
  if [[ ! -t 0 ]]; then
    echo "Refusing to proceed non-interactively without --yes." >&2
    exit 1
  fi
  local ans
  read -r -p "$1 [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]]
}

# Resolve to an absolute path so the live-store comparison is reliable.
DB_ABS="$(cd "$DB_PATH" && pwd -P)"
LIVE_ABS="$(cd "$LIVE_STORE" 2>/dev/null && pwd -P || echo "$LIVE_STORE")"

echo "Target : $DB_ABS"
echo "Mode   : $([[ "$DRY_RUN" == 1 ]] && echo 'DRY RUN (no changes)' || echo 'COMPACT (destructive)')"
echo "Retain : ${RETAIN_DAYS}d of version history"
echo "LanceDB: python '${LANCEDB_PY_SPEC}'"
echo "---"

if [[ "$DB_ABS" == "$LIVE_ABS" && "$DRY_RUN" != 1 && "$FORCE" != 1 ]]; then
  echo "This is the LIVE memory store."
  confirm "Compact the live store?" || { echo "Aborted."; exit 1; }
fi

### Warn if a memory server is holding the store open. Match the actual DB
### server invocation (node dist/index.js … memory-db), not editors/IDEs whose
### window happens to be labelled "claude-memory-mcp".
if command -v pgrep >/dev/null 2>&1 && pgrep -fl "dist/index.js.*memory-db" >/dev/null 2>&1; then
  echo "WARNING: a claude-memory-mcp process is running; compacting a live store risks write conflicts."
  [[ "$DRY_RUN" == 1 ]] || confirm "Continue with writers live?" || { echo "Aborted."; exit 1; }
fi

### Snapshot before any mutation.
if [[ "$DRY_RUN" != 1 ]]; then
  mkdir -p "$BACKUP_DIR"
  backup="$BACKUP_DIR/precompact-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
  echo "Backing up -> $backup"
  tar -czf "$backup" -C "$(dirname "$DB_ABS")" "$(basename "$DB_ABS")"
  echo "Backup complete ($(du -sh "$backup" | cut -f1))"
  echo "---"
fi

DB_PATH="$DB_ABS" RETAIN_DAYS="$RETAIN_DAYS" DRY_RUN="$DRY_RUN" \
  uv run --with "lancedb${LANCEDB_PY_SPEC}" python3 - <<'PY'
import os
import warnings
from datetime import timedelta

warnings.filterwarnings("ignore", category=DeprecationWarning)
import lancedb

db_path = os.environ["DB_PATH"]
retain_days = int(os.environ["RETAIN_DAYS"])
dry_run = os.environ["DRY_RUN"] == "1"

db = lancedb.connect(db_path)
tables = db.table_names()
print(f"Found tables: {tables}\n")

for name in tables:
    print(f"Processing {name}...")
    table = db.open_table(name)
    try:
        before = len(table.list_versions())
    except Exception:
        before = None

    if dry_run:
        rows = table.count_rows()
        print(f"  [dry-run] rows={rows} versions={before}; would optimize + retain last {retain_days}d")
        continue

    table.optimize()
    print("  compacted fragments")

    table.cleanup_old_versions(older_than=timedelta(days=retain_days))
    after = len(table.list_versions())
    print(f"  pruned versions: {before} -> {after} (kept last {retain_days}d)")

    # Read-back: prove the table still opens with the pinned reader.
    rows = table.count_rows()
    print(f"  read-back OK ({rows} rows)")

print("\nDone!")
PY

echo "---"
echo "Current size: $(du -sh "$DB_ABS" | cut -f1)"
