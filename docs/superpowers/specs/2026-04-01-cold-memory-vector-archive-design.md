# Cold Memory Vector Archive Design

## Goal

Add the first cold-memory vector archive so long-aged `*.cold.md` files can be embedded, indexed, and retrieved semantically when the runtime explicitly needs cold memory.

## Scope

This design covers:

- a dedicated vector index for agent cold-memory surrogates
- embedding sync for `memory/agents/<agent-slug>/daily/YYYY-MM-DD.cold.md`
- runtime cold-memory vector retrieval triggered only by the existing Query Router decisions
- reuse of the existing embedding configuration and client

This design does not cover:

- vectorizing global, hot, or warm memory
- replacing the existing file-backed memory source of truth
- changing the current Query Router rules
- nightly scheduled archival
- deleting raw `daily/YYYY-MM-DD.md` source files
- GraphRAG or memory-graph extraction

## Existing State

The project already has:

- Markdown memory source files under `memory/agents/<agent-slug>/...`
- deterministic warm/cold surrogate generation
- runtime Query Router behavior that decides when cold memory should be consulted
- a mature document-vector pipeline for the knowledge base:
  - embedding client
  - embedding configuration
  - SQLite JSON vector storage
  - cosine-similarity scoring

The memory side currently stops at derived SQLite rows in `agent_memory_documents`. Cold memory can be routed to, but it is still retrieved only as file-derived memory documents, not via semantic vector recall.

## Product Rules

### 1. Cold Memory Stays File-Backed

The source of truth remains:

- `memory/agents/<agent-slug>/daily/YYYY-MM-DD.md`
- `memory/agents/<agent-slug>/daily/YYYY-MM-DD.cold.md`

The vector archive is derived state only.

### 2. Only Cold Tier Enters the Vector Archive in V1

For this version, only effective cold surrogates are embedded:

- `sourceType = cold_summary`
- `tier = cold`

Global, hot, and warm memory are intentionally out of scope for this round.

### 3. Cold Vector Retrieval Is Conditional

Cold vector retrieval should run only when the runtime already intends to consult cold memory:

- Query Router mode is `explicit_cold`
- or default routing found recent memory insufficient and falls back to cold

The system must not run cold-memory embedding search for every user query by default.

### 4. Existing Recent-Layer Preference Remains

This feature does not weaken the current preference order:

- normal questions still prefer `hot + warm + global`
- cold vector retrieval is a late-stage semantic supplement, not a new default first pass

## Architecture

### A. Dedicated Memory Vector Tables

Use a dedicated SQLite storage path for memory vectors instead of reusing `documents/document_chunks/document_chunk_embeddings`.

Recommended schema:

#### `agent_memory_embeddings`

- `memory_document_id TEXT PRIMARY KEY`
- `agent_id TEXT NOT NULL`
- `event_date TEXT`
- `source_type TEXT NOT NULL`
- `embedding_model TEXT NOT NULL`
- `embedding_dimensions INTEGER NOT NULL`
- `embedding_json TEXT NOT NULL`
- `content_preview TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Recommended indexes:

- `(agent_id, source_type, updated_at DESC)`
- `(agent_id, event_date DESC)`

This keeps memory retrieval independent from knowledge-base documents and leaves room for future expansion to global/hot/warm memory without reshaping the model.

### B. Cold Embedding Sync

Cold embedding sync belongs in the memory sync path, not in the UI.

When the lifecycle or file sync path determines that a cold surrogate is current and effective:

1. derive the cold memory document row as today
2. if vector search is enabled and embedding config is available:
   - embed the cold surrogate body
   - upsert the corresponding row into `agent_memory_embeddings`
3. if the cold surrogate disappears or is no longer effective:
   - delete the stale memory embedding row

The embedding payload should use the semantic body of `cold.md`, not the raw source daily log.

### C. Runtime Retrieval Layer

Add a focused cold-memory retrieval helper that:

- accepts `agentId`
- accepts the current user query
- embeds the query with the existing embedding config
- scans only that agent’s `agent_memory_embeddings`
- ranks by cosine similarity
- returns a small list of matching cold memory documents

The first version should return a small number of results, such as 2 to 4 cold-memory hits.

### D. Integration With Existing Query Router

The existing Query Router remains the gatekeeper.

Runtime behavior:

#### `explicit_cold`

- run cold-memory vector retrieval
- merge with global memory context
- skip hot/warm retrieval

#### `default`

- first build memory context from `hot + warm + global`
- if recent layers are insufficient under the existing rule, trigger cold-memory vector retrieval
- merge top cold-memory hits into the final memory context

This keeps semantic cold recall aligned with the route already selected by the deterministic router.

## Data Flow

### Sync Path

1. Markdown files are scanned for the current agent
2. effective `cold.md` surrogates are derived into `agent_memory_documents`
3. cold-surrogate content is embedded
4. vectors are upserted into `agent_memory_embeddings`
5. removed or obsolete cold surrogates delete their vector rows

### Query Path

1. user sends a message
2. Query Router decides whether cold memory should be consulted
3. if cold is needed:
   - embed the current query
   - search `agent_memory_embeddings`
   - map top hits back to their corresponding cold memory documents
4. merge those results into memory prompt assembly

## Retrieval Semantics

Cold vector retrieval should return only cold summaries for the active agent.

The semantic retrieval should not:

- cross agent boundaries by default
- return raw daily source files
- return warm surrogates
- replace the existing global-memory injection path

When merging cold vector hits into prompt assembly:

- deduplicate by `memory_document_id`
- preserve the existing “one effective document per day” rule
- avoid injecting the same day twice if a cold document is already present in the routed set

## Error Handling

Cold vectorization must degrade safely.

If embedding config is missing, invalid, or embedding requests fail:

- cold vector sync should be skipped
- the workspace should still function
- file-backed cold memory retrieval should continue to work

If vector rows are stale or missing:

- a later resync should rebuild them
- runtime should not crash; it should simply return fewer cold semantic hits

## Testing

The first implementation should cover:

- schema creation for `agent_memory_embeddings`
- cold surrogate sync creates embedding rows when embedding config is available
- cold surrogate updates refresh the vector row
- removed cold surrogates delete stale vector rows
- `explicit_cold` queries trigger cold vector retrieval
- default routing only triggers cold vector retrieval when recent layers are insufficient
- missing embedding config safely skips vector sync and query-time vector retrieval

## Out-of-Scope Follow-Ups

Deliberately postponed:

- vectorizing `MEMORY.md`
- vectorizing hot/warm memory
- nightly cold archive jobs
- importance-score-driven retention
- cross-agent memory vector search
- reranking across recent memory and cold vector hits

## Implementation Notes

Likely implementation areas:

- `src/lib/agent-workspace-schema.ts`
- `src/lib/agent-memory-sync.ts`
- `src/lib/agent-workspace.ts`
- `src/lib/db.ts`
- `tests/agent-memory-sync.test.ts`
- new cold-memory vector retrieval tests near the memory/runtime test suite

The implementation should reuse the current embedding settings from agent document configuration rather than inventing a second memory-specific embedding configuration surface.
