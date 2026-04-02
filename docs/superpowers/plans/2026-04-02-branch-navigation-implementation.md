# Branch Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make parent-child topic relationships easier to navigate by surfacing branch groups directly in the chat shell.

**Architecture:** Reuse the existing in-memory `topics` list. Derive parent/child/sibling relationships client-side without changing storage. Surface branch navigation in the header and message shell so subtask flows feel like a lightweight topic tree.

**Tech Stack:** React 19, Vite, TypeScript, existing chat shell state

---

### Task 1: Derived branch navigation model

**Files:**
- Modify: `src/components/ChatInterface.tsx`

- [ ] Derive child-branch and sibling-branch sets from the current topic list
- [ ] Keep the logic topic-local and agent-local without introducing new persistence

### Task 2: Branch navigation UI

**Files:**
- Modify: `src/components/ChatInterface.tsx`

- [ ] Show child branches when viewing a parent topic
- [ ] Show sibling branches and a stronger parent jump when viewing a branch topic
- [ ] Keep the visual density compact and aligned with the current theme

### Task 3: Verification and records

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `todo-list.md`

- [ ] Run `npm run lint`
- [ ] Run `npm run dev`
- [ ] Record that parent/branch topic navigation is now visible in the chat shell
