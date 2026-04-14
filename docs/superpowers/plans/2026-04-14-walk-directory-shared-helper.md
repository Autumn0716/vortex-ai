# Walk Directory Shared Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace duplicated recursive directory walkers with one server-side helper.

**Architecture:** Add `server/lib/fs-utils.ts` with a focused `walkDirectory()` helper that preserves the current semantics: recursive traversal, absolute file paths, no built-in extension filtering, and caller-controlled sorting/filtering. Update the three existing callers without changing their public behavior.

**Tech Stack:** Node `fs.promises`, TypeScript, Node test runner with `tsx`.

---

### Task 1: Extract Helper

**Files:**
- Create: `server/lib/fs-utils.ts`
- Modify: `server/api-server.ts`
- Modify: `server/nightly-memory-archive.ts`
- Modify: `server/project-knowledge-store.ts`

- [x] **Step 1: Add shared helper**

Create `walkDirectory(directoryPath: string): Promise<string[]>` under `server/lib/fs-utils.ts`.

- [x] **Step 2: Replace local copies**

Import the helper in the three callers and remove the duplicated local functions.

### Task 2: Verify Behavior

**Files:**
- Create: `tests/fs-utils.test.ts`

- [x] **Step 1: Add recursion test**

Verify nested files are returned and directories are not returned.

- [x] **Step 2: Run targeted tests**

Run: `node --import tsx --test tests/fs-utils.test.ts`

Run: `node --import tsx --test tests/nightly-memory-archive.test.ts`

Run: `node --import tsx --test tests/project-knowledge-watcher.test.ts`

- [x] **Step 3: Run project checks**

Run: `npm run lint`

Run: `npm run build`

- [x] **Step 4: Record and commit**

Update `todo-list.md` item 6 to ✅ and commit as `refactor: share directory walking helper`.
