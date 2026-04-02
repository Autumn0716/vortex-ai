# RAG Context Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce prompt bloat by compressing retrieved knowledge snippets before they are handed to the model or tools.

**Architecture:** Keep the source documents untouched. After retrieval and reranking, compress each selected document into a focused excerpt centered on query terms and exact phrase hits. Return the compressed excerpt in place of the full content for search results.

**Tech Stack:** TypeScript, current local knowledge-base retrieval pipeline

---

### Task 1: Deterministic context compression helper

**Files:**
- Modify: `src/lib/local-rag-helpers.ts`
- Modify: `tests/local-rag-indexing.test.ts`

- [ ] Add a helper that extracts a focused excerpt around query matches
- [ ] Fall back gracefully when exact terms are sparse
- [ ] Add tests proving that compressed results preserve relevant phrases

### Task 2: Retrieval integration

**Files:**
- Modify: `src/lib/db.ts`

- [ ] Compress final retrieved content after reranking and before result truncation is returned
- [ ] Keep IDs and titles unchanged while shortening content payloads

### Task 3: Verification and records

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `todo-list.md`

- [ ] Run `npm run lint`
- [ ] Run `node --import tsx --test tests/local-rag-indexing.test.ts tests/vector-search-model.test.ts`
- [ ] Run `npm run dev`
- [ ] Record that local knowledge retrieval now returns compressed context excerpts
