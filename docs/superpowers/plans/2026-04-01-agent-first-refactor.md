# Agent-First Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current conversation-plus-lane model with an Agent-first workspace model while preserving the existing UI style and LangGraph runtime.

**Architecture:** Introduce a new persistent Agent/Topic/Message store layered on the existing local SQLite database. Keep the current visual shell and message rendering, but swap the data bindings to top-level agents, per-agent topics, agent memory, and search. FTS-aware search must degrade safely when the current sql.js build does not expose FTS5.

**Tech Stack:** React 19, Vite, TypeScript, LangGraph, sql.js, localforage, WebContainer

---

### Task 1: Add model helpers and regression tests

**Files:**
- Create: `tests/agent-workspace-model.test.ts`
- Create: `src/lib/agent-workspace-model.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAgentWorkspacePath,
  buildMigratedTopicTitle,
  formatTopicPreview,
} from '../src/lib/agent-workspace-model';

test('buildAgentWorkspacePath sanitizes agent names', () => {
  assert.equal(buildAgentWorkspacePath('Build Operator'), 'agents/build-operator');
});

test('buildMigratedTopicTitle appends the agent name when multiple lanes existed', () => {
  assert.equal(
    buildMigratedTopicTitle('Launch Plan', 'Research Scout', true),
    'Launch Plan · Research Scout',
  );
});

test('formatTopicPreview collapses whitespace and falls back when empty', () => {
  assert.equal(formatTopicPreview(' hello \n\n world '), 'hello world');
  assert.equal(formatTopicPreview('   '), 'No messages yet');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/agent-workspace-model.test.ts`
Expected: FAIL with module-not-found or missing export errors from `src/lib/agent-workspace-model.ts`

- [ ] **Step 3: Write minimal implementation**

```ts
export function buildAgentWorkspacePath(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent';

  return `agents/${slug}`;
}

export function buildMigratedTopicTitle(
  title: string,
  agentName: string,
  hadMultipleLanes: boolean,
): string {
  const normalizedTitle = title.trim() || 'New Topic';
  return hadMultipleLanes ? `${normalizedTitle} · ${agentName.trim() || 'Agent'}` : normalizedTitle;
}

export function formatTopicPreview(content: string): string {
  return content.replace(/\s+/g, ' ').trim() || 'No messages yet';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/agent-workspace-model.test.ts`
Expected: PASS with 3 passing tests

- [ ] **Step 5: Commit**

```bash
git add .gitignore docs/superpowers/plans/2026-04-01-agent-first-refactor.md tests/agent-workspace-model.test.ts src/lib/agent-workspace-model.ts
git commit -m "test: add agent workspace model coverage"
```

### Task 2: Add the new Agent-first local store and legacy migration

**Files:**
- Create: `src/lib/agent-workspace.ts`
- Modify: `src/lib/db.ts`

- [ ] Define persistent `agents`, `topics`, `topic_messages`, and `agent_memory_documents` tables.
- [ ] Add safe FTS setup that falls back to indexed `LIKE` search when FTS5 is unavailable.
- [ ] Migrate existing assistants, conversations, lanes, messages, and global memory into the new schema.
- [ ] Expose APIs for agent listing, topic listing, topic creation, topic rename, message writes, and search.

### Task 3: Rebind the chat shell to Agent + Topic selection

**Files:**
- Modify: `src/components/ChatInterface.tsx`
- Modify: `src/components/chat/AgentLaneColumn.tsx`

- [ ] Replace conversation sidebar state with current agent, topic list, and search results.
- [ ] Preserve the existing layout and message style while rendering one active agent/topic thread.
- [ ] Add agent selection near the composer.
- [ ] Add topic rename support from the chat header.

### Task 4: Convert the assistant library into an Agent manager

**Files:**
- Modify: `src/components/PromptsPanel.tsx`

- [ ] Rename assistant concepts to agents in the UI copy.
- [ ] Keep the visual structure, but wire actions to top-level agent create/edit/select flows.
- [ ] Add per-agent memory editing in the right-hand editor column.

### Task 5: Wire LangGraph runtime and verification

**Files:**
- Modify: `src/components/ChatInterface.tsx`
- Modify: `src/lib/agent/runtime.ts`
- Modify: `src/lib/agent/tools.ts`

- [ ] Feed Agent system prompt and per-agent memory into the LangGraph runtime.
- [ ] Preserve the shared knowledge base tool for this phase.
- [ ] Run `node --import tsx --test tests/agent-workspace-model.test.ts`
- [ ] Run `npm run lint`
- [ ] Run `npm run build`
- [ ] Commit milestone changes with a focused message
