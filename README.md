# Claude Memory MCP Server

[![Node.js 18+](https://img.shields.io/badge/node-18%2B-blue.svg)](https://nodejs.org/en/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A LanceDB-backed MCP server that gives Claude persistent, searchable memory across conversations. Store decisions, insights, context, and action items that persist beyond the conversation window.

## Features

- **Persistent Memory** - Topics, memories, and todos that survive across conversations
- **Semantic Search** - Find relevant memories by meaning, not just keywords
- **Local Embeddings** - ONNX-based embeddings (all-MiniLM-L6-v2) run locally with zero API costs
- **Minimal Token Overhead** - Compact responses by default, full content on request
- **Graceful Degradation** - Works without embeddings (CRUD only), gains semantic search when available
- **Optional RAG** - Includes document chunking/search tools from the original lance-mcp

## Quick Start

### 1. Install Dependencies

```bash
git clone https://github.com/slaughters85j/claude-memory-mcp.git
cd claude-memory-mcp
npm install
```

### 2. Configure Claude Desktop

Add to your Claude Desktop config:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "claude-memory": {
      "command": "node",
      "args": [
        "/path/to/claude-memory-mcp/dist/index.js",
        "/path/to/memory-db"
      ]
    }
  }
}
```

### 3. Add System Prompt (Recommended)

Add the following to your Claude Desktop Settings under **General → Preferences**:

```markdown
## Memory System

You have access to a persistent memory database via the claude-memory MCP. Use it to maintain continuity across conversations. This is YOUR memory of our work together - use it proactively.

### At Conversation Start
Always call `get_session_context` at the beginning of conversations to check for:
- Overdue or high-priority todos
- Recent activity on active projects  
- Stale topics that may need attention

If there are relevant open items, mention them upfront. Example: "Before we dive in - you have 2 overdue items on AlarmWizard. Want to knock those out first?"

### During Conversations
- Before claiming you don't know something about our past work, use `search_memories` first
- When significant decisions are made, store them with `add_memory` (kind: "decision")
- When we hit a gotcha or learn something important, store it (kind: "insight" or "blocker")
- When action items come up, create todos with `add_todo`
- When a topic comes up, check `get_topic` for existing context before asking me to re-explain

### What to Store
DO store:
- Architectural decisions and their rationale
- Technical gotchas and workarounds we discovered
- Project status changes and milestones
- Blockers encountered and how we resolved them
- My preferences as you learn them

DON'T store:
- Transient troubleshooting that won't matter later
- Generic information you already know
- Every minor detail - distill to what matters for future recall

### Memory Quality
- Keep memories concise: 1-10 sentences focused on what matters for future recall
- Use `supersedes_id` when updating existing knowledge rather than creating duplicates
- Adjust importance (0.0-1.0) based on how often something is likely to be relevant
- Link todos to memories that explain their context

### Token Efficiency  
- Use `include_content: false` on searches unless you need full text
- Filter with topic_id, tags, and kind_filter to narrow results
- Summarize retrieved memories in responses rather than dumping raw content
```

#### Memory-Only Version (for Project Instructions)

Use this in project-specific instruction sections where you already have other context:

```markdown
## Memory System

You have access to a persistent memory database via the claude-memory MCP. Use it proactively to maintain continuity.

### Conversation Start
Always call `get_session_context` first to surface overdue todos, recent activity, and stale topics. Mention relevant open items upfront.

### During Conversations
- Call `search_memories` before claiming ignorance about our past work
- Store decisions with `add_memory` (kind: "decision") 
- Store gotchas and insights (kind: "blocker" or "insight")
- Create todos with `add_todo` when action items come up
- Check `get_topic` for existing context on active projects

### What to Store
Store: decisions with rationale, technical gotchas, project milestones, blockers and resolutions, learned preferences
Skip: transient troubleshooting, generic knowledge, minor details

### Quality Guidelines
- Keep memories to 1-10 sentences, distilled for future relevance
- Use `supersedes_id` to update rather than duplicate
- Link todos to explanatory memories
- Use `include_content: false` and filters to minimize token overhead
```

#### Minimal Version (for quick addition to any project)

```markdown
## Memory

