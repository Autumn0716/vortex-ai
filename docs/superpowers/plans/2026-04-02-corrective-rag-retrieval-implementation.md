# Corrective RAG Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-pass corrective retrieval layer so weak or sparse knowledge-base results automatically trigger one more focused retrieval pass instead of immediately stopping at low-support snippets.

**Architecture:** Keep the current deterministic `query rewrite -> hybrid recall -> rerank -> compression -> support check` pipeline. After the primary pass, inspect support signals and result density. When support is weak, derive corrective query variants from the user query plus graph/entity hints, run a second retrieval pass, then merge and rerank the combined candidate set. Expose whether a result came from primary or corrective retrieval for observability.

**Tech Stack:** TypeScript, local SQLite knowledge index, current deterministic RAG helpers and graph-assisted retrieval layer

---

### Task 1: Corrective query planning

**Files:**
- Modify: `src/lib/local-rag-helpers.ts`

- [x] Add deterministic corrective-query planning based on query tokens, graph entities, and support gaps
- [x] Keep the corrective pass bounded so it does not explode the number of retrieval variants
- [x] Return stable retrieval-plan labels that can be reused by the DB search layer

### Task 2: Corrective retrieval merge

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `tests/local-rag-indexing.test.ts`

- [x] Split primary candidate collection from final result shaping
- [x] Trigger a corrective pass only when the primary results are sparse or weakly supported
- [x] Merge, rerank, and annotate final results with retrieval stage metadata

### Task 3: Verification and records

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `todo-list.md`

- [x] Run `npm run lint`
- [x] Run `node --import tsx --test tests/local-rag-indexing.test.ts tests/vector-search-model.test.ts`
- [x] Run `npm run dev`
- [x] Record that the local RAG pipeline now supports a corrective second-pass retrieval path
