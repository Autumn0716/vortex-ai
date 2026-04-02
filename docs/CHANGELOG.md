# Changelog

## 2026-04-01

### Fixed

- Fixed local workspace bootstrap failures caused by legacy `agent_memory_documents` rows missing the new memory lifecycle columns.
- Reordered agent workspace schema migration so missing columns are added before indexes that depend on them are created.
- Added bootstrap error detail surfacing in the chat shell so local initialization failures now show the concrete error chain instead of only a generic retry message.

### Improved

- Replaced the previous 8-second hard failure path with soft-timeout messaging plus a longer hard timeout for slow local workspace initialization.
- Added regression coverage for async timeout handling, bootstrap error formatting, and legacy workspace schema migration ordering.
- Added recent memory snapshot injection with `Recent memory snapshot` and `Open loops` sections so runtime prompts now receive recent daily/session summaries plus unresolved work items.
- Added a memory setting toggle for recent snapshot injection and recorded the incremental completion status in `todo-list.md`.
- Added an agent-scoped Markdown memory sync layer so `MEMORY.md` and `daily/*.md` can populate derived `agent_memory_documents` rows.
- Added a local Express-based memory API server plus frontend file-store registration so FlowAgent can read and write `memory/agents/<agent-slug>/...` directly from the Settings UI.
- Switched the Settings memory page from legacy global-memory document editing to raw Markdown file editing while preserving the existing theme shell.
- Added warm/cold lifecycle surrogate sync so `daily/*.warm.md` and `daily/*.cold.md` can be generated deterministically while SQLite only indexes the effective representation for each day.
- Added a manual `同步温冷层` control in Settings so users can regenerate lifecycle surrogates, refresh derived memory rows, and inspect `SOURCE / WARM / COLD` files without leaving the existing theme shell.
- Added a first-pass query-aware memory router so explicit old-time questions now go straight to `cold + global`, while ordinary questions search `hot + warm + global` first and only fall back to cold memory when recent layers are thin.
- Added a dedicated `agent_memory_embeddings` table plus cold-memory embedding sync so effective `cold.md` surrogates now produce rebuildable semantic vectors without reusing the knowledge-base document tables.
- Added query-time cold vector retrieval so explicit cold routes and recent-layer fallback paths can semantically recall the most relevant cold summaries instead of injecting every cold memory row.
- Added nightly memory archive scheduling to the local `api-server`, including project-local `.flowagent` settings/state files, startup catch-up for missed runs, and a matching Settings UI card for enabling and inspecting the job.
- Moved app configuration persistence toward a project-local `config.json` source, added `config.example.json`, exposed config read/write routes through the local `api-server`, and changed `npm run dev` to start both the frontend and host bridge together.
- Added optional nightly LLM memory scoring that reuses the active model from `config.json`, writes scored metadata into warm/cold surrogate frontmatter, and falls back to deterministic rules when model calls fail.
- Added weighted nightly promotion scoring with configurable memory weights in `config.json`, plus automatic promotion into an auto-managed `MEMORY.md` learned-patterns block for explicit user directives, repeated conclusions, and broadly reusable validated patterns.
- Added host-backed shared `SKILL.md` sync plus agent-scoped private skill sync so FlowAgent can index `skills/**/SKILL.md` and `memory/agents/<agent-slug>/skills/**/SKILL.md`, then inject the most relevant skills into the runtime prompt with agent-local skills preferred over shared ones.
- Replaced the previous shared project knowledge polling loop with an `api-server` watcher plus event stream so root-level `docs/**/*.md` and `skills/**/SKILL.md` changes now trigger automatic re-sync without waiting for a timer.
- Started the session-instance refactor by extending `topics` with session runtime fields, moving generation state to per-topic tracking, and adding an initial `Quick Topic` mode that disables memory, skills, and tools by default.
- Added a frontend runtime error boundary plus null-safe topic runtime rendering so session-scoped chat views no longer white-screen when `workspace` is temporarily unavailable during bootstrap or topic switching.
- Improved local API request diagnostics so host-backed config and memory failures now include the concrete local API URL in the surfaced error message.
- Added a topic-level session settings modal so each `Topic` can now override display name, system prompt, model, and feature flags without mutating the underlying agent template or global config.
- Reused the grouped chat model picker for topic-local model overrides, so session-scoped runtime selection now follows the same provider/family/series browsing flow as the existing model picker.
- Added topic-local stop controls and run-state badges so each session can stop its own stream, keep partial output when interrupted, and surface background topic generation directly in the topic list and composer shell.
- Replaced prompt-based quick-topic creation with an in-app modal and added `All / Agent / Quick` topic filtering so session-mode creation and sidebar management are easier without leaving the current theme shell.
- Added first-pass topic branching so the active session can spawn a child branch topic with inherited runtime settings, a compact parent-context bootstrap, and visible `Branch` badges in the chat shell.
- Added branch handoff so child branch topics can send a compact findings summary back into the parent topic, with an in-app `Send to Parent` dialog and a branch-side audit note.
- Added in-shell branch navigation strips so parent topics can see child branches and branch topics can jump back to the parent or across sibling branches without leaving the chat view.
- Added deterministic RAG query rewrite / expansion before knowledge-base recall, including conversational filler stripping, bounded synonym expansion, and cross-lingual alias bridging for local knowledge search.
- Added a deterministic second-pass RAG reranker after hybrid recall so title coverage, content coverage, and exact-phrase matches can refine candidate ordering before truncation.
- Added deterministic context compression for retrieved knowledge snippets so search results now return focused excerpts around query hits instead of always passing full document bodies downstream.
