# Memory Warm/Cold Lifecycle Design

## Goal

Add a visible warm/cold lifecycle for agent daily memory while keeping Markdown as the source of truth, preserving the existing LangGraph runtime, and preferring surrogate memory files over raw daily logs when older context is injected or retrieved.

## Scope

This design covers:

- Warm and cold surrogate file layout beside existing `daily/YYYY-MM-DD.md` files
- Deterministic warm/cold summarization without requiring an LLM
- Lifecycle synchronization that generates or refreshes surrogate files for the current agent
- Runtime read precedence that prefers surrogate files over raw daily files
- Derived SQLite sync for warm/cold surrogate documents
- Settings UI controls to trigger lifecycle synchronization and inspect surrogate files
- Error handling and test strategy for the lifecycle flow

This design does not include:

- Nightly or cron-based scheduling
- Deleting or compressing raw source daily files
- Cross-agent lifecycle synchronization by default
- Query Router implementation
- GraphRAG or knowledge graph extraction
- LLM-based importance scoring

## Requirements

### Product Requirements

- Raw daily memory files remain at `memory/agents/<agent-slug>/daily/YYYY-MM-DD.md`.
- Warm surrogate files live beside the source file as `YYYY-MM-DD.warm.md`.
- Cold surrogate files live beside the source file as `YYYY-MM-DD.cold.md`.
- Raw daily files remain preserved in the repository for now.
- Runtime should prefer surrogate files for warm/cold dates and only fall back to source files when the surrogate is missing.
- Each date should only contribute one effective runtime document.
- Users can inspect warm/cold surrogate files from the existing Settings memory UI.
- Users can manually trigger lifecycle synchronization from the frontend.
- Agent runtime integration must continue to use the existing LangGraph runtime.

### Persistence Requirements

- Raw `daily/YYYY-MM-DD.md` files remain the source files for short-term memory.
- Warm/cold surrogate files are deterministic derived artifacts stored as Markdown files.
- SQLite remains a rebuildable index/cache layer for both source files and surrogate files.
- Lifecycle sync must be idempotent: rerunning with unchanged source files should not rewrite unchanged surrogate files or churn derived rows.

### Retrieval Requirements

- Hot memory (`0-2` days) uses the raw daily file.
- Warm memory (`3-15` days) prefers `YYYY-MM-DD.warm.md`.
- Cold memory (`15+` days) prefers `YYYY-MM-DD.cold.md`.
- When a preferred surrogate is missing, runtime falls back to the next available representation:
  - cold -> warm -> raw
  - warm -> raw
- Recent snapshot assembly still prioritizes hot memory; warm memory may appear in summarized form; cold memory should not appear in the recent snapshot by default.

## Storage Model

### Directory Layout

```text
memory/
  agents/
    <agent-slug>/
      MEMORY.md
      daily/
        2026-04-01.md
        2026-04-01.warm.md
        2026-04-01.cold.md
```

### File Semantics

#### Raw Daily File

- `YYYY-MM-DD.md` remains the preserved source log for that day.
- It is still human-editable and remains the base input for lifecycle generation.

#### Warm Surrogate

- `YYYY-MM-DD.warm.md` is a readable summarized surrogate for dates aged `3-15` days.
- It should contain:
  - a concise summary
  - selected key fragments
  - extracted open loops
  - keywords

#### Cold Surrogate

- `YYYY-MM-DD.cold.md` is a more compressed surrogate for dates aged `15+` days.
- It should contain:
  - a shorter summary
  - keywords/tags
  - time/index metadata
  - no long fragment blocks unless strictly necessary

### Surrogate Frontmatter

Both surrogate file types should include lightweight frontmatter:

- `title`
- `date`
- `tier`
- `sourcePath`
- `updatedAt`
- `importance`
- `keywords`

## Architecture

### Components

#### 1. Lifecycle File Helper

Responsibilities:

- Resolve warm/cold surrogate paths from an agent slug and date
- Detect whether a daily path is a source file, warm surrogate, or cold surrogate
- Parse/serialize surrogate frontmatter and body

#### 2. Lifecycle Summarizer

Responsibilities:

- Build deterministic warm/cold surrogate content from raw daily Markdown
- Reuse current open-loop extraction and existing importance heuristics
- Avoid requiring external model calls for the first implementation

