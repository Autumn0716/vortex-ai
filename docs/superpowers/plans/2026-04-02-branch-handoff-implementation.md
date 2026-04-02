# Branch Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a branch topic send its findings back to the parent topic so subtask work can re-enter the main thread without copy-paste.

**Architecture:** Keep branches as ordinary child topics. Add a handoff helper that builds a compact branch summary and writes it into the parent topic as a normal assistant message. Record the handoff inside the branch as a system note so the transfer is visible from both sides.

**Tech Stack:** React 19, Vite, TypeScript, local SQLite workspace schema, topic-scoped runtime model

---

### Task 1: Branch handoff helper

**Files:**
- Modify: `src/lib/agent-workspace.ts`
- Modify: `tests/session-runtime-model.test.ts`

- [ ] Add a helper that sends a branch summary into its parent topic
- [ ] Keep the transferred payload compact and explicit rather than cloning the full branch history
- [ ] Record a branch-side handoff note so the transfer is auditable

### Task 2: Branch handoff UI

**Files:**
- Modify: `src/components/ChatInterface.tsx`

- [ ] Add a `Send to Parent` action for branch topics
- [ ] Provide an in-app dialog for an optional handoff note
- [ ] After handoff, surface the parent topic and confirm the transfer in the shell

### Task 3: Verification and records

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `todo-list.md`

- [ ] Run `npm run lint`
- [ ] Run `node --import tsx --test tests/session-runtime-model.test.ts`
- [ ] Run `npm run dev`
- [ ] Record that branch topics can now hand findings back to the parent topic
