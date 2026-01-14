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

### 3. Restart Claude Desktop

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

The server uses local ONNX embeddings by default. Configure via environment variables:

```json
{
  "mcpServers": {
    "claude-memory": {
      "command": "node",
      "args": ["..."],
      "env": {
        "DISABLE_EMBEDDINGS": "true"
      }
    }
  }
}
```

| Variable | Effect |
|----------|--------|
| *(default)* | Local ONNX embeddings (all-MiniLM-L6-v2, 384 dims) |
| `PREFER_OPENAI_EMBEDDINGS=true` + `OPENAI_API_KEY=sk-...` | Use OpenAI text-embedding-3-small |
| `DISABLE_EMBEDDINGS=true` | No embeddings, CRUD only, text-based search fallback |

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

# Test with MCP Inspector
npx @modelcontextprotocol/inspector dist/index.js /path/to/test-db
```

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
