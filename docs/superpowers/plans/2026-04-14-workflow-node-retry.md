# Workflow Node Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workspace-layer API for retrying a workflow branch task by creating a replacement branch and resetting the task graph state.

**Architecture:** Retry is keyed by the existing branch topic id because the UI already knows the active branch. The retry creates a new branch from the original parent topic, moves the task node to the new branch, resets graph status to `ready`, and clears stale reviewer branch references.

**Tech Stack:** TypeScript, SQLite workspace tables, Node test runner

---

### Task 1: Retry A Workflow Branch Task

**Files:**
- Modify: `src/lib/agent-workspace.ts`
- Test: `tests/session-runtime-model.test.ts`

- [ ] **Step 1: Export a retry function**

Expected signature:
```ts
retryWorkflowBranchTask(options: { branchTopicId: string; reason?: string }): Promise<{
  previousBranchTopic: TopicSummary;
  retryBranchTopic: TopicSummary;
  retriedTaskNode: TopicTaskGraphNode;
}>
```

- [ ] **Step 2: Reset graph state**

Expected behavior:
```text
Set retried node branch_topic_id to the new branch id and status to ready.
Set graph status back to ready.
Clear topic_task_graphs.reviewer_branch_topic_id.
Clear reviewer node branch_topic_id because old review output is stale.
```

- [ ] **Step 3: Record trace messages**

Expected behavior:
```text
Old branch receives a system note pointing to the retry branch.
Parent topic receives a system note explaining that the workflow node was retried.
```

- [ ] **Step 4: Verify**

Run:
```bash
node --import tsx --test tests/session-runtime-model.test.ts
npm run lint
npm run build
```
