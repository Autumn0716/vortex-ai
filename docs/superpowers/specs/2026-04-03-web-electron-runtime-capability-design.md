# Web / Electron Runtime Capability Design

Date: 2026-04-03
Status: Draft
Owner: Vortex

## Goal

Unify runtime behavior across two product shapes:

- Web app: pure sandbox, no host-level access.
- Electron app: sandbox-first, with optional host permissions.

The key requirement is to avoid mixing product shape with business logic. Runtime features should be enabled by capability flags, not by ad hoc checks spread across the UI and tools.

## Decision Summary

1. Introduce a runtime capability model as a first-class config concept.
2. Web mode defaults to pure sandbox with no local host privileges.
3. Electron mode keeps sandbox execution by default, then selectively enables host capabilities such as file access, local API server, and shell execution.
4. Tool registration, memory backends, UI controls, and settings visibility all derive from the active capability set.
5. The same agent/session model should work in both modes. Only the available capabilities differ.

## Product Modes

### Web

Use case:

- hosted deployment
- browser-only runtime
- no direct project directory access

Principles:

- no shell
- no direct local file reads
- no local `config.json`
- no local `memory/*.md` source of truth
- no local `api-server` dependency

Allowed capability profile:

- model inference
- hosted search providers
- browser-safe tools
- browser sandbox execution
- remote persistence

### Electron

Use case:

- local desktop application
- project-aware agent workflow
- long-running local automation

Principles:

- sandbox remains the default execution environment
- host privileges are additive, explicit, and revocable
- local resources are enabled by capability, not assumed globally

Allowed capability profile can include:

- local file-backed memory
- local `config.json`
- local `api-server`
- workspace read/write
- shell execution
- scheduled jobs

## Capability Model

Add a dedicated runtime section to config:

```json
{
  "runtime": {
    "mode": "web",
    "capabilities": {
      "browserSandbox": true,
      "externalNetworkTools": true,
      "remoteConfigStore": true,
      "remoteMemoryStore": true,
      "localApiServer": false,
      "localConfigFile": false,
      "localMemoryFiles": false,
      "workspaceRead": false,
      "workspaceWrite": false,
      "shellExecution": false,
      "scheduledJobs": false
    }
  }
}
```

Recommended Electron baseline:

```json
{
  "runtime": {
    "mode": "electron",
    "capabilities": {
      "browserSandbox": true,
      "externalNetworkTools": true,
      "remoteConfigStore": false,
      "remoteMemoryStore": false,
      "localApiServer": true,
      "localConfigFile": true,
      "localMemoryFiles": true,
      "workspaceRead": true,
      "workspaceWrite": true,
      "shellExecution": true,
      "scheduledJobs": true
    }
  }
}
```

## Capability Definitions

### `browserSandbox`

Meaning:

- allows browser-safe execution such as WebContainer or equivalent isolated browser runtime

Required by:

- code interpreter in hosted mode
- web app quick utility tools

### `externalNetworkTools`

Meaning:

- allows outbound hosted tool providers such as Tavily, Exa, provider-native web tools

Required by:

- web search
- provider-native built-in tools

### `remoteConfigStore`

Meaning:

- config is stored remotely, not in local `config.json`

Used by:

- future hosted user accounts
- SaaS settings sync

### `remoteMemoryStore`

Meaning:

- memory and sessions are persisted to remote storage

Used by:

- hosted session history
- hosted memory RAG

### `localApiServer`

Meaning:

- front end may call the local host bridge for files, config, scheduling, and host tools

Used by:

- file-backed memory
- project knowledge watcher
- local config bridge

### `localConfigFile`

Meaning:

- `config.json` is an allowed source of truth

Used by:

- current local desktop-oriented setup

### `localMemoryFiles`

Meaning:

- `memory/agents/.../*.md` is available as a source of truth

Used by:

- local memory lifecycle
- nightly archive
- local skill overlays

### `workspaceRead`

Meaning:

- runtime may inspect the project workspace beyond memory files

Used by:

- project knowledge indexing
- repository-aware agents

### `workspaceWrite`

Meaning:

- runtime may modify files in the project workspace

Used by:

- code edits
- generated docs
- scaffold tasks

### `shellExecution`

Meaning:

- runtime may execute host shell commands

Used by:

- local automation
- build/test/fix workflows

### `scheduledJobs`

Meaning:

- host runtime may run background jobs

Used by:

- nightly memory archive
- background indexing

## Behavior Matrix

| Area | Web | Electron |
|---|---|---|
| Provider inference / chat runtime | Yes | Yes |
| Session-scoped agent runtime | Yes | Yes |
| Quick topics | Yes | Yes |
| Branch topics | Yes | Yes |
| Browser sandbox code execution | Yes | Yes |
| Local `config.json` | No | Yes |
| Local memory markdown | No | Yes |
| Local project knowledge watcher | No | Yes |
| Nightly archive | No | Yes |
| Host shell tools | No | Yes |
| Remote user persistence | Yes | Optional |

## Tool Registration Rules

Tools must be registered from capability gates, not from environment assumptions.

### Always eligible

- model-native reasoning
- provider-native hosted tools
- browser-safe search flows

### Only when `browserSandbox`

- browser code execution tools

### Only when `localApiServer` and `localMemoryFiles`

- local memory lifecycle sync
- memory file browsing
- nightly archive controls

### Only when `workspaceRead`

- project-wide knowledge indexing from local files

### Only when `workspaceWrite`

- local file mutation tools
- repository editing workflows

### Only when `shellExecution`

- shell-backed tools
- host process orchestration

## Storage Strategy

### Web

Source of truth should move to hosted storage:

- config: remote user config table
- sessions: remote session store
- memory: remote memory store or object storage
- RAG indexes: remote vector/database layer

No local file-backed truth should be assumed.

### Electron

Source of truth can remain local:

- `config.json`
- `memory/agents/.../*.md`
- local SQLite indexes
- local scheduler state

## UI Implications

The UI should expose capability-aware behavior:

### Web

- hide local file memory controls
- hide nightly archive controls
- hide local API server settings
- hide shell-oriented actions
- explain hosted limitations directly in the product

### Electron

- show local host status
- show file-backed memory controls
- show scheduler controls
- show shell permission status

The same settings categories can remain, but cards inside them should be gated by capability.

## Migration Strategy

### Phase 1

- add runtime capability schema to config model
- compute effective capability profile
- gate UI and tool registration from capabilities

### Phase 2

- split local-only settings from hosted-safe settings
- stop assuming local `api-server` exists in web mode

### Phase 3

- add remote persistence implementation for web mode
- keep local file source for Electron mode

## Non-Goals

- full hosted auth system in this document
- full Electron packaging details
- exact database schema for hosted storage
- permission prompts UX copy

## Open Questions

1. Should Electron shell execution be globally enabled, or per-tool approved?
2. Should hosted web mode support remote code execution, or remain browser-sandbox only?
3. Should `localApiServer` survive as HTTP in Electron, or later collapse into IPC?
4. Should workspace read/write be split more finely by path scopes?

## Recommended Next Step

Implement Phase 1 only:

- add `runtime.mode`
- add `runtime.capabilities`
- derive an effective capability profile
- hide/show local-only UI based on that profile
- gate local-only tool registration from that profile

This gives a clean foundation for both the hosted web app and the future Electron app without forcing storage migration immediately.
