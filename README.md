# Vortex AI

Vortex AI is a local-first agent workspace for long-running conversations, file-backed memory, local RAG, and Electron desktop use.

The project is designed around a simple rule: user-editable Markdown files are the source of truth, while SQLite is a rebuildable index/cache layer.

## Features

- Multi-session agent workspace with isolated topic runtime settings.
- Quick chat mode for lightweight model conversations without agent memory/tools.
- LangGraph-based agent runtime with streaming output, tool calls, reasoning output, and Responses API support.
- Local SQLite RAG with lexical, vector, graph, corrective retrieval, rerank weights, evidence feedback, and document quality scoring.
- File-backed agent memory under `memory/agents/<agent-slug>/`, including `MEMORY.md`, `corrections.md`, `reflections.md`, and `daily/*.md`.
- Hot/warm/cold memory lifecycle with Markdown warm/cold surrogates, cold-vector recall, configurable retention, and protected topics.
- Session summaries with deterministic and optional LLM modes, token-budget-aware context trimming, and incremental summary updates.
- Agent skills from shared `skills/**/SKILL.md` and agent-private `memory/agents/<slug>/skills/**/SKILL.md`.
- Workflow task graphs with planner/dispatcher/worker/reviewer structure, branch topics, background worker execution, retry, handoff, and review rollup.
- Local automation registry for daily summaries, nightly archive, weekly archive, git pre-push review, and parameterized agent task queueing.
- Electron desktop shell with built-in local API server bridge, runtime diagnostics, native dialogs, tray, notification, and global shortcut support.
- Prompt Inspector, Memory Inspector, Memory Timeline, Audit Viewer, Usage Panel, model metadata inspector, and `.vortex` agent package import/export.

## Current Status

- Web app: usable for local development.
- Electron macOS app: unsigned local build is available.
- Data model: local-first, privacy-oriented, with project-local config and Markdown memory files.
- Not production-hardened yet: macOS signing/notarization, encrypted cloud sync, and broader multi-format ingestion are still pending.

## Quick Start

```bash
npm install
npm run dev
```

Default local services:

- Web UI: `http://127.0.0.1:3000`
- Local API server: `http://127.0.0.1:3850`

Run only the web UI:

```bash
npm run dev:web
```

Run only the local API server:

```bash
npm run api-server
```

## Electron

Preview the desktop app:

```bash
npm run desktop:preview
```

Build an unsigned macOS app:

```bash
npm run desktop:build
```

Build output:

```text
release/mac-arm64/Vortex.app
```

Notes:

- The packaged app starts the local host bridge automatically.
- Packaged workspace data defaults to `~/Library/Application Support/Vortex/workspace`.
- The current macOS build is unsigned and not notarized.

## Configuration

Private local config lives in:

```text
config.json
```

The committed template is:

```text
config.example.json
```

Useful environment variables:

- `VORTEX_API_PORT`: local API server port.
- `VORTEX_PROJECT_ROOT`: project root used by the API server.
- `VORTEX_API_TOKEN`: optional bearer token for local API requests.

## Memory Layout

```text
memory/
└── agents/
    └── <agent-slug>/
        ├── MEMORY.md
        ├── corrections.md
        ├── reflections.md
        ├── daily/
        │   ├── YYYY-MM-DD.md
        │   ├── YYYY-MM-DD.warm.md
        │   └── YYYY-MM-DD.cold.md
        └── skills/
            └── <skill-name>/SKILL.md
```

These files are intentionally local/private by default and are ignored for public release.

## Scripts

```bash
npm run dev              # web + local API server
npm run dev:web          # Vite only
npm run api-server       # local API server only
npm run lint             # TypeScript check
npm run build            # web build
npm run build:host       # host bridge bundle
npm run desktop:preview  # Electron preview
npm run desktop:build    # unsigned macOS app
npm run hooks:install    # install Vortex git hooks
```

## Release Notes

This repository is prepared as a local-first desktop/web app snapshot. Before public distribution, review:

- `config.example.json` for safe defaults.
- `.gitignore` for private local state.
- `todo-list.md` for current completed and pending work.
- `docs/CHANGELOG.md` for implementation history.

## License

MIT
