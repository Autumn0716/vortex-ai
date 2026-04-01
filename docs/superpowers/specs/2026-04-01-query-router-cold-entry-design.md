# Query Router Cold Entry Design

## Goal

Add a lightweight Query Router for agent memory retrieval and finish the first cold-entry lifecycle so explicit old-time queries can jump directly to cold memory while normal queries still prefer hot/warm memory and only fall back to cold when needed.

## Scope

This design covers:

- Rule-based time-intent routing for agent memory retrieval
- Cold-entry behavior on top of the existing file-backed memory lifecycle
- Stricter cold surrogate semantics using the existing `YYYY-MM-DD.cold.md` file
- Runtime retrieval-layer selection for memory context assembly

This design does not cover:

- LLM-based intent classification
- Cold-layer vectorization
- Nightly scheduled archival
- Deleting raw `daily/YYYY-MM-DD.md` source files
- GraphRAG or advanced reranking

## Existing State

The current project already uses Markdown files as the only memory source of truth:

- `memory/agents/<agent-slug>/MEMORY.md`
- `memory/agents/<agent-slug>/daily/YYYY-MM-DD.md`
- `memory/agents/<agent-slug>/daily/YYYY-MM-DD.warm.md`
- `memory/agents/<agent-slug>/daily/YYYY-MM-DD.cold.md`

The current lifecycle already:

- keeps raw `daily/YYYY-MM-DD.md` as source
- generates `warm.md` and `cold.md`
- deletes `warm.md` when a date enters cold tier
- prefers the effective daily representation by tier when building runtime memory context

What is still missing is the retrieval decision layer:

- explicit old-time queries should route directly to cold memory
- vague time references should not bypass hot/warm memory
- normal retrieval should fall back to cold only when hot/warm/global are insufficient

## Product Rules

### 1. Explicit Old-Time Query

If the user question contains an explicit time reference that can be deterministically resolved and the target time is more than 15 days older than `now`, retrieval should directly prioritize:

- `cold`
- `global`

Examples:

- `我 2026-03-01 那天让你写的方案是什么`
- `上个月那个方案`
- `去年说过的默认策略`

### 2. Vague Time Query

If the question only contains a vague time hint, it should behave like a normal query:

- search `hot + warm + global` first
- only fall back to `cold` if the first pass is insufficient

Examples:

- `之前那天说的那个方案`
- `以前提过的默认设置`
- `之前那个项目状态`

### 3. Cold Entry File Semantics

No new archive file type will be introduced.

Cold-entry output remains:

- `memory/agents/<agent-slug>/daily/YYYY-MM-DD.cold.md`

When a date enters cold tier:

- `YYYY-MM-DD.warm.md` must be deleted
- `YYYY-MM-DD.cold.md` becomes the only surrogate artifact for that date

The raw source file remains:

- `memory/agents/<agent-slug>/daily/YYYY-MM-DD.md`

### 4. Warm vs Cold Difference

Warm and cold are both surrogate Markdown layers. Their difference is only compression level.

`warm.md` keeps:

- readable summary
- metadata
- keywords
- limited contextual fragments
- open loops

`cold.md` keeps only:

- the most compact summary
- keyword tags
- minimal metadata needed for routing and retrieval

`cold.md` should be more aggressively compressed than `warm.md` and should not preserve long fragments.

## Routing Model

The Query Router is a deterministic rule layer, not a model call.

It produces:

- `mode`
  - `explicit_cold`
  - `default`
- `preferredLayers`
  - ordered subset of `hot | warm | cold | global`
- `fallbackLayers`
  - optional extra layers to try if the first pass is insufficient
- `matchedTimeExpression`
  - optional source substring for debugging

### Recognized Explicit Time Forms

The first version only needs stable, rule-parsable patterns:

- ISO-like dates
  - `2026-03-01`
  - `2026/03/01`
- Chinese month-day forms
  - `3月1日`
- relative time with stable coarse meaning
  - `上个月`
  - `上上周`
  - `去年`

### Non-Explicit Time Forms

These remain on the default path:

- `之前`
- `以前`
- `那天`
- `之前那个`
- `早些时候`

## Retrieval Behavior

### Default Mode

First pass:

- `hot + warm + global`

Second pass:

- add `cold` only when first-pass memory is insufficient

First-pass insufficiency for version one is deterministic:

- no selected memory documents, or
- fewer than 2 non-global memory documents

### Explicit Cold Mode

Single pass:

- `cold + global`

Hot/warm are skipped in this mode.

## Architecture

### A. Query Router Module

Introduce a focused router module under the existing memory lifecycle area. Its job is:

- parse time expressions from a user query
- resolve whether the target is older than 15 days
- decide layer order

It should not know anything about UI or file I/O.

### B. Cold Compression Refinement

Refine cold surrogate generation so `cold.md` is clearly more compact than `warm.md` and better suited for direct old-memory retrieval.

This remains deterministic and file-based.

### C. Runtime Memory Selection

Keep the existing LangGraph runtime unchanged.

Instead, change the memory selection path before prompt assembly:

- `ChatInterface` passes the user query to memory retrieval
- memory retrieval uses the Query Router
- selected documents are then formatted into the existing layered memory context

### D. No Second Storage Model

Do not introduce:

- `archive.md`
- a second lifecycle database
- a separate router-only cache

The system continues to rely on:

- Markdown source files
- surrogate Markdown files
- derived SQLite rows

## File Responsibilities

Likely files for the implementation:

- `src/lib/memory-lifecycle/query-router.ts`
  - rule-based time detection and layer routing
- `src/lib/memory-lifecycle/types.ts`
  - shared router result types
- `src/lib/agent-memory-lifecycle.ts`
  - cold surrogate refinement
- `src/lib/agent-memory-model.ts`
  - layer filtering helpers used by runtime selection
- `src/lib/agent-workspace.ts`
  - query-aware memory context retrieval
- `src/components/ChatInterface.tsx`
  - pass the current user query into memory context assembly

## Error Handling

- Router parse failure must not fail chat generation
- unrecognized time expressions fall back to default mode
- missing cold files must not fail retrieval
- explicit cold routing with no cold results should still return global memory

## Testing

At minimum:

- explicit old-time expression routes to `cold + global`
- vague time expression stays on default path
- default mode falls back to cold when hot/warm/global are insufficient
- hot tier does not fall through to stale warm/cold surrogates
- warm tier prefers `warm.md`
- cold tier prefers `cold.md`
- entering cold deletes `warm.md`
- `cold.md` is more compact than `warm.md`
- runtime context reflects routed layer choice without changing the LangGraph runtime itself

## Acceptance Criteria

- Explicit time queries older than 15 days go directly to cold memory.
- Vague time references do not skip hot/warm memory.
- Normal queries fall back to cold only when first-pass memory is insufficient.
- `cold.md` remains the only cold-entry surrogate file.
- `warm.md` is removed once a date enters cold tier.
- The implementation stays file-first and keeps the current LangGraph runtime unchanged.
