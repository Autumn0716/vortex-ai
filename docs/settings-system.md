# Vortex Settings System

## Scope

This document describes the settings capabilities added on top of the existing Vortex UI without changing the overall visual structure.

## Implemented Areas

### 1. General Settings

- Language selection
- Proxy mode selection
- Custom proxy URL when proxy mode is set to `custom`
- Existing runtime toggles remain available:
  - knowledge base priority
  - assistant context retention
  - sandbox auto boot
  - auto title generation

### 2. Display Settings

- Light and dark theme modes
- Ten built-in theme presets
- Expandable color board for arbitrary accent selection
- Native color picker for custom accent colors
- Existing display preferences remain available:
  - auto scroll
  - timestamps
  - tool result visibility
  - compact lane mode
  - lane minimum width

### 3. Data Settings

- JSON backup
- JSON restore
- Minimal backup mode
- External document import into local knowledge base
- Markdown export for conversation history
- Local data statistics panel

## 4. MCP Server Settings

- Built-in marketplace-style templates
- Custom MCP server creation
- Editable transport type:
  - `streamable-http`
  - `sse`
  - `stdio`
- Editable URL / command / args / headers
- Persistent local storage of MCP server definitions

## 5. Web Search Settings

- Provider list with API and local-search categories
- Default provider selection
- Provider enable / disable state
- Configurable base URL and API key
- Homepage jump for local or provider-side settings
- Knowledge base fallback toggle

## 6. Global Memory

- Persistent global memory documents stored in SQLite
- Add / refresh / save / delete workflow
- Text editor for direct memory editing
- Optional injection into all agent lane prompts

## Data Model Changes

### Agent Config

The config object now includes:

- `general`
- `theme`
- `search.providers`
- `search.defaultProviderId`
- `search.fallbackToKnowledgeBase`
- `memory.includeGlobalMemory`
- `data.minimalBackup`
- extended `mcpServers`

Primary file:

- `/Users/jiangxun/vortex-ai/src/lib/agent/config.ts`

### SQLite

Added persistent table:

- `global_memory_documents`

Primary file:

- `/Users/jiangxun/vortex-ai/src/lib/db.ts`

## Theme Runtime

Theme behavior is applied through CSS variables and a lightweight theme helper.

Primary files:

- `/Users/jiangxun/vortex-ai/src/lib/theme.ts`
- `/Users/jiangxun/vortex-ai/src/index.css`

## Agent Runtime Integration

When `memory.includeGlobalMemory` is enabled, Vortex loads all global memory documents and injects the merged content into each lane's system prompt before LangGraph execution.

Primary file:

- `/Users/jiangxun/vortex-ai/src/components/ChatInterface.tsx`

## Notes

- MCP and web search pages now have complete configuration UIs, but external MCP execution and third-party web search invocation still depend on later runtime wiring.
- Backup restore currently reloads the app after import so the local config and SQLite state rehydrate cleanly.
