# Session Summary And Next Vertical Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the first-pass session summary compression safely, record it, then continue with one additional independently verifiable follow-up task.

**Architecture:** Keep session summary logic in the workspace layer so topic storage, runtime prompt assembly, and message persistence stay loosely coupled. After the summary work is verified and committed, select one small next vertical from the current todo list and implement it without broad refactors.

**Tech Stack:** React, TypeScript, SQLite workspace storage, Vite build, Electron-compatible local host runtime

---

### Task 1: Land Session Summary Compression

**Files:**
- Modify: `src/lib/agent-workspace-schema.ts`
- Modify: `src/lib/agent-workspace.ts`
- Modify: `src/components/ChatInterface.tsx`
- Modify: `todo-list.md`

- [ ] **Step 1: Review the current diff for scope and correctness**

Run: `git diff -- src/lib/agent-workspace-schema.ts src/lib/agent-workspace.ts src/components/ChatInterface.tsx todo-list.md`
Expected: only session summary persistence, hydration, injection, and progress-record changes appear.

- [ ] **Step 2: Verify the codebase still passes static checks**

Run: `npm run lint`
Expected: exit code `0`

- [ ] **Step 3: Verify the production build still succeeds**

Run: `npm run build`
Expected: exit code `0`

- [ ] **Step 4: Commit the session summary changes**

Run:
```bash
git add src/lib/agent-workspace-schema.ts src/lib/agent-workspace.ts src/components/ChatInterface.tsx todo-list.md
git commit -m "feat: add session summary compression"
```
Expected: one commit containing only the verified session summary work.

### Task 2: Pick The Smallest Next Vertical

**Files:**
- Read: `todo-list.md`
- Read: `src/lib/agent-workspace.ts`
- Read: `src/components/ChatInterface.tsx`

- [ ] **Step 1: Compare the next two candidate items**

Candidates:
```text
A. workflow automatic dispatcher / reviewer execution
B. finer-grained daily logging
```
Expected: select the smaller vertical that can be verified independently in one round.

- [ ] **Step 2: Record the choice and rationale**

Expected output:
```text
- chosen item
- why it is smaller / safer
- exact files to touch
- exact verification command
```

### Task 3: Implement And Record The Chosen Vertical

**Files:**
- Modify: `todo-list.md`
- Modify: only the minimum files required by the chosen item

- [ ] **Step 1: Implement the smallest working slice**

Rule:
```text
Touch only the files required by the chosen vertical.
No unrelated cleanup.
```

- [ ] **Step 2: Run the narrowest verification that proves the slice works**

Expected: one command or one pair of commands that directly validate the new behavior.

- [ ] **Step 3: Re-run repository-level verification if the slice changes runtime behavior**

Run:
```bash
npm run lint
npm run build
```
Expected: both exit `0`

- [ ] **Step 4: Record progress in todo-list and commit**

Run:
```bash
git add <changed-files>
git commit -m "<scoped message>"
```
Expected: todo progress and code land together.
