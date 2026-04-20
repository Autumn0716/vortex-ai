# Electron Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the current local-first Vortex stack into a usable macOS Electron app without rewriting the core React + LangGraph + local host architecture. Phase 1 focuses on shipping a real desktop `.app` that starts the UI and host bridge automatically, persists local data safely, and improves overall UI density and polish for desktop usage.

**Architecture:** Keep the current browser app as the renderer layer. Add an Electron main process that owns the desktop window, environment bootstrapping, capability gating, and local host process lifecycle. Preserve the existing local `api-server` for Phase 1 instead of forcing an immediate IPC rewrite. Keep file-backed sources of truth (`config.json`, `model-metadata.json`, `memory/agents/...`) local-first. Add an explicit desktop runtime mode so the app can distinguish web-hosted limitations from desktop-hosted capabilities.

**Design Direction:** Use Cherry Studio as a reference for density, flow, and message readability, but do not clone its visuals. Apply the current project theme, simplify icon usage, reduce redundant labels, tighten panel spacing, and make message/tool/status surfaces calmer and more compact. Follow the spirit of `frontend-design` and `ui-ux-pro-max`: strong information hierarchy, fewer icon badges, stable hover states, no decorative bloat.

**Tech Stack:** Electron, React 19, Vite, TypeScript, Express host bridge, LangGraph, SQLite wasm, existing local-first config/memory files

---

### Task 1: Add desktop runtime mode and packaging skeleton

**Files:**
- Create: `electron/main.ts`
- Create: `electron/preload.ts`
- Create: `electron/utils/*.ts`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] Add Electron as the desktop shell for macOS development builds
- [ ] Add scripts for:
  - `desktop:dev`
  - `desktop:build`
  - optional `desktop:preview`
- [ ] Start the renderer through the existing Vite pipeline in dev mode
- [ ] Start the packaged renderer from built assets in production mode
- [ ] Add a preload boundary instead of enabling unsafe renderer privileges directly
- [ ] Keep the Phase 1 shell minimal: one main window, one preload layer, one host lifecycle manager

### Task 2: Automatically manage the local host bridge

**Files:**
- Create: `electron/host-process.ts`
- Modify: `server/api-server.ts`
- Modify: `scripts/dev-all.mjs`
- Modify: `src/lib/agent/config.ts`

- [ ] Move from “user manually runs `npm run api-server`” to “Electron main automatically starts the host bridge”
- [ ] Detect an already-running compatible host process and reuse it in development when appropriate
- [ ] In packaged desktop mode, always boot the bundled host automatically
- [ ] Surface clear host status to the renderer:
  - starting
  - ready
  - failed
  - stale version
- [ ] Keep the existing HTTP bridge for Phase 1; do not rewrite to IPC yet

### Task 3: Define desktop data path strategy

**Files:**
- Modify: `server/*` host path helpers
- Create: `electron/app-paths.ts`
- Modify: `README.md`

- [ ] Decide and implement the Phase 1 storage policy:
  - default desktop app data directory under macOS Application Support
  - optional project-local workspace mode for developer workflows
- [ ] Separate:
  - app runtime files
  - user/project data
  - logs
  - temporary files
- [ ] Keep `config.json`, `model-metadata.json`, and `memory/agents/...` as file-backed sources of truth
- [ ] Ensure desktop mode no longer assumes the current project root is the only valid data root
- [ ] Document migration expectations from the current repo-local layout

### Task 4: Introduce desktop capability gating

**Files:**
- Modify: `src/lib/agent/config.ts`
- Modify: `src/lib/agent/tools.ts`
- Modify: `src/components/ChatInterface.tsx`
- Modify: `src/components/settings/SettingsView.tsx`
- Reference: `docs/superpowers/specs/2026-04-03-web-electron-runtime-capability-design.md`

- [ ] Add explicit runtime mode and capability flags:
  - `web`
  - `electron`
- [ ] Gate desktop-only capabilities behind host-provided availability
- [ ] Keep web-hosted mode sandboxed by default
- [ ] Keep Electron sandbox-first, then selectively allow host access
- [ ] Prepare for later shell permission controls, but do not ship unrestricted shell execution in Phase 1
- [ ] Make the UI reflect capability availability instead of failing late

### Task 5: Tighten desktop UI shell and panel density

