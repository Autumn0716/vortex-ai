# Session Summary Token Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make session summary boundaries follow the same token budget used for live generation history.

**Architecture:** Extract a small pure budget splitter that can be reused by the React send path and workspace summary builder. The live model request keeps the newest budget-fitting messages, while the session summary consumes the overflowed earlier messages so context is compressed rather than silently dropped.

**Tech Stack:** React/TypeScript, local workspace model helpers, Node test runner with `tsx`.

---

### Task 1: Shared Context Budget Splitter

**Files:**
- Create: `src/lib/session-context-budget.ts`
- Test: `tests/session-context-budget.test.ts`

- [x] **Step 1: Add a pure token estimator and recent-item splitter**

Implement `estimateTextTokens`, `selectBudgetedRecentItems`, and `splitBudgetedRecentItems` in `src/lib/session-context-budget.ts`.

- [x] **Step 2: Add regression tests for large and tight budgets**

Run: `node --import tsx --test tests/session-context-budget.test.ts`

Expected: both tests pass and prove a tight budget moves overflow into the summary source.

### Task 2: Wire Budget Into Generation And Summary

**Files:**
- Modify: `src/components/ChatInterface.tsx`
- Modify: `src/lib/agent-workspace.ts`

- [x] **Step 1: Use model metadata to derive a message-history token budget**

Use `maxInputTokens` when present; fall back to `contextWindow`; leave behavior unchanged when neither exists.

- [x] **Step 2: Apply the same budget to live generation history and `refreshTopicSessionSummary()`**

The live request receives only budget-fitting recent messages; `buildTopicSessionSummary()` summarizes everything before that boundary.

- [x] **Step 3: Keep current context estimate aligned**

Include the persisted session summary and the same budgeted message window in the UI context estimate.

### Task 3: Verification And Record

**Files:**
- Modify: `todo-list.md`

- [x] **Step 1: Run focused tests**

Run: `node --import tsx --test tests/session-context-budget.test.ts`

Run: `node --import tsx --test tests/session-runtime-model.test.ts`

- [x] **Step 2: Run project checks**

Run: `npm run lint`

Run: `npm run build`

- [x] **Step 3: Update `todo-list.md` progress**

Mark the token-budget linkage complete while keeping LLM summary and segmented updates as remaining work.

- [x] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-04-14-session-summary-token-budget.md src/lib/session-context-budget.ts tests/session-context-budget.test.ts src/components/ChatInterface.tsx src/lib/agent-workspace.ts todo-list.md
git commit -m "feat: budget session context summaries"
```
