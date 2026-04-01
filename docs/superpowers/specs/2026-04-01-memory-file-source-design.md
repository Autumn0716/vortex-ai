# Memory File Source Of Truth Design

## Goal

Replace browser-only memory persistence with agent-scoped Markdown files that act as the single source of truth for long-term and daily memory, while keeping SQLite as a rebuildable indexing and cache layer for retrieval.

## Scope

This design covers:

- Agent-scoped memory file layout
- Markdown-as-source persistence rules
- SQLite indexing responsibilities
- Startup scanning and incremental reindexing
- UI editing flows inside the existing Settings memory area
- Migration from current SQLite-backed memory records
- Error handling and verification strategy

This design does not include:

- Cross-agent default retrieval without explicit user intent
- GraphRAG or knowledge graph extraction
- Nightly archival automation for warm/cold tier compaction
- Cross-encoder reranking

## Requirements

### Product Requirements

- Memory must be visible as project files that users can inspect, back up, and edit directly.
- Long-term memory must live at `memory/agents/<agent-slug>/MEMORY.md`.
- Short-term memory must live at `memory/agents/<agent-slug>/daily/YYYY-MM-DD.md`.
- By default, each agent only scans and retrieves from its own memory directory.
- Cross-agent scanning only happens when the user explicitly requests it.
- The frontend must allow users to edit these memory files directly.
- The memory UI must stay visually consistent with the existing Settings theme and layout.

### Persistence Requirements

- Markdown files are the only source of truth.
- SQLite is derived state used for indexing, search, and cache acceleration.
- When memory changes through the UI, the app must write Markdown first and then refresh that agent's index.
- When users edit Markdown manually, a rescan must restore SQLite consistency.

### Retrieval Requirements

- Agent runtime uses the current agent's memory files by default.
- Retrieval and indexing only operate on the current agent's memory directory unless the request explicitly targets another agent.
- Long-term memory, recent memory snapshots, and open loops remain available to prompt construction.

## Storage Model

### Directory Layout

```text
memory/
  agents/
    <agent-slug>/
      MEMORY.md
      daily/
        2026-04-01.md
        2026-04-02.md
```

### File Semantics

#### `MEMORY.md`

- Holds the agent's long-term memory.
- Human-editable Markdown.
- May include lightweight frontmatter for metadata such as:
  - `title`
  - `updatedAt`
  - `importance`
- Main body remains normal Markdown so users can freely maintain it.

#### `daily/YYYY-MM-DD.md`

- One file per day per agent.
- Stores daily activity log, short-term context, key fragments, pending tasks, and blockers.
- Human-editable Markdown.
- May include lightweight frontmatter for:
  - `date`
  - `updatedAt`
- Main body remains append-friendly Markdown.

## Source Of Truth Rules

### Rule 1

Markdown memory files are authoritative. SQLite must never be treated as the canonical store for agent memory.

### Rule 2

SQLite memory rows and search indexes are rebuildable artifacts derived from Markdown.

### Rule 3

UI writes follow this order:

1. Write Markdown file
2. Rescan the current agent memory directory
3. Refresh the current agent search index and runtime memory cache

### Rule 4

Manual file edits outside the app are supported. The app restores consistency through explicit or automatic rescans.

## Architecture

### Components

#### 1. Memory File Store

Responsibilities:

- Resolve agent memory paths from agent slug
- Read and write `MEMORY.md`
- Read, create, and append `daily/YYYY-MM-DD.md`
- Parse and serialize frontmatter plus Markdown body

Primary boundary:

- File system oriented
- No retrieval logic
- No prompt assembly logic

#### 2. Memory File Scanner

Responsibilities:

- Scan the current agent memory directory
- Parse long-term and daily memory files
- Convert file contents into normalized in-memory records
- Report per-file parse failures without aborting the entire scan

Primary boundary:

- Read-only normalization layer
- Produces structured memory documents for indexing

#### 3. Memory Index Synchronizer

Responsibilities:

- Take normalized memory documents from the scanner
- Upsert derived SQLite memory/index rows
- Remove stale derived rows for files that no longer exist
- Trigger document chunking and search index refresh for memory-backed content

Primary boundary:

- SQLite-only derived state
- No direct file writes

#### 4. Runtime Memory Assembler

Responsibilities:

- Load normalized memory records for the current agent
- Build:
  - long-term memory section
  - recent memory snapshot
  - open loops
- Respect memory settings toggles

Primary boundary:

- Prompt assembly only
- No storage writes

#### 5. Settings Memory Editor

Responsibilities:

- Present `MEMORY.md` as the long-term memory editor
- Present daily files as a list plus editor pane
- Save file edits through the file store
- Trigger rescans and report parse/write failures

Primary boundary:

- Existing Settings visual language stays intact
- No redesign of the shell

## Data Flow

### Startup

1. Resolve current agent slug and memory directory
2. Scan `memory/agents/<agent-slug>/`
3. Parse `MEMORY.md`
4. Parse `daily/*.md`
5. Normalize records
6. Rebuild or incrementally refresh SQLite derived indexes for that agent
7. Expose normalized memory to runtime and Settings UI