**Files:**
- Modify: `src/components/ChatInterface.tsx`
- Modify: `src/components/chat/AgentLaneColumn.tsx`
- Modify: `src/components/settings/SettingsView.tsx`
- Modify: shared style/token helpers as needed

- [ ] Reduce icon clutter across the main shell:
  - remove duplicate icon+label combinations where one signal is enough
  - use fewer persistent chips
  - prefer text hierarchy over repeated badges
- [ ] Tighten layout density for desktop:
  - slimmer left rail
  - calmer topic rows
  - more room for message content
  - more compact settings cards
- [ ] Normalize hover/active states so controls feel stable and not “puffy”
- [ ] Keep the current color direction; optimize spacing, contrast, and control sizing instead of re-theming the app
- [ ] Use Cherry Studio as interaction reference specifically for:
  - topic list density
  - model/tool state placement
  - message readability
  - streamed response calmness

### Task 6: Improve Markdown rendering and streamed message polish

**Files:**
- Modify: `src/components/chat/AgentLaneColumn.tsx`
- Modify: markdown renderer helpers

- [ ] Tighten assistant markdown rendering so long answers feel cleaner on desktop
- [ ] Re-check code blocks, tables, lists, blockquotes, and inline code for density and spacing
- [ ] Keep streamed output visually stable:
  - avoid layout jumps
  - avoid over-aggressive auto-scroll
  - keep reasoning/output sections readable
- [ ] Continue shrinking message card chrome so the content dominates the surface

### Task 7: Fix remaining input and topic-switch performance bottlenecks

**Files:**
- Modify: `src/components/ChatInterface.tsx`
- Modify: `src/components/chat/AgentLaneColumn.tsx`
- Create/Modify: dedicated composer component(s)

- [ ] Split the composer into a more isolated subtree so typing does not re-render the heavy message column unnecessarily
- [ ] Keep topic switching lightweight:
  - avoid whole-shell refreshes
  - avoid redundant library/memory fetches
  - preserve a fast visual handoff between topics
- [ ] Verify long-thread typing and rapid topic switching on desktop-sized windows
- [ ] Prefer memoized lane rendering and stable props over ad hoc rehydration

### Task 8: Desktop startup and recovery UX

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/ChatInterface.tsx`
- Modify: host status surfaces

- [ ] Add a concise desktop startup state:
  - launching host
  - opening local workspace
  - recovering previous session
- [ ] Keep error surfaces compact and useful
- [ ] If the host bridge is missing or stale, show a direct desktop-oriented recovery path instead of a browser-style API error
- [ ] Make the desktop shell resilient to host restarts

### Task 9: Build and packaging verification for macOS

**Files:**
- Modify: packaging config files
- Create: desktop build docs

- [ ] Produce a local macOS `.app` build
- [ ] Verify the app boots without manual `api-server` startup
- [ ] Verify local config/memory/model metadata persistence works across restarts
- [ ] Verify desktop dev and packaged modes both work
- [ ] Record known unsigned-app limitations for local testing

### Task 10: Documentation and rollout notes

**Files:**
- Modify: `README.md`
- Modify: `todo-list.md`
- Modify: `docs/CHANGELOG.md`

- [ ] Document Phase 1 desktop scope clearly:
  - Electron shell added
  - host bridge auto-start
  - local-first persistence retained
  - no full IPC rewrite yet
- [ ] Add a concise “desktop mode vs web mode” behavior table
- [ ] Record UI tightening goals and what was explicitly improved
- [ ] Keep Phase 2 deferred items visible:
  - IPC migration
  - granular shell permissions
  - signed/notarized distribution
  - hosted storage split

---

## Phase 1 Deliverable

By the end of this plan, Vortex should run as a local macOS Electron application that:

- launches as a desktop app instead of requiring manual browser + host orchestration
- automatically manages the local host bridge
- preserves file-backed config, model metadata, and memory
- feels denser, calmer, and more desktop-native
- improves input/topic-switch responsiveness
- keeps the existing LangGraph/runtime stack intact rather than replacing it

## Explicit Non-Goals for Phase 1

- full IPC replacement of the host HTTP bridge
- unrestricted shell execution
- cloud account sync
- hosted web storage redesign
- signed/notarized public distribution
- complete Claude Code–style task graph compiler
