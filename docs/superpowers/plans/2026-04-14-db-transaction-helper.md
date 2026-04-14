# Database Transaction Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable database transaction helper and migrate one covered write path to it.

**Architecture:** Add `src/lib/db-transaction.ts` with `runDatabaseTransaction()`, preserving the existing `BEGIN -> COMMIT` and `ROLLBACK -> rethrow` semantics. Use it first in `addConversationMessages()` as a small, low-risk migration target.

**Tech Stack:** TypeScript, SQLite wasm wrapper, Node test runner with `tsx`.

---

### Task 1: Helper

**Files:**
- Create: `src/lib/db-transaction.ts`
- Test: `tests/db-transaction.test.ts`

- [x] **Step 1: Add helper**

Implement `runDatabaseTransaction(database, callback)`.

- [x] **Step 2: Add commit and rollback tests**

Use a fake database to assert successful callbacks commit and thrown callbacks roll back.

### Task 2: First Migration

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `todo-list.md`

- [x] **Step 1: Replace one manual transaction**

Migrate `addConversationMessages()` to `runDatabaseTransaction()`.

- [x] **Step 2: Run targeted tests**

Run: `node --import tsx --test tests/db-transaction.test.ts`

Run: `node --import tsx --test tests/local-rag-indexing.test.ts`

- [x] **Step 3: Run project checks**

Run: `npm run lint`

Run: `npm run build`

- [x] **Step 4: Record and commit**

Record partial progress under item 8 and commit as `refactor: add database transaction helper`.
