# Topic Mode UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve `Quick` vs `Agent` topic creation and sidebar management without changing the existing theme or data model.

**Architecture:** Keep `Topic` as the session instance. Add a lightweight creation dialog for quick sessions and a mode filter in the topic sidebar. Do not introduce new tables or rewrite session runtime semantics.

**Tech Stack:** React 19, Vite, TypeScript, existing chat shell state

---

### Task 1: Quick topic creation dialog

**Files:**
- Modify: `src/components/ChatInterface.tsx`

- [ ] Replace the current prompt-based quick topic creation flow with an in-app modal
- [ ] Let the user set title, display name, system prompt, provider, and model before creation
- [ ] Keep the visual treatment aligned with the current compact dark theme

### Task 2: Topic mode filtering and sidebar management

**Files:**
- Modify: `src/components/ChatInterface.tsx`

- [ ] Add `All / Agent / Quick` filtering to the topic list
- [ ] Show counts for each mode so session distribution is visible at a glance
- [ ] Keep the current search behavior compatible with the new filter

### Task 3: Verification and records

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `todo-list.md`

- [ ] Run `npm run lint`
- [ ] Run `npm run dev`
- [ ] Record that quick-session creation moved into an in-app modal and that the sidebar can now filter agent vs quick topics