Use claude-memory MCP proactively:
- Start conversations with `get_session_context` to surface open items
- `search_memories` before claiming you don't remember our past work
- `add_memory` for decisions, gotchas, insights worth preserving
- `add_todo` for action items
- Keep memories concise (1-10 sentences), use filters to minimize tokens
```

### 4. Restart Claude Desktop

The server will:
1. Create the database directory if it doesn't exist
2. Initialize memory tables (topics, memories, todos)
3. Download the ONNX embedding model on first use (~80MB, one-time)

## Available Tools

### Session Tools

| Tool | Description |
|------|-------------|
| `get_session_context` | Get summary of open items and recent activity. Call at conversation start. |

### Topic Tools

| Tool | Description |
|------|-------------|
| `create_topic` | Create a new topic to organize memories |
| `update_topic` | Update topic metadata or status |
| `list_topics` | List topics with optional filtering |
| `get_topic` | Get full topic details with memories and todos |
| `delete_topic` | Delete a topic (optionally orphan or delete children) |

### Memory Tools

| Tool | Description |
|------|-------------|
| `add_memory` | Store a distilled memory (decision, insight, context, etc.) |
| `update_memory` | Update memory content or metadata |
| `search_memories` | Semantic search across memories |
| `get_memory` | Get full memory details with linked todos |
| `get_memory_timeline` | Chronological memory history for a topic |
| `delete_memory` | Delete a memory |

### Todo Tools

| Tool | Description |
|------|-------------|
| `add_todo` | Create an action item linked to topic/memory |
| `update_todo` | Update todo details or status |
| `list_todos` | List todos with filtering and sorting |
| `delete_todo` | Delete a todo |

### Maintenance Tools

| Tool | Description |
|------|-------------|
| `prune_stale_data` | Clean up old, low-importance data (dry-run by default) |
| `export_topic` | Export topic as JSON or Markdown |

### RAG Tools (Optional)

These require seeding documents first (see [RAG Setup](#rag-setup-optional)):

| Tool | Description |
|------|-------------|
| `catalog_search` | Search document catalog |
| `chunks_search` | Search chunks from a specific document |
| `all_chunks_search` | Search chunks across all documents |

## Configuration

### Embedding Providers

**Default — Local ONNX embeddings (all-MiniLM-L6-v2, 384 dims):**

```json
{
  "mcpServers": {
    "claude-memory": {
      "command": "node",
      "args": [
        "/path/to/claude-memory-mcp/dist/index.js",
        "/path/to/memory-db"
      ]
    }
  }
}
```

**OpenAI embeddings (text-embedding-3-small):**

```json
{
  "mcpServers": {
    "claude-memory": {
      "command": "node",
      "args": [
        "/path/to/claude-memory-mcp/dist/index.js",
        "/path/to/memory-db"
      ],
      "env": {
        "PREFER_OPENAI_EMBEDDINGS": "true",
        "OPENAI_API_KEY": "sk-your-key-here"
      }
    }
  }
}
```

**Disabled — CRUD only, text-based search fallback:**

```json
{
  "mcpServers": {
    "claude-memory": {
      "command": "node",
      "args": [
        "/path/to/claude-memory-mcp/dist/index.js",
        "/path/to/memory-db"
      ],
      "env": {
        "DISABLE_EMBEDDINGS": "true"
      }
    }
  }
}
```

## Recommended System Prompt

Add to your Claude Desktop custom instructions:

```markdown
## Memory System

You have access to a persistent memory database via MCP tools.

### At Conversation Start
- Call `get_session_context` to check for:
  - Overdue or high-priority todos
  - Recent activity on active projects
  - Stale topics that may need attention
- If there are open items, mention them proactively

### During Conversation
- When significant decisions are made, store them with `add_memory` (kind: "decision")
- When we learn something important, store it (kind: "insight")
- When action items are identified, create todos with `add_todo`
- When asking about past work, use `search_memories` before claiming you don't know
- Keep memory content concise: 1-10 sentences

### Memory Quality Guidelines
- Don't store transient or trivial information
- Do store: decisions and rationale, technical gotchas, project status, blockers, preferences
- Link todos to memories that explain their context
- Use `supersedes_id` when updating rather than creating duplicate memories

