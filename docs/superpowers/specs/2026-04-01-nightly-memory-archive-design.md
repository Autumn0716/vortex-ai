# Nightly Memory Archive Design

## Goal

Add a nightly memory archive scheduler to the local API server so agent memory lifecycle compression can run automatically at night and can catch up on missed runs when the server was offline.

## Scope

This design covers:

- a scheduler hosted inside the local `api-server`
- nightly lifecycle sync for all registered agents
- startup catch-up for missed nightly runs
- status persistence for the last successful archive run
- minimal settings exposure for enabling, scheduling, and inspecting nightly archive state

This design does not cover:

- system cron / launchd integration
- LLM-based importance scoring
- deletion of raw `daily/YYYY-MM-DD.md` source files
- cross-machine scheduling
- background job queues or worker pools

## Existing State

The project already has:

- file-backed memory as the only source of truth
- manual warm/cold lifecycle sync
- derived SQLite memory rows
- cold-memory vector sync and query-time semantic retrieval
- a local Express API server for file-backed memory operations

What is still missing is automatic lifecycle execution. Today, lifecycle sync only runs when the user presses the manual sync control in Settings.

## Product Rules

### 1. Scheduler Lives in `api-server`

Nightly archive scheduling belongs in the local API server process.

If the API server is running continuously, it should execute once per night at the configured local time.

### 2. Missed Runs Must Be Replayed on Startup

If the API server was not running at the last scheduled time, starting it later should trigger one catch-up run automatically.

The system should not wait until the next night if the previous scheduled run was missed.

### 3. Lifecycle Logic Must Be Reused

The scheduler must not invent a second archive implementation.

For each agent, it should reuse the existing pipeline:

1. `syncAgentMemoryLifecycleFromStore(...)`
2. `syncCurrentAgentMemory(...)`

This preserves:

- warm/cold surrogate generation
- effective derived memory rows
- cold embedding sync

### 4. Failures Must Be Isolated Per Agent

One broken agent memory directory must not abort the whole nightly run.

Each agent should be processed independently and the run summary should record per-agent failures.

## Architecture

### A. Scheduler Module

Add a focused server-side scheduler module that is responsible for:

- reading nightly archive settings
- computing next run time
- deciding whether startup catch-up is required
- executing the archive run
- persisting last-run state

This module should not know about Express routes directly.

### B. Persistent State File

Persist scheduler state in a project-local file:

- `.flowagent/nightly-archive-state.json`

The file should record at least:

- `lastSuccessfulRunAt`
- `lastSuccessfulRunDate`
- `lastAttemptedRunAt`
- `lastRunSummary`

This state allows startup catch-up and simple status display in Settings.

### C. Scheduling Model

Default time:

- `03:00`

Behavior:

- on API server startup:
  - load state
  - determine whether a catch-up run is due
  - if yes, run immediately
  - then schedule the next timed execution
- after each run:
  - write state file
  - compute and schedule the next run

### D. Agent Enumeration

Nightly runs should process all registered agents from the local workspace database.

Each agent should only scan its own:

- `memory/agents/<agent-slug>/...`

No cross-agent mixing should happen.

## Settings Model

Add a minimal nightly archive settings surface to the existing config:

- `memory.nightlyArchiveEnabled: boolean`
- `memory.nightlyArchiveTime: string`

The time format should be stable and human-editable:

- `HH:MM`

Settings UI should expose:

- enable/disable toggle
- archive time input
- latest run status summary

The UI should keep the current visual theme and card layout.

## Data Flow

### Startup

1. `api-server` boots
2. scheduler loads config and state
3. scheduler decides whether the last scheduled nightly run was missed
4. if missed, it runs catch-up once
5. scheduler registers the next timer

### Timed Run

1. scheduled time arrives
2. scheduler lists all agents
3. for each agent:
   - create or reuse file store access
   - run lifecycle sync
   - run current-agent index sync
4. aggregate success/failure summary
5. write `.flowagent/nightly-archive-state.json`
6. schedule the next run

## Catch-Up Semantics

The catch-up logic should be deterministic and local-time based.

Version one rule:

- compute the most recent scheduled datetime before `now`
- if `lastSuccessfulRunAt` is missing or older than that scheduled datetime
- run catch-up exactly once

This avoids repeated replay for the same missed night.

## Error Handling

If state-file read fails because the file does not exist:

- treat it as first boot
- proceed normally

If state-file write fails:

- log the error
- do not crash the API server

If one agent archive fails:

- record the failure in the run summary
- continue processing the remaining agents

If the workspace database or memory file store is unavailable:

- log and mark the run as failed
- keep the API server alive

## Testing

The first implementation should cover:

- parsing and validating nightly archive time
- computing next scheduled run
- startup catch-up decision
- no double catch-up for the same missed run
- per-agent failure isolation
- state-file persistence and reload
- API server bootstrap still succeeds with scheduler enabled

## Out-of-Scope Follow-Ups

Deliberately postponed:

- system scheduler integration
- LLM-scored importance retention
- deleting raw daily files
- per-agent custom archive times
- UI controls for manual re-run of last missed schedule

## Implementation Notes

Likely implementation areas:

- `server/api-server.ts`
- new scheduler helper under `server/` or `src/lib/agent-memory-api.ts`
- `src/lib/agent/config.ts`
- `src/components/settings/SettingsView.tsx`
- tests for scheduler time calculation and catch-up behavior

The implementation should preserve the current manual sync path; nightly automation is additive, not a replacement.
