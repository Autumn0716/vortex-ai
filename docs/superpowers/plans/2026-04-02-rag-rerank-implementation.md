# RAG Rerank Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a true second-pass reranking step after hybrid recall so knowledge-base search is no longer only a single linear blend of lexical and vector scores.

**Architecture:** Keep the current hybrid recall stage untouched. After candidates are scored by lexical/vector fusion, run a deterministic reranker that considers query coverage, title hit rate, and exact-phrase bonuses, then truncate results. Do not introduce LLM reranking in this step.

**Tech Stack:** TypeScript, current vector-search helpers, local SQLite hybrid retrieval path

---

### Task 1: Deterministic reranker

**Files:**
- Modify: `src/lib/vector-search-model.ts`
- Modify: `tests/vector-search-model.test.ts`

- [ ] Add a query-aware reranker for hybrid candidates
- [ ] Use bounded signals such as title coverage, content coverage, and exact phrase presence
- [ ] Add focused tests that prove reranking changes ordering when coverage is better

### Task 2: Retrieval integration

**Files:**
- Modify: `src/lib/db.ts`

- [ ] Apply the reranker after hybrid recall and before truncating final results
- [ ] Keep external result shape unchanged in this step

### Task 3: Verification and records

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `todo-list.md`

- [ ] Run `npm run lint`
- [ ] Run `node --import tsx --test tests/vector-search-model.test.ts tests/local-rag-indexing.test.ts`
- [ ] Run `npm run dev`
- [ ] Record that knowledge-base retrieval now includes a deterministic reranking stage
