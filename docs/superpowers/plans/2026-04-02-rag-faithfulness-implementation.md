# RAG Faithfulness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic faithfulness check to retrieved knowledge results and ensure search outputs preserve compressed excerpts rather than reverting to full document bodies.

**Architecture:** Reuse query-token coverage and exact-phrase signals to score how well each retrieved snippet actually supports the query. Attach the support metadata to search results without changing storage. When mapping knowledge-search results back onto document metadata, preserve the compressed excerpt from retrieval rather than replacing it with the original full content.

**Tech Stack:** TypeScript, local knowledge retrieval path, existing deterministic rewrite/rerank/compression helpers

---

### Task 1: Faithfulness scorer

**Files:**
- Modify: `src/lib/local-rag-helpers.ts`
- Modify: `tests/local-rag-indexing.test.ts`

- [ ] Add a deterministic support scorer for retrieved snippets
- [ ] Produce a compact label/score so downstream callers can decide how much to trust the result
- [ ] Add tests for low-vs-high support behavior

### Task 2: Retrieval result integration

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `src/lib/agent/tools.ts`

- [ ] Attach support metadata to search results after compression
- [ ] Preserve compressed content when `searchKnowledgeDocuments()` maps rows back to document metadata
- [ ] Surface support metadata in the search tool output without changing its basic contract

### Task 3: Verification and records

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `todo-list.md`

- [ ] Run `npm run lint`
- [ ] Run `node --import tsx --test tests/local-rag-indexing.test.ts tests/vector-search-model.test.ts`
- [ ] Run `npm run dev`
- [ ] Record that local knowledge retrieval now exposes a deterministic faithfulness/support signal