### Token Efficiency
- Use `include_content: false` on search unless you need full text
- Filter aggressively with topic_id, tags, kind_filter
```

## Data Model

### Topics
Conceptual buckets for organizing memories (projects, themes, domains).

```typescript
{
  id: string;
  name: string;                    // "Project xyz", "MyJob-Work"
  description: string;
  tags: string[];
  status: "active" | "paused" | "completed" | "archived";
  importance: number;              // 0.0 - 1.0
  created_at: string;              // ISO 8601
  updated_at: string;
  last_referenced_at: string;
}
```

### Memories
Atomic knowledge items with optional semantic search.

```typescript
{
  id: string;
  topic_id: string | null;
  title: string;                   // Short label (< 100 chars)
  content: string;                 // 1-10 sentences
  kind: "decision" | "insight" | "context" | "preference" |
        "outcome" | "blocker" | "reference" | "other";
  tags: string[];
  importance: number;              // 0.0 - 1.0
  conversation_summary: string | null;
  supersedes_id: string | null;    // Links to replaced memory
  vector: number[] | null;         // Embedding for semantic search
}
```

### Todos
Actionable items with status tracking.

```typescript
{
  id: string;
  topic_id: string | null;
  memory_id: string | null;        // Context for why this exists
  title: string;
  description: string | null;
  status: "open" | "in_progress" | "done" | "blocked" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  due_at: string | null;           // ISO 8601
  completed_at: string | null;
}
```

## RAG Setup (Optional)

The original lance-mcp RAG functionality is preserved for document search. This is **separate from the memory system** and requires additional setup.

### Seed Documents

First, install the Ollama models used for document summarization and chunking:

```bash
ollama pull snowflake-arctic-embed2
ollama pull llama3.1:8b
```

Then seed your documents:

```bash
npm run seed -- --dbpath /path/to/memory-db --filesdir /path/to/pdfs
```

Options:
- `--overwrite` - Recreate tables from scratch

This creates two additional tables:
- **catalog** - Document summaries with metadata
- **chunks** - Vectorized document chunks for search

## Development

```bash
# Build
npm run build

# Watch mode
npm run watch

# Type-check sources and scripts (no emit)
npm run typecheck

# Run the count/list regression checks against a throwaway store
npm test            # == npm run typecheck && npm run verify:counts

# Interactive testing with MCP Inspector
npx @modelcontextprotocol/inspector dist/index.js /path/to/test-db
```

`scripts/verify-counts.ts` builds a temporary LanceDB, seeds fixtures above
LanceDB's default 10-row query limit, and asserts the aggregate/list functions
return exact results. GitHub Actions runs `build`, `typecheck`, and
`verify:counts` on every push and pull request (`.github/workflows/ci.yml`).

## Database Maintenance

LanceDB writes a new version on every change, so the store fragments over time
(each `last_referenced_at` touch rewrites a topic row). To compact fragments and
prune old versions:

```bash
scripts/compact-db.sh --dry-run   # preview row/version counts, no changes
scripts/compact-db.sh             # optimize + prune (takes a backup first)
```

Quit Claude Desktop first so no memory server is writing the store. The script
snapshots the database to `~/Backups/claude-memory/` before mutating anything
and retains a 7-day rollback window. See
[scripts/COMPACTION.md](scripts/COMPACTION.md) for the full procedure and
restore steps.

## Backups

Compaction keeps only a short rollback window; real backups are separate.
`scripts/backup-db.ts` takes an application-consistent, verified tarball of the
store while the servers keep running:

```bash
npm run backup                 # back up the live store to ~/Backups/claude-memory
npm run backup -- --dry-run    # every check, writes nothing
npm run restore -- --from <tarball> --to <dir>
```

Retention is 30 days (never fewer than 7 backups), each tarball has a sha256'd
manifest, and a daily 03:15 run is available as a launchd agent. iCloud is
replication, not backup, so the destination is guarded against resolving into
iCloud Drive. See [scripts/BACKUP.md](scripts/BACKUP.md) for the hot-copy
correctness argument, retention, restore, and scheduling.

## Token Budget

Estimated response sizes:

| Operation | Typical | Max |
|-----------|---------|-----|
| `get_session_context` | ~300 tokens | ~800 tokens |
| `list_topics` (20 items) | ~400 tokens | ~800 tokens |
| `search_memories` (10, no content) | ~250 tokens | ~500 tokens |
| `search_memories` (10, with content) | ~1500 tokens | ~3000 tokens |
| `list_todos` (20 items) | ~400 tokens | ~800 tokens |

## License

MIT License - see [LICENSE](LICENSE) file.

## Credits

Based on [lance-mcp](https://github.com/adiom-data/lance-mcp) by Alex Komyagin.
