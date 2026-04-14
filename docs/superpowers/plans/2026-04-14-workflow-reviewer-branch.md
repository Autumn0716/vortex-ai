# Workflow Reviewer Branch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically create a reviewer branch topic when a workflow reaches `review_ready`, without directly invoking a model.

**Architecture:** Keep execution state in workspace storage. Worker branches already map to `topic_task_nodes.branch_topic_id`; this slice gives the reviewer node its own branch topic when all workers are complete, while using the existing branch bootstrap and topic isolation model.

**Tech Stack:** TypeScript, SQLite workspace tables, Node test runner

---

### Task 1: Create Reviewer Branch On Review Ready

**Files:**
- Modify: `src/lib/agent-workspace.ts`
- Test: `tests/session-runtime-model.test.ts`

- [ ] **Step 1: Detect review-ready graphs with an unbranched reviewer node**

Expected behavior:
```text
After the final worker handoff, find reviewer nodes for the graph where branch_topic_id is null.
```

- [ ] **Step 2: Create one reviewer branch topic**

Expected behavior:
```text
Reviewer branch title: <graph title> · Reviewer
Reviewer branch goal: review completed worker handoffs and produce the merged final answer.
```

- [ ] **Step 3: Mark reviewer node ready and attach branch topic id**

Expected behavior:
```text
UPDATE topic_task_nodes SET branch_topic_id = reviewerTopic.id, status = 'ready'
```

- [ ] **Step 4: Prevent duplicate reviewer branches**

Expected behavior:
```text
Repeated handoff after graph is review_ready returns no new reviewer branch.
```

- [ ] **Step 5: Verify**

Run:
```bash
node --import tsx --test tests/session-runtime-model.test.ts
npm run lint
npm run build
```
