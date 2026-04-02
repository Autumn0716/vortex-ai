# Graph Neighborhood RAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the current graph-assisted RAG layer from pure node overlap into a lightweight graph-neighborhood expansion pass that can surface documents connected through adjacent entities, not only exact query-node matches.

**Architecture:** Keep the current knowledge-base graph tables and corrective retrieval path. Reuse query entity extraction to find directly matched graph nodes, then traverse a bounded set of `document_graph_edges` to collect adjacent entities. Use those adjacent entities as a weaker second-order graph signal and blend them into ranking without replacing lexical, vector, or direct graph overlap. Expose the expanded entity hints in search results for observability.

**Tech Stack:** TypeScript, local SQLite knowledge index, deterministic RAG helpers, current graph-assisted retrieval layer

---

### Task 1: Graph-neighborhood scoring

**Files:**
- Modify: `src/lib/db.ts`

- [x] Read bounded neighboring entities from `document_graph_edges`
- [x] Score documents by direct node overlap first, then weaker edge-neighbor overlap
- [x] Keep expansion bounded so graph expansion does not swamp primary retrieval

### Task 2: Result observability and tests

**Files:**
- Modify: `tests/local-rag-indexing.test.ts`

- [x] Return expanded graph hints separately from direct graph hints
- [x] Add coverage showing a second-order graph neighbor can promote an otherwise hidden document

### Task 3: Verification and records

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `todo-list.md`

- [x] Run `npm run lint`
- [x] Run `node --import tsx --test tests/local-rag-indexing.test.ts tests/vector-search-model.test.ts`
- [x] Run `npm run dev`
- [x] Record that local RAG now supports bounded graph-neighborhood expansion
