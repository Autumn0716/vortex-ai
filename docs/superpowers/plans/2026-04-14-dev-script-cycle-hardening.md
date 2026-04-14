# Dev Script Cycle Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confirm and harden dev script responsibilities so startup scripts do not depend on a recursive npm alias.

**Architecture:** Keep `scripts/dev-all.mjs` as the single web+api process orchestrator. Update `scripts/desktop-dev.mjs` to call that file directly through Node instead of routing through `npm run dev:all`, reducing alias coupling while preserving runtime behavior.

**Tech Stack:** Node child process scripts, TypeScript build verification.

---

### Task 1: Harden Desktop Dev Bootstrap

**Files:**
- Modify: `scripts/desktop-dev.mjs`

- [x] **Step 1: Replace alias-based launch**

Change `start('dev-all', npmCommand, ['run', 'dev:all'])` to start `process.execPath scripts/dev-all.mjs` directly.

### Task 2: Verify And Record

**Files:**
- Modify: `todo-list.md`

- [x] **Step 1: Run script syntax checks**

Run: `node --check scripts/dev-all.mjs`

Run: `node --check scripts/desktop-dev.mjs`

- [x] **Step 2: Run project checks**

Run: `npm run lint`

Run: `npm run build`

- [x] **Step 3: Record completion**

Mark todo item 7 as ✅ and explain that no self-call existed in `dev-all.mjs`, but desktop bootstrap now avoids the npm alias.

- [x] **Step 4: Commit**

Commit as `chore: harden dev script bootstrap`.
