# Topic Branch Subagent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-pass subagent workflow by letting the current topic branch into a child topic that can run in parallel with inherited session runtime and a compact context snapshot.

**Architecture:** Model a child subtask as another `Topic` instance, not as a second runtime hidden inside the same topic. Add parent-topic metadata, a branch-creation helper, and a compact UI entry from the active topic. Keep storage and generation semantics topic-scoped so existing parallel streaming logic can be reused.

**Tech Stack:** React 19, Vite, TypeScript, local SQLite workspace schema, current topic runtime model

---

### Task 1: Topic branch data model

**Files:**
- Modify: `src/lib/agent-workspace-schema.ts`
- Modify: `src/lib/agent-workspace.ts`
- Modify: `tests/session-runtime-model.test.ts`

- [ ] Add `parent_topic_id` metadata to topics
- [ ] Expose parent-topic linkage in topic summaries/workspaces
- [ ] Add a helper that creates a child topic from an existing topic while inheriting runtime overrides

### Task 2: Branch context bootstrap

**Files:**
- Modify: `src/lib/agent-workspace.ts`
- Modify: `tests/session-runtime-model.test.ts`

- [ ] Seed a new branch topic with a compact context snapshot from the source topic
- [ ] Keep the copied context limited and explicit so branch topics do not silently clone the full history
- [ ] Preserve branch isolation after creation

### Task 3: Branch topic UI

**Files:**
- Modify: `src/components/ChatInterface.tsx`

- [ ] Add a `Branch Task` entry from the active topic header
- [ ] Provide an in-app branch creation dialog with title and branch goal
- [ ] Mark branch topics in the sidebar/header so parent-child relationships are visible

### Task 4: Verification and records

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `todo-list.md`

- [ ] Run `npm run lint`
- [ ] Run `npm run dev`
- [ ] Record that topic branching now provides the first in-product subagent path for parallel work
