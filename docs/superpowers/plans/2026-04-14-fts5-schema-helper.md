# FTS5 Schema Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize runtime FTS5 table creation and availability checks.

**Architecture:** Add `src/lib/db-fts5-helpers.ts` with small helpers for creating FTS5 virtual tables and checking table existence. Keep caller-specific indexing/search SQL in `db.ts` and `agent-workspace.ts` to avoid broad refactors.

**Tech Stack:** TypeScript, SQLite wasm database wrapper, Node test runner with `tsx`.

---

### Task 1: Runtime Helper

**Files:**
- Create: `src/lib/db-fts5-helpers.ts`
- Modify: `src/lib/db.ts`
- Modify: `src/lib/agent-workspace.ts`

- [x] **Step 1: Add helper**

Create `createFts5Table()`, `createFts5Tables()`, and `hasFts5Table()`.

- [x] **Step 2: Use helper in runtime schema**

Replace inline `CREATE VIRTUAL TABLE ... USING fts5` blocks in `db.ts` and `agent-workspace.ts`.

### Task 2: Tests And Record

**Files:**
- Create: `tests/db-fts5-helpers.test.ts`
- Modify: `todo-list.md`

- [x] **Step 1: Add helper tests**

Use a small fake database object to verify generated schema SQL and failure handling.

- [x] **Step 2: Run targeted tests**

Run: `node --import tsx --test tests/db-fts5-helpers.test.ts`

Run: `node --import tsx --test tests/local-rag-indexing.test.ts`

Run: `node --import tsx --test tests/session-runtime-model.test.ts`

- [x] **Step 3: Run project checks**

Run: `npm run lint`

Run: `npm run build`

- [x] **Step 4: Record and commit**

Mark todo item 9 as ✅ and commit as `refactor: centralize fts5 schema helpers`.
