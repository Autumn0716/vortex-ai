# Corrections and Reflections Bootstrap Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `corrections.md` and `reflections.md` as editable, file-backed, high-priority bootstrap memory files.

**Architecture:** Extend the existing Markdown memory source-of-truth path instead of adding a new persistence layer. The new files are discovered by memory-file APIs, indexed into derived memory rows, read directly for runtime bootstrap injection, and shown in Prompt Inspector as separate sections.

**Tech Stack:** React, TypeScript, local API server memory file API, SQLite-derived memory index, existing Prompt Inspector UI.

---

## Files

- Modify: `src/lib/agent-memory-files.ts` for paths and file-kind detection.
- Modify: `src/lib/agent-memory-api.ts` for listing and ensuring bootstrap files.
- Modify: `src/lib/agent-memory-model.ts` for new source types and context sections.
- Modify: `src/lib/agent-memory-sync.ts` for derived rows from bootstrap files.
- Modify: `src/lib/agent-workspace.ts` for bootstrap context read helper.
- Modify: `src/components/ChatInterface.tsx` for runtime injection and Prompt Inspector sections.
- Modify: `src/components/settings/SettingsView.tsx` for file-kind labels.
- Modify: `tests/agent-memory-sync.test.ts` and `tests/knowledge-memory-model.test.ts`.

## Task 1: Path and Kind Model

- [ ] Add `correctionsFile` and `reflectionsFile` to `buildAgentMemoryPaths()`.
- [ ] Extend `AgentMemoryFileKind` with `corrections` and `reflections`.
- [ ] Update the path regex so `memory/agents/<slug>/corrections.md` and `reflections.md` are recognized.
- [ ] Add tests for path resolution and file-kind detection.
- [ ] Run: `./node_modules/.bin/tsx --test tests/knowledge-memory-model.test.ts`

## Task 2: File API and Editor Listing

- [ ] Add templates for `corrections.md` and `reflections.md`.
- [ ] Extend `ensureAgentMemoryFile()` to accept `kind: 'memory' | 'daily' | 'corrections' | 'reflections'`.
- [ ] Extend `listAgentMemoryFiles()` so the two files appear after `MEMORY.md` and before daily files.
- [ ] Update Settings memory file labels to show `CORRECTIONS` and `REFLECTIONS`.
- [ ] Run: `npm run lint`.

## Task 3: Derived Indexing

- [ ] Add `correction` and `reflection` to `MemorySourceType`.
- [ ] Read `corrections.md` and `reflections.md` during `syncAgentMemoryFromStore()`.
- [ ] Insert them as global derived documents with high importance.
- [ ] Keep stale-row cleanup using the same derived ID prefix.
- [ ] Add sync tests proving both files become derived rows.
- [ ] Run: `./node_modules/.bin/tsx --test tests/agent-memory-sync.test.ts`.

## Task 4: Runtime Bootstrap Injection

- [ ] Add a helper that reads bootstrap memory files for an agent from the configured file store.
- [ ] In `ChatInterface`, fetch corrections/reflections before creating runtime.
- [ ] Inject corrections before normal memory and reflections after long-term memory.
- [ ] Add sections to Prompt Inspector for `Corrections` and `Reflections`.
- [ ] Keep character budgets small and deterministic.
- [ ] Run: `npm run lint`.

## Task 5: Verification and Tracking

- [ ] Run: `./node_modules/.bin/tsx --test tests/knowledge-memory-model.test.ts`.
- [ ] Run: `./node_modules/.bin/tsx --test tests/agent-memory-sync.test.ts`.
- [ ] Run: `npm run lint`.
- [ ] Run: `npm run build`.
- [ ] Update `todo-list.md` locally: mark item 22 progress, but do not add it to git.
- [ ] Commit code and docs only.
