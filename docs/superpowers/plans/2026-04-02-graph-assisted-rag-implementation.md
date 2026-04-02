# Graph-Assisted RAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a first-pass Graph-assisted retrieval layer by extracting document entities/relations and using graph overlap as an additional retrieval signal.

**Architecture:** Keep the existing knowledge-base store and hybrid/vector retrieval path. Add derived document graph tables for nodes and lightweight co-occurrence edges. During retrieval, extract entities from the user query, score documents by graph overlap, and blend that signal into final ranking. Do not attempt full GraphRAG synthesis or multi-hop reasoning in this step.

**Tech Stack:** TypeScript, local SQLite knowledge index, current deterministic RAG pipeline

---

### Task 1: Graph extraction and indexing

**Files:**
- Modify: `src/lib/local-rag-helpers.ts`
- Modify: `src/lib/db.ts`

- [x] Add deterministic entity extraction for titles, headings, code-style tokens, and technical terms
- [x] Add lightweight node/edge tables for document graph structure
- [x] Keep graph indexes derived and rebuildable from source documents

### Task 2: Graph-assisted retrieval

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `src/lib/vector-search-model.ts`
- Modify: `tests/local-rag-indexing.test.ts`

- [x] Extract entities from the query and score document overlap against graph nodes
- [x] Blend graph overlap into final ranking without replacing lexical/vector retrieval
- [x] Return basic graph hints in search results for observability

### Task 3: Verification and records

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `todo-list.md`

- [x] Run `npm run lint`
- [x] Run `node --import tsx --test tests/local-rag-indexing.test.ts tests/vector-search-model.test.ts`
- [x] Run `npm run dev`
- [x] Record that the knowledge base now has a first-pass graph-assisted retrieval layer
