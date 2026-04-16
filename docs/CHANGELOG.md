# Changelog

## 2026-04-01

### Fixed

- Fixed browser-side SQLite initialization in Vite builds by wiring `@sqlite.org/sqlite-wasm/sqlite3.wasm` through an explicit asset URL instead of relying on the package's default wasm path inference.
- Fixed the Node/tsx regression caused by the browser-only SQLite wasm asset import by limiting explicit `?url` resolution to browser initialization only.
- Fixed runtime model resolution so topic or agent sessions which only carry a model name like `qwen...` can infer the matching enabled provider instead of silently falling back to the global default provider.
- Fixed local workspace bootstrap failures caused by legacy `agent_memory_documents` rows missing the new memory lifecycle columns.
- Reordered agent workspace schema migration so missing columns are added before indexes that depend on them are created.
- Added bootstrap error detail surfacing in the chat shell so local initialization failures now show the concrete error chain instead of only a generic retry message.

### Improved

- Replaced the previous 8-second hard failure path with soft-timeout messaging plus a longer hard timeout for slow local workspace initialization.
- Added regression coverage for async timeout handling, bootstrap error formatting, and legacy workspace schema migration ordering.
- Added recent memory snapshot injection with `Recent memory snapshot` and `Open loops` sections so runtime prompts now receive recent daily/session summaries plus unresolved work items.
- Added a memory setting toggle for recent snapshot injection and recorded the incremental completion status in `todo-list.md`.
- Added an agent-scoped Markdown memory sync layer so `MEMORY.md` and `daily/*.md` can populate derived `agent_memory_documents` rows.
- Added agent-scoped `corrections.md` and `reflections.md` bootstrap memory files so user corrections and agent failure lessons can be edited in Settings, indexed from Markdown, injected into runtime prompts, and inspected separately in Prompt Inspector.
- Improved Memory Timeline with text search, finer event labels, expandable metadata, and snapshot-backed undo for future memory file saves or daily-file deletes.
- Added code-aware project knowledge indexing for `src/**/*.ts|tsx|py|go`, producing compact code-summary documents with imports, symbols, source paths, and previews for local RAG.
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
- Added deterministic faithfulness/support metadata for retrieved knowledge snippets and preserved compressed excerpts through `searchKnowledgeDocuments()` so downstream tool output can judge result support without reverting to full documents.
- Added a first-pass graph-assisted retrieval layer for the local knowledge base, including derived document graph nodes/edges, query-entity overlap scoring, and `graphHints` observability in search results.
- Added a bounded corrective retrieval pass for weak or sparse knowledge-base queries so the local RAG pipeline can derive focused follow-up queries from support gaps and graph hints, then merge the extra recall path back into final ranking with `retrievalStage` metadata.
- Added bounded graph-neighborhood expansion on top of direct graph overlap so second-order entities from `document_graph_edges` can surface related documents, with separate `graphExpansionHints` for observability.
- Upgraded `search_knowledge_base` to return an explicit evidence summary plus stable per-result support, retrieval-stage, and graph metadata, and added a compact runtime grounding instruction so agent answers treat weak evidence more cautiously.
- Added in-chat message actions for copying user/assistant text, regenerating the latest assistant turn in place, and grouping regenerated assistant variants with visible `<current/total>` counters.
- Added a composer-level web-search picker button with provider selection, active/highlighted state, and runtime wiring for a first-pass `search_web` tool backed by the selected provider.
- Added protocol-aware model provider configuration so each vendor entry can now be marked as `OpenAI 兼容`, `OpenAI Responses 兼容`, or `Anthropic 原生`, with matching base URL placeholders and request previews in Settings.
- Added response-compatible runtime routing so providers configured for `Responses` now call `/responses` directly, while chat-compatible providers keep using the existing LangGraph chat-completions path and local tool loop.
- Added model-list endpoint fallback for response-compatible providers so `/models` probing can fall back from the Responses base path to the sibling Chat-compatible model catalog when necessary.
- Added first-pass Qwen official runtime controls in the composer: chat-compatible Qwen providers can now enable `enable_thinking` and `response_format`, while responses-compatible providers can toggle official built-in `web_search`, `web_extractor`, `code_interpreter`, and SSE-backed `MCP` tools.
- Added reasoning-preview plumbing so chat-compatible Qwen streams that emit `reasoning_content` can surface a compact “思考中” notice instead of silently discarding the reasoning delta.
- Added image attachments to topic messages so local uploads are persisted with the conversation and can be reused by retries or future runtime calls instead of existing only in composer state.
- Added first-pass Qwen image tool wiring for `web_search_image` and `image_search`, including composer-side image uploads, persisted message attachments, and Responses input conversion to `input_image` data URLs.
- Moved vendor/model-specific advanced capabilities out of the composer search popover and into a dedicated topic-level `模型功能` panel in the chat header, leaving the composer popover responsible only for basic web-search provider selection.
- Added topic-persisted model feature state so current-session settings like Qwen thinking, Responses built-in tools, structured output, and function-calling mode now survive reloads and branch inheritance.
- Added official-style Qwen Responses function-calling support by serializing local tool schemas as `type: function`, executing model-issued function calls locally, and continuing the Responses loop with `function_call_output` payloads until a final assistant answer is produced.
- Fixed model-provider protocol persistence so rapidly editing provider fields in Settings no longer races and overwrites `responses` providers back to `chat`, and legacy/custom providers now infer `openai_responses_compatible` from Responses-style DashScope base URLs.
- Replaced the browser `prompt()` flow for adding model providers with an in-app creation dialog that collects vendor name, protocol type, API key, and base URL in one place.
- Locked provider protocol selection to creation time in the Settings UI so provider entries now use stable suffixes like `· Chat` / `· Responses`, while the detail pane shows the protocol as read-only to avoid accidental fallback or protocol drift.
- Grouped provider lists in Settings and the chat model picker by protocol mode (`OpenAI Compatible / Responses / Anthropic`), so model services are easier to scan when multiple vendor variants coexist.
- Replaced the remaining browser-native Settings prompts and confirms for provider/model/memory actions with in-app dialogs, keeping the interaction style consistent with the rest of the shell.
- Memoized the heavy chat message lane so typing into the composer no longer forces long conversation columns to rebuild on every keystroke, which reduces input lag in large topics.
- Extended graph-assisted retrieval into a more explicit graph-evidence layer by adding bounded two-hop graph expansion and `graphPaths` metadata, so retrieved documents can now explain not just which entities matched but which graph paths connected the query to that document.
- Increased daily memory log granularity so conversation-log entries now persist richer block-level details including role labels, attachment summaries, tool result summaries, and explicit `open_loop` / `decision` signals before nightly warm/cold compression runs.
- Added the first Electron desktop shell for macOS-oriented local use, including a main/preload boundary, `desktop:dev` and `desktop:preview` scripts, automatic host bridge startup in preview mode, and an Electron-specific Vite build mode with relative asset paths.
- Exposed Electron desktop runtime status through the preload bridge so the renderer can read platform/version details and host bridge state without enabling Node integration.
- Added Electron data-root resolution so development mode keeps using the repository root while packaged desktop mode can default local config, model metadata, and memory files under the macOS application data workspace.
