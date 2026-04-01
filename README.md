<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# FlowAgent AI

This repository contains the local-first FlowAgent workspace, including agent lanes, local SQLite-backed knowledge retrieval, LangGraph-based runtime execution, and the new file-backed agent memory model.

## Run Locally

Prerequisites:

- Node.js
- npm

Install and start the web app:

```bash
npm install
npm run dev
```

The Vite app runs on `http://127.0.0.1:3000` by default.

## Local Memory API Server

The frontend can now edit real project memory files through a local API server. Start it from the repository root:

```bash
npm run api-server
```

By default it listens on `http://127.0.0.1:3850`.

Optional environment variables:

- `FLOWAGENT_API_PORT`: override the local API port
- `FLOWAGENT_PROJECT_ROOT`: override the project root used for memory file resolution
- `FLOWAGENT_API_TOKEN`: require `Authorization: Bearer <token>` on API requests

In Settings -> `API 服务器`:

- enable the local API server toggle
- keep `http://127.0.0.1:3850` as the default `baseUrl`, or point it to your custom server
- if you configured `FLOWAGENT_API_TOKEN`, put the same token in `authToken`

## Memory Storage

Agent memory now uses Markdown files as the only source of truth.

- Long-term memory: `memory/agents/<agent-slug>/MEMORY.md`
- Daily short-term memory: `memory/agents/<agent-slug>/daily/YYYY-MM-DD.md`
- Default scan scope: only the current agent's own memory directory
- Cross-agent scanning: only when the user explicitly asks for it

Rules:

- Markdown files are authoritative
- SQLite is only a rebuildable index and cache layer
- UI edits write Markdown first, then refresh the current agent's derived index
- Manual edits outside the app can be restored by rescanning the current agent memory files

The runtime remains on the existing LangGraph stack in [`src/lib/agent/runtime.ts`](src/lib/agent/runtime.ts); memory changes feed that runtime through file-backed derived records rather than a second agent framework.
