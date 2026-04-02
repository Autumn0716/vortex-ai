# Topic Parallel Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make session-scoped topic runtimes feel truly parallel in the chat UI by adding topic-local streaming controls, visible background generation state, and cleaner recovery when switching between topics mid-stream.

**Architecture:** Keep generation state fully topic-scoped. Extend the current `topicRunStates` approach with topic-local abort controllers, non-global "stop" semantics, and topic list/header indicators derived from the same run-state map. Avoid pushing generation state back into global config or template agent state.

**Tech Stack:** React 19, Vite, TypeScript, LangGraph streaming runtime, current chat shell state model

---

### Task 1: Introduce topic-local stop controls

**Files:**
- Modify: `src/components/ChatInterface.tsx`

- [ ] Add a per-topic abort controller registry
- [ ] Allow the active topic to stop its own streaming run without affecting other topics
- [ ] Treat abort as a first-class stop path rather than as a generic agent error
- [ ] Preserve partial streamed content when a run is intentionally stopped

### Task 2: Improve topic-scoped run-state lifecycle

**Files:**
- Modify: `src/components/ChatInterface.tsx`
- Modify: `src/components/chat/AgentLaneColumn.tsx`

- [ ] Keep draft assistant output recoverable when switching topics mid-stream
- [ ] Preserve topic-local notices such as "generation stopped" or "still running in background"
- [ ] Avoid clearing useful topic run state too early at stream completion / abort boundaries

### Task 3: Surface background generation status in the shell

**Files:**
- Modify: `src/components/ChatInterface.tsx`

- [ ] Show which topics are currently generating in the topic list
- [ ] Show the active topic's run status in the header / composer area
- [ ] Keep the visual treatment aligned with the current theme and compact density

### Task 4: Verification and records

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `todo-list.md`

- [ ] Run `npm run lint`
- [ ] Run `npm run dev`
- [ ] Record that topic-level streaming can now be stopped locally and that background topic generation is visible in the chat shell
