# RAG Query Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve first-pass RAG recall by adding deterministic query rewrite and expansion before lexical/vector retrieval.

**Architecture:** Keep retrieval centered on `searchDocumentsInDatabase`. Expand the incoming query into a small deduplicated set of rewritten subqueries, then reuse the existing lexical + vector hybrid scoring path. Do not add LLM rewrite, reranking, or context compression in this step.

**Tech Stack:** TypeScript, local SQLite FTS/BM25, current hybrid vector search helpers

---

### Task 1: Deterministic query rewrite helper

**Files:**
- Modify: `src/lib/local-rag-helpers.ts`
- Modify: `tests/local-rag-indexing.test.ts`

- [ ] Add a compact rewrite/expansion helper for conversational phrasing, filler stripping, and key synonym expansion
- [ ] Keep expansion bounded and deduplicated so recall improves without exploding query count
- [ ] Add focused tests for rewritten search behavior

### Task 2: Retrieval integration

**Files:**
- Modify: `src/lib/db.ts`

- [ ] Feed rewritten subqueries into the current lexical/vector merge path
- [ ] Preserve semantic cache behavior while making rewritten queries part of the scoped cache key
- [ ] Keep ranking and max-results semantics unchanged in this step

### Task 3: Verification and records

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `todo-list.md`

- [ ] Run `npm run lint`
- [ ] Run `node --import tsx --test tests/local-rag-indexing.test.ts`
- [ ] Run `npm run dev`
- [ ] Record that knowledge-base retrieval now performs deterministic query rewrite / expansion before recall
