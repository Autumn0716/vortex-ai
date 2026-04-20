# Vortex Frontend Implementation Notes

## Overview

This document records the current frontend completion work for Vortex AI, with a focus on preserving the existing visual design while making the interface actually functional.

The current implementation centers on three technical pillars:

1. Multi-conversation, multi-agent-lane chat UI.
2. Agent execution driven by LangGraph + LangChain.
3. `@chenglou/pretext` integration for multi-column conversation performance.

## What Was Implemented

### Chat Workspace

- Replaced the old single `messages` array prototype with a real workspace model:
  - conversations
  - agent lanes
  - lane-scoped messages
- The left sidebar now uses persistent conversation data instead of static placeholders.
- `New Chat` creates a real conversation in local SQLite storage.
- Each conversation can contain multiple assistant lanes.
- The composer fans out one user prompt to multiple lanes.
- Lane execution supports:
  - `parallel`
  - `sequential`

### Prompts & Assistants

- Added an assistant library panel.
- Added prompt snippet management and insertion.
- Assistants can now be added into the active conversation as new lanes.
- Assistant records persist in SQLite.

### Settings

- Replaced the previous placeholder categories with persistent local settings.
- Added working configuration sections for:
  - model providers
  - default model routing
  - display preferences
  - memory and fan-out behavior
  - search and document settings
  - MCP placeholder slots
  - data export

### Knowledge and Sandbox

- File attachment now imports text files into the local knowledge base.
- `execute_code` is no longer mock-only.
- The LangChain tool now runs JavaScript/TypeScript or Bash/Sh commands inside WebContainer.

## Architecture

### Frontend Data Model

Implemented in [src/lib/db.ts](/Users/jiangxun/vortex-ai/src/lib/db.ts).

Primary tables:

- `conversations`
- `assistants`
- `prompt_snippets`
- `agent_lanes`
- `chat_messages`
- existing `documents`

This keeps the old local-first design, but upgrades it from a single-thread demo into a lane-based agent workspace.

### LangGraph + LangChain

Implemented in:

- [src/lib/agent/runtime.ts](/Users/jiangxun/vortex-ai/src/lib/agent/runtime.ts)
- [src/lib/agent/tools.ts](/Users/jiangxun/vortex-ai/src/lib/agent/tools.ts)
- [src/components/ChatInterface.tsx](/Users/jiangxun/vortex-ai/src/components/ChatInterface.tsx)

How it works:

1. Each lane carries its own assistant profile and prompt.
2. On send, the same user input is copied into each lane.
3. Each lane rebuilds its own short conversation context.
4. A LangGraph runtime is created for that lane.
5. The runtime binds LangChain tools:
   - `search_knowledge_base`
   - `execute_code`
6. Tool results are written back into the message UI.

Why this structure:

- It matches the approved "one conversation, multiple agent lanes" architecture.
- It keeps assistant behavior isolated per lane.
- It lets us scale toward stronger orchestration without redesigning the page.

## Pretext Integration

### Package

Integrated package:

- `@chenglou/pretext` `0.0.3`

Primary references:

- [GitHub README](https://github.com/chenglou/pretext)
- [npm package](https://www.npmjs.com/package/@chenglou/pretext)

As of March 29, 2026, the npm listing shows `@chenglou/pretext` version `0.0.3`.

### Why Pretext Was Added

The multi-lane chat layout creates a performance problem:

- several independently scrolling columns
- lots of Markdown bubbles
- frequent new message insertion
- costly DOM height measurement if we rely on `offsetHeight` / `getBoundingClientRect`

The official Pretext README explicitly positions it for:

- text height measurement without DOM layout reads
- virtualization / occlusion support
- masonry / userland layout systems
- scroll re-anchoring and layout-shift prevention

That maps very well to our multi-agent lane UI.

### How It Was Integrated

Implemented in:

- [src/lib/pretext.ts](/Users/jiangxun/vortex-ai/src/lib/pretext.ts)
- [src/components/chat/AgentLaneColumn.tsx](/Users/jiangxun/vortex-ai/src/components/chat/AgentLaneColumn.tsx)

Integration strategy:

1. We do **not** use Pretext to replace the visual Markdown renderer.
2. We use Pretext only as a measurement and layout-performance layer.
3. Message Markdown is reduced to a plain-text approximation for measurement.
4. `prepare()` + `layout()` estimate each bubble’s intrinsic height.
5. The lane message wrapper applies:
   - `content-visibility: auto`
   - `contain-intrinsic-size`
6. The browser gets a stable offscreen size estimate before the message fully paints.

### Why This Approach Was Chosen

This preserves the existing UI design and message rendering model:

- ReactMarkdown stays in place
- bubble styling stays in place
- copy/paste and rich text behavior stay normal

At the same time, it avoids the higher-risk option of rebuilding the chat renderer with canvas or manual line layout.

### What Pretext Is Doing in This Project

Functional role:

- estimate lane bubble heights without DOM reflow
- stabilize multi-column scroll behavior
- reduce re-layout work when many messages exist
- improve offscreen rendering behavior in long lane histories

### User-Visible Effect

Expected effect in real usage:

- less scroll jank in long conversations
- less layout jumping when new lane messages arrive
- more stable multi-column experience as lane count grows
- better perceived responsiveness in multi-agent mode

### Current Limitation

The measurement path is intentionally conservative:

- it estimates from stripped Markdown text
- it does not attempt exact code block or rich table metrics
- it is a performance hint layer, not a pixel-perfect renderer

That tradeoff is intentional because the goal here is:

- keep design unchanged
- improve runtime behavior
- avoid rewriting the UI into a custom rendering engine

## Performance Notes

Additional bundle/perf work done:

- lazy-loaded:
  - `TerminalPanel`
  - `KnowledgePanel`
  - `PromptsPanel`
  - `SettingsView`
- dynamically imported LangGraph runtime and LangChain message classes at send time

This reduces initial page cost compared with bundling all agent/runtime code into the first paint path.

## Key Files

- [src/components/ChatInterface.tsx](/Users/jiangxun/vortex-ai/src/components/ChatInterface.tsx)
- [src/components/chat/AgentLaneColumn.tsx](/Users/jiangxun/vortex-ai/src/components/chat/AgentLaneColumn.tsx)
- [src/components/PromptsPanel.tsx](/Users/jiangxun/vortex-ai/src/components/PromptsPanel.tsx)
- [src/components/settings/SettingsView.tsx](/Users/jiangxun/vortex-ai/src/components/settings/SettingsView.tsx)
- [src/lib/db.ts](/Users/jiangxun/vortex-ai/src/lib/db.ts)
- [src/lib/pretext.ts](/Users/jiangxun/vortex-ai/src/lib/pretext.ts)
- [src/lib/agent/runtime.ts](/Users/jiangxun/vortex-ai/src/lib/agent/runtime.ts)
- [src/lib/agent/tools.ts](/Users/jiangxun/vortex-ai/src/lib/agent/tools.ts)
- [src/lib/webcontainer.ts](/Users/jiangxun/vortex-ai/src/lib/webcontainer.ts)

## Verification

Validated locally with:

- `npm run lint`
- `npm run build`

Current status:

- TypeScript passes.
- Production build passes.
- Bundle is split better than before, though there are still large chunks from runtime-heavy dependencies. Further optimization can be done later with finer-grained manual chunking if needed.

## Recommended Next Steps

1. Add lane removal / reordering if product flow needs it.
2. Add streaming token output per lane.
3. Add real external web-search providers behind the existing settings toggle.
4. Add manual chunk configuration for LangChain / WebContainer-heavy bundles if startup budget needs to be tightened further.
