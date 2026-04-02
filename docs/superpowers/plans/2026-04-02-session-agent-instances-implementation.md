# Session Agent Instances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the current agent/topic runtime so each topic becomes an independent session-scoped runtime instance, while keeping `Agent` as a reusable template layer. Add a lightweight `quick` session mode for short model chats that do not require the full agent stack.

**Architecture:** Treat `Agent` as a template definition and `Topic` as the actual runtime instance. Each topic stores its own resolved runtime settings, prompt overrides, and feature flags. Shared read-only resources such as the knowledge base, vector index, shared skills, and config remain global. Session messages remain isolated by default. Memory is split into three layers: session-scoped short-term memory, optional agent-shared short-term memory, and agent-shared long-term memory.

**Tech Stack:** React 19, Vite, TypeScript, LangGraph, SQLite wasm, localforage, existing local `api-server`

---

### Task 1: Extend topic schema into session instances

**Files:**
- Modify: `src/lib/agent-workspace-schema.ts`
- Modify: `src/lib/agent-workspace.ts`
- Test: `tests/agent-workspace-schema.test.ts`

- [ ] Add session-level fields to `topics`:
  - `session_mode` (`agent` | `quick`)
  - `display_name`
  - `system_prompt_override`
  - `provider_id_override`
  - `model_override`
  - `enable_memory`
  - `enable_skills`
  - `enable_tools`
  - `enable_agent_shared_short_term`
- [ ] Backfill existing topics with `session_mode = 'agent'`
- [ ] Keep `agent_id` nullable only if needed for `quick` mode, otherwise create a dedicated lightweight backing agent strategy
- [ ] Update `TopicSummary` / `TopicWorkspace` model types so the UI receives resolved session instance settings instead of only template-level agent fields

### Task 2: Add explicit session runtime resolution helpers

**Files:**
- Modify: `src/lib/agent-workspace.ts`
- Create: `tests/session-runtime-model.test.ts`

- [ ] Introduce a helper that resolves a topic into:
  - template agent metadata
  - session-level overrides
  - effective provider/model/system prompt
  - effective feature flags
- [ ] Make `getTopicWorkspace()` return both:
  - template-facing agent info for display
  - effective session runtime config for execution
- [ ] Ensure `quick` sessions can resolve without requiring the full agent template path

### Task 3: Split memory into session short-term vs agent-shared short-term

**Files:**
- Modify: `src/lib/agent/config.ts`
- Modify: `src/lib/agent-workspace.ts`
- Modify: `src/lib/agent-memory-model.ts`
- Modify: `src/lib/agent-memory-sync.ts`
- Test: `tests/agent-memory-sync.test.ts`
- Test: `tests/knowledge-memory-model.test.ts`

- [ ] Add new `config.json` memory settings:
  - `enableSessionMemory`
  - `enableAgentSharedShortTerm` (default `false`)
  - `agentSharedShortTermWindowDays`
  - `enableAgentLongTerm`
- [ ] Keep raw session messages isolated by default
- [ ] Continue sharing agent long-term memory across sessions
- [ ] Split short-term memory into:
  - session-scoped short-term, only visible to the current topic
  - optional agent-shared short-term, visible across the same agent’s topics when enabled
- [ ] Ensure “我明天要出差” style facts only cross topics when `enableAgentSharedShortTerm` is enabled

### Task 4: Make generation state topic-scoped for true parallelism

**Files:**
- Modify: `src/components/ChatInterface.tsx`
- Modify: `src/components/chat/AgentLaneColumn.tsx`
- Test: `tests/chat-runtime-state.test.ts`

- [ ] Replace the global `isGenerating` / `composerNotice` state with per-topic run state
- [ ] Allow topic A and topic B to stream concurrently without disabling each other
- [ ] Keep scrolling and optimistic message updates scoped to the active topic
- [ ] Preserve current UX for the active topic while removing global generation lock contention

### Task 5: Add quick session mode

**Files:**
- Modify: `src/lib/agent-workspace.ts`
- Modify: `src/components/ChatInterface.tsx`
- Modify: `src/components/settings/SettingsView.tsx`
- Test: `tests/session-runtime-model.test.ts`

- [ ] Add a `quick` topic creation path
- [ ] Quick mode should support:
  - custom display name
  - custom system prompt
  - per-topic provider/model selection
- [ ] Quick mode defaults:
  - `enable_memory = false`
  - `enable_skills = false`
  - `enable_tools = false`
- [ ] Keep multiple quick sessions usable in parallel

### Task 6: Rewire the runtime execution path

**Files:**
- Modify: `src/components/ChatInterface.tsx`
- Modify: `src/lib/agent/runtime.ts`
- Modify: `src/lib/agent/tools.ts`

- [ ] Execute normal `agent` topics using the resolved topic session config rather than template-only config
- [ ] Execute `quick` topics using the same low-level model client path but without memory/skills/tools unless explicitly enabled later
- [ ] Keep the shared knowledge base and shared skills as read-only resources
- [ ] Ensure current LangGraph-based agent runtime remains the main path for normal agent sessions

### Task 7: Add UI affordances for session types and session settings

**Files:**
- Modify: `src/components/ChatInterface.tsx`

- [ ] Add `新建 Agent 会话`
- [ ] Add `新建 快速会话`
- [ ] Show lightweight mode badges such as `Quick`
- [ ] Add a per-topic session settings entry for:
  - display name
  - prompt override
  - model override
  - memory / skills / tools toggles
  - agent-shared short-term toggle
- [ ] Preserve the current theme and density direction

### Task 8: Verification and migration safety

**Files:**
- Modify: `README.md`
- Modify: `todo-list.md`
- Modify: `docs/CHANGELOG.md`

- [ ] Run schema and runtime regression tests
- [ ] Run `npm run lint`
- [ ] Run `npm run dev`
- [ ] Document the new layering rules:
  - topic messages are isolated
  - session short-term memory is isolated
  - agent-shared short-term memory is optional and disabled by default
  - agent long-term memory remains shared
