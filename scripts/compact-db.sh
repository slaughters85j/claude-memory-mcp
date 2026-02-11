#!/bin/bash
# Compact and clean LanceDB tables for claude-memory
# Run periodically to reduce fragmentation and disk usage

set -e

DB_PATH="${1:-/Users/system-backup/Library/Mobile Documents/com~apple~CloudDocs/Claude.AI Persistent Memory/memory-db}"

echo "Compacting LanceDB at: $DB_PATH"
echo "---"

uv run --with lancedb --with pylance python3 -c "
import lancedb
import warnings
warnings.filterwarnings('ignore', category=DeprecationWarning)

db_path = '''$DB_PATH'''
db = lancedb.connect(db_path)

tables = db.table_names()
print(f'Found tables: {tables}')
print()

for table_name in tables:
    print(f'Processing {table_name}...')
    table = db.open_table(table_name)
    
    # Compact fragments
    table.optimize()
    print(f'  ✓ Compacted')
    
    # Clean old versions
    table.cleanup_old_versions()
    print(f'  ✓ Cleaned old versions')

print()
print('Done!')
"

echo "---"
echo "Current sizes:"
du -sh "$DB_PATH"/*