### UI Save

1. User edits long-term or daily memory in Settings
2. App writes Markdown file
3. App rescans only the current agent directory
4. App refreshes derived SQLite rows and retrieval indexes
5. App refreshes visible editor state and runtime memory context

### Automatic Conversation Writes

1. User or assistant message generates daily activity updates
2. App appends the formatted log entry to today's daily file
3. App rescans or incrementally reindexes the current agent memory directory
4. Runtime prompt construction sees updated short-term memory on the next invocation

### Manual File Edits

1. User edits Markdown outside the app
2. User triggers rescan, or app rescans on next startup
3. Scanner reparses current agent memory files
4. Derived SQLite indexes are refreshed

## SQLite Responsibilities After Migration

SQLite remains useful, but only for derived state:

- memory retrieval acceleration
- chunk index / search cache
- BM25 / FTS / vector retrieval artifacts
- metadata needed for querying and ranking

SQLite must not be the only copy of:

- long-term memory content
- daily memory content

## Migration Plan

### Initial Migration

For each agent:

1. Resolve `<agent-slug>`
2. If `memory/agents/<agent-slug>/MEMORY.md` does not exist:
   - generate it from existing long-term memory records
3. If daily files do not exist:
   - generate `daily/YYYY-MM-DD.md` files from existing daily/session memory rows where data exists
4. After file generation succeeds:
   - mark file-backed memory as active for that agent
5. Continue using SQLite rows only as derived data

### Safety Constraints

- Never overwrite an existing user-authored `MEMORY.md` automatically
- Never overwrite an existing daily Markdown file automatically
- If both file and SQLite data exist, file content wins
- Migration failures must be reported per agent and per file

## Retrieval Policy

### Default Policy

- Scan and retrieve only from the active agent's memory directory

### Explicit Cross-Agent Policy

- Only broaden retrieval when the user explicitly references another agent or requests cross-agent memory access

### Prompt Assembly

Runtime memory prompt may include:

- long-term memory from `MEMORY.md`
- recent memory snapshot from recent daily files
- open loops extracted from recent daily content

## UI Design Constraints

The Settings memory experience must remain consistent with the current theme and structure:

- keep existing card layout
- keep existing dark theme tokens, borders, radius, spacing, and editor treatment
- extend the current memory category instead of introducing a new visual subsystem
- clearly label which file is being edited:
  - `MEMORY.md`
  - `daily/YYYY-MM-DD.md`

### Proposed UI Sections

#### Long-Term Memory

- Single editor for `MEMORY.md`
- Save button
- Rescan button
- File path shown as supporting text

#### Daily Memory

- File list for available `daily/*.md`
- Right-side editor for selected day
- Create today's file if missing
- Save and rescan actions

#### Sync Status

- last scan time
- parse errors
- stale index warnings

## Error Handling

### File Read/Write Errors

- Show file path and exact error in the UI
- Do not crash workspace bootstrap because one memory file failed

### Parse Errors

- Report the specific file
- Skip only the bad file
- Continue scanning the rest of the agent directory

### Index Sync Errors

- Preserve Markdown source files
- Surface indexing failure separately from file write success
- Allow manual rescan

## Testing Strategy

### Unit Tests

- agent slug to memory path resolution
- `MEMORY.md` parse and serialize
- daily file parse and serialize
- open loops extraction from daily files
- file-wins-over-sqlite merge behavior

### Integration Tests

- startup scan populates derived SQLite state
- editing `MEMORY.md` updates runtime memory
- editing a daily file updates recent snapshot/open loops
- migration from existing SQLite memory to Markdown files
- broken file does not block other files

### UI Verification

- Settings memory page stays within existing visual system
- save flow writes file then triggers rescan
- user can edit long-term and daily memory without leaving the app

## README Changes

Add a section documenting:

- memory directory layout
- Markdown as source of truth
- SQLite as rebuildable index/cache
- default current-agent-only scanning
- frontend editing support
- rescan behavior after manual edits

## Rollout Plan

### Phase 1

- Introduce file store and scanner
- Support `MEMORY.md` read/write
- Support daily file read/write
- Add manual rescan for current agent

### Phase 2

- Migrate existing SQLite memory into Markdown files
- Switch runtime memory reads to file-backed flow
- Keep SQLite as derived index layer

### Phase 3

- Expand UI editing for historical daily files
- Add better sync status and diagnostics
- Prepare for later warm/cold archival automation

## Open Decisions Already Resolved

- Source of truth: Markdown files
- Long-term file name: `MEMORY.md`
- Daily memory layout: `daily/YYYY-MM-DD.md`
- Agent isolation: default current-agent-only scanning
- UI access: editable from frontend
- Visual language: must match current Settings theme

## Acceptance Criteria

- Agent memory exists as visible Markdown files under `memory/agents/<agent-slug>/`
- Users can edit long-term and daily memory from the frontend
- Startup rescans current agent memory files and rebuilds SQLite derived indexes
- Runtime prompt construction reads file-backed memory rather than SQLite-only canonical rows
- Existing agents can migrate without losing memory
- README documents the new storage model
