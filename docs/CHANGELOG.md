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