Warm summarization should preserve more operator-readable context.
Cold summarization should aggressively compress.

#### 3. Lifecycle Synchronizer

Responsibilities:

- Scan the current agent's raw daily files
- Classify each file into hot/warm/cold based on date age
- Create or refresh surrogate files when needed
- Remove stale lower-priority surrogate ambiguity when a date moves to a later tier
- Return a structured sync summary

This sync remains per-agent and explicit for the first release.

#### 4. Derived Index Synchronizer

Responsibilities:

- Index the effective representation for each date into `agent_memory_documents`
- Distinguish source vs warm vs cold via `source_type`
- Ensure runtime does not receive duplicate representations for the same date

The first implementation should extend the current `source_type` domain with:

- `conversation_log`
- `warm_summary`
- `cold_summary`

#### 5. Runtime Memory Selector

Responsibilities:

- Choose the effective per-date representation before assembling memory context
- Preserve current LangGraph prompt construction flow
- Ensure only one effective document per date is included

Selection order:

- hot: raw
- warm: warm surrogate, else raw
- cold: cold surrogate, else warm surrogate, else raw

#### 6. Settings Lifecycle Controls

Responsibilities:

- Let the user trigger warm/cold lifecycle sync for the active agent
- Show sync status and failures
- Surface surrogate files in the existing memory file list

The UI must preserve the current theme shell and file-editor mental model.

## Data Flow

### Manual Lifecycle Sync

1. User triggers lifecycle sync for the current agent
2. App scans `daily/YYYY-MM-DD.md` source files only
3. App computes the age tier for each date
4. App generates or refreshes `*.warm.md` / `*.cold.md` as needed
5. App refreshes derived SQLite memory rows for the current agent
6. App reloads visible file state in Settings

### Startup/Bootstrap Sync

1. Current agent memory files are scanned
2. Lifecycle sync may be invoked explicitly by the bootstrap path in a later implementation step
3. Derived rows are refreshed from the effective file representation

The first batch may expose lifecycle sync through a dedicated function and manual UI trigger before wiring it deeper into bootstrap.

### Runtime Retrieval

1. Runtime asks for agent memory context
2. Effective memory documents are resolved per date using tier precedence
3. Long-term memory, recent snapshot, open loops, and tiered memory sections are assembled
4. Existing LangGraph runtime receives the final memory context string

## Deterministic Summarization Rules

### Warm Tier

Warm surrogates should preserve enough detail for medium-range recall.

Recommended structure:

- `## Summary`
- `## Key Fragments`
- `## Open Loops`
- `## Keywords`

Warm summary content should be derived from:

- the first meaningful lines of the source daily file
- lines with explicit `TODO / 待办 / 阻塞 / next step`
- lines with higher heuristic importance

### Cold Tier

Cold surrogates should compress more aggressively.

Recommended structure:

- `## Summary`
- `## Keywords`
- `## Index`

Cold summaries should:

- reduce long fragments to short bullets
- keep temporal cues and the most important unresolved items
- omit verbose conversational detail

## Error Handling

- A malformed or failed source file should not stop the entire agent sync.
- Sync should return:
  - number of source files scanned
  - warm files created/updated
  - cold files created/updated
  - files skipped
  - failures with file paths
- Settings should display lifecycle sync failures with the relevant file paths.
- Runtime should fall back to the next available representation if a preferred surrogate file is missing.

## Testing Strategy

### Unit Tests

- surrogate path resolution
- source/warm/cold file detection
- warm/cold summarization output shape
- tier classification boundaries
- idempotent lifecycle sync
- precedence resolution for effective runtime documents

### Integration Tests

- source daily file -> warm surrogate generation
- source daily file -> cold surrogate generation
- derived SQLite rows use the effective representation
- runtime context contains one document per date
- Settings-triggered lifecycle sync reports success/failure correctly

## Acceptance Criteria

- Warm and cold surrogate Markdown files are generated beside raw daily files.
- Raw daily files remain preserved.
- Runtime prefers surrogate files over raw daily files for warm/cold dates.
- No duplicate per-date injection occurs in runtime memory context.
- SQLite indexes warm/cold surrogate documents as derived records.
- Settings can trigger lifecycle sync and show the resulting files/status.
- Existing LangGraph runtime remains the only agent runtime.
