# Workflow Review Ready Rollup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When every worker branch in a compiled workflow has handed off results, write a compact parent-topic rollup and advance the graph to a review-ready state.

**Architecture:** Keep this as deterministic workspace-layer state progression. `handoffBranchTopicToParent()` already marks the matching worker node `completed`; this slice adds a graph-level check after that update, and only emits a parent system message when all worker nodes for a graph are completed.

**Tech Stack:** TypeScript, SQLite workspace tables, Node test runner

---

### Task 1: Add Workflow Rollup Logic

**Files:**
- Modify: `src/lib/agent-workspace.ts`
- Test: `tests/session-runtime-model.test.ts`

- [ ] **Step 1: Add helper that detects completed worker graphs**

Implementation target:
```ts
async function markWorkflowGraphsReviewReady(...)
```

Expected behavior:
```text
Given a completed branch topic id, find related graph ids.
For each graph, if every worker node has status completed, update topic_task_graphs.status to review_ready.
Return graph rollup data for each newly review-ready graph.
```

- [ ] **Step 2: Write one parent system rollup after final worker handoff**

Expected message shape:
```text
Workflow ready for review: <graph title>

Completed worker branches:
- <worker title>: <objective>

Next: review the branch handoffs in this parent topic and produce the merged answer.
```

- [ ] **Step 3: Add regression test**

Run:
```bash
node --import tsx --test tests/session-runtime-model.test.ts
```

Expected: test creates a workflow with multiple worker branches, handoffs all branches, and sees exactly one review-ready rollup after the final handoff.

- [ ] **Step 4: Repository verification**

Run:
```bash
npm run lint
npm run build
```

Expected: both exit `0`.

- [ ] **Step 5: Record and commit**

Run:
```bash
git add src/lib/agent-workspace.ts tests/session-runtime-model.test.ts todo-list.md docs/superpowers/plans/2026-04-14-workflow-review-ready-rollup.md
git commit -m "feat: roll up completed workflow branches"
```
