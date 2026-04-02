# Session Settings UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a topic-level session settings panel for the new session-scoped topic runtime model, so each topic can override identity, prompt, model, and feature flags without mutating the global app config.

**Architecture:** Keep `Agent` as template and `Topic` as runtime instance. Introduce a dedicated topic settings modal in the chat shell. The modal edits persisted topic runtime fields through a focused `updateTopicSessionSettings()` workspace API. Reuse the existing grouped model picker for both global model changes and per-topic model override selection.

**Tech Stack:** React 19, Vite, TypeScript, SQLite wasm, existing chat shell modal patterns

---

### Task 1: Capture pending stability fixes before UI work

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/AppErrorBoundary.tsx`
- Modify: `src/components/ChatInterface.tsx`
- Modify: `src/lib/agent-memory-api.ts`
- Modify: `docs/CHANGELOG.md`
- Modify: `todo-list.md`

- [ ] Keep the frontend runtime error boundary added during the workspace-null debugging pass
- [ ] Keep null-safe runtime-derived display/model rendering in `ChatInterface`
- [ ] Keep more specific local API request error messages
- [ ] Record the stability fix before starting the next feature task

### Task 2: Add topic session settings persistence API

**Files:**
- Modify: `src/lib/agent-workspace.ts`
- Test: `tests/session-runtime-model.test.ts`

- [ ] Add `updateTopicSessionSettings()` for partial topic runtime updates
- [ ] Support updating:
  - `display_name`
  - `system_prompt_override`
  - `provider_id_override`
  - `model_override`
  - `enable_memory`
  - `enable_skills`
  - `enable_tools`
  - `enable_agent_shared_short_term`
- [ ] Return normalized `TopicSummary` after write
- [ ] Verify quick sessions and normal agent sessions both update correctly

### Task 3: Add session settings modal in chat shell

**Files:**
- Modify: `src/components/ChatInterface.tsx`

- [ ] Add a topic-level session settings entry in the chat header
- [ ] Add a modal that edits the active topic runtime fields
- [ ] Keep the current theme, density, and card language
- [ ] Show whether the active topic is `agent` or `quick`
- [ ] Make quick sessions clearly read as lightweight, topic-local runtimes

### Task 4: Reuse grouped model picker for topic overrides

**Files:**
- Modify: `src/components/ChatInterface.tsx`

- [ ] Let the grouped model picker target either:
  - global config model selection
  - current topic session override
- [ ] Keep provider grouping / search / collapsible families intact
- [ ] Show the correct "current model" badge for the active picker target
- [ ] Avoid mutating global config when editing a topic-local override

### Task 5: Verification and records

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `todo-list.md`

- [ ] Run `node --import tsx --test tests/session-runtime-model.test.ts tests/agent-workspace-schema.test.ts tests/agent-memory-sync.test.ts`
- [ ] Run `npm run lint`
- [ ] Run `npm run dev`
- [ ] Record that topic session settings UI is now available and that grouped model picking works for both global and topic-local selection
