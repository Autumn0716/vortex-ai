# Config File Source Design

## Goal

Move the application configuration out of browser-only storage and into a project-local file source so both the frontend and the local host process can read the same configuration.

The target end state is:

- `config.json` becomes the local source of truth for app configuration
- the local `api-server` becomes the single bridge for reading and writing config from the browser UI
- the design remains compatible with a later Electron host without forcing an immediate desktop migration

## Scope

This design covers:

- replacing browser `localforage` config persistence with file-backed config
- introducing project-root `config.json`
- introducing a versioned `config.example.json` template
- adding config read/write APIs to the local `api-server`
- switching frontend config loading and saving to those APIs
- adding a migration path from legacy browser config into `config.json`
- adding a one-command local development path that starts both the frontend and the `api-server`

This design does not cover:

- Electron packaging itself
- replacing HTTP with Electron IPC yet
- moving the SQLite workspace database out of browser local storage
- LLM-based nightly importance scoring implementation

## Existing State

Today, configuration is stored in browser `localforage` under `agent_config_v3`.

That creates a hard architectural mismatch:

- the browser can read config
- the `api-server` cannot read config
- nightly background jobs cannot rely on model settings
- future host-side features must invent ad hoc config files or duplicate settings

The project already has a local `api-server` for file-backed memory operations and nightly archive scheduling, so config should follow the same host-bridged pattern.

## Product Rules

### 1. `config.json` Is the Config Source of Truth

The canonical app config must live in:

- `./config.json`

This file is local/private and must not be committed.

### 2. `config.example.json` Is the Versioned Template

The repository must contain:

- `./config.example.json`

This file documents the expected shape and gives users a safe starting template.

### 3. Browser UI Must Not Persist Config Directly

The frontend must stop writing config to browser storage.

All persistent config reads and writes must go through the local host layer:

- today: local `api-server`
- later: Electron host or IPC-backed equivalent

### 4. Legacy Browser Config Needs a One-Time Migration Path

If legacy browser config exists and `config.json` does not exist yet, the app should be able to migrate the saved browser config into the new file-backed source.

The migration should be explicit and deterministic:

- read legacy `agent_config_v3`
- normalize it
- write `config.json`
- then continue reading from file-backed config

### 5. Frontend Editing Depends on Host Connectivity

Once config becomes file-backed, persistent editing requires the host bridge to be available.

Behavior:

- if the `api-server` is reachable, config is fully readable and writable
- if the `api-server` is unavailable, the frontend may still boot with in-memory defaults, but persistent saves must be disabled or fail clearly

This keeps the browser safe and makes the host dependency explicit.

## File Layout

### Project Files

- `config.json`
- `config.example.json`

### Git Rules

- `config.json` must be added to `.gitignore`
- `config.example.json` must be committed

## Architecture

### A. Config File Module

Add a focused file-backed config module that is responsible for:

- locating `config.json`
- reading and normalizing config from disk
- initializing `config.json` from `config.example.json` or defaults when missing
- writing normalized config back to disk

This module should be shared by:

- the local `api-server`
- server-side jobs such as nightly archive
- future Electron host integration

It should not depend on browser APIs.

### B. Local API Surface

The `api-server` should expose config endpoints such as:

- `GET /api/config`
- `PUT /api/config`
- optional migration endpoint if needed by the frontend bootstrap

These endpoints should return normalized config and keep error messages explicit.

### C. Frontend Config Flow

`getAgentConfig()` and `saveAgentConfig()` should stop talking to `localforage`.

Instead:

- on load, attempt to read config from the local `api-server`
- on save, write config through the local `api-server`
- if the local server is unavailable, return normalized defaults for runtime use and surface that persistence is unavailable

### D. Automatic Local Host Startup

For local development, the project should provide a single command that starts:

- Vite frontend
- local `api-server`

Version one target:

- add a `dev:all` style command for developers

This is not Electron yet, but it keeps the host dependency aligned with the eventual packaged application.

## Migration Plan

### First Run with File Config

When the app requests config:

1. try `config.json`
2. if missing, try legacy browser config
3. if legacy config exists:
   - normalize it
   - write `config.json`
   - continue using file-backed config
4. otherwise initialize `config.json` from defaults or `config.example.json`

### Post-Migration Behavior

After `config.json` exists, it becomes authoritative.

Legacy browser config should no longer be treated as a live source of truth.

## Electron Compatibility

This design intentionally keeps the config logic host-oriented.

When the project later moves to Electron:

- `config.json` can remain unchanged
- the config file module can remain unchanged
- the frontend contract can remain largely unchanged
- only the transport layer may change from HTTP to Electron IPC or an embedded local service

This avoids rewriting config semantics twice.

## Error Handling

If `config.json` is missing:

- initialize it deterministically

If `config.json` is invalid JSON:

- fail with a clear parse error
- do not silently discard user config

If the browser cannot reach the host bridge:

- return normalized defaults for non-persistent runtime boot
- show that file-backed persistence is unavailable

If config save fails:

- preserve the in-memory draft
- show the concrete write failure

## Testing

The first implementation should cover:

- reading missing `config.json` and creating it
- reading valid `config.json`
- rejecting invalid JSON with a concrete error
- writing updated config back to disk
- migrating legacy browser config into `config.json`
- frontend config helpers using the new API
- `api-server` config routes
- `dev:all` or equivalent startup path

## Follow-Ups

Deliberately postponed:

- removing legacy browser config code entirely until migration is stable
- Electron packaging and IPC transport
- moving workspace DB persistence out of browser storage
- LLM nightly archive scoring, which should be implemented after host-readable config exists
