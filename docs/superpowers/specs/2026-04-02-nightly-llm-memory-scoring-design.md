# Nightly LLM Memory Scoring Design

## Goal

Add LLM-based importance scoring to nightly memory archive so warm/cold surrogate files carry model-evaluated importance metadata without automatically mutating long-term `MEMORY.md`.

## Scope

This design covers:

- reusing the current active model from `config.json`
- scoring nightly warm/cold lifecycle inputs during archive
- writing scored metadata into `*.warm.md` / `*.cold.md` frontmatter
- propagating scored importance into derived SQLite memory rows
- falling back to deterministic rule scoring when model access fails
- exposing a nightly setting to enable/disable LLM scoring

This design does not cover:

- automatic promotion into `MEMORY.md`
- a separate archive-only model configuration
- changing lifecycle tier assignment based on the model result
- GraphRAG or structured knowledge graph extraction

## Product Rules

### 1. Reuse the Current Active Model

Nightly scoring must use the current `activeProviderId + activeModel` from `config.json`.

No separate archive model settings will be added in version one.

### 2. Score Only Lifecycle Candidates

The scorer runs only for daily source files that have already crossed into:

- warm tier
- cold tier

Hot tier files are not scored by the nightly job.

### 3. Do Not Auto-Edit `MEMORY.md`

Even if the model assigns a high score, the nightly job must not automatically append to or rewrite `MEMORY.md`.

The first version only writes metadata to surrogate files and derived indexes.

### 4. Time Tier Still Wins

The model may suggest `warm` or `cold` retention, but the actual lifecycle tier remains controlled by time windows.

Model suggestions are recorded as metadata only.

### 5. Failure Must Fall Back Cleanly

If the model call fails because of:

- missing key
- invalid provider settings
- network failure
- malformed model output

the nightly archive must continue and use the current rule-based importance score.

## Scoring Output

For each scored source daily file, the model returns:

- `importanceScore`: integer `1-5`
- `reason`: short explanation
- `suggestedRetention`: `warm` or `cold`
- `promoteSignals`: string array

These values are advisory metadata. The enforced lifecycle tier remains unchanged.

## File Output

### Warm Surrogate Frontmatter

Warm surrogate frontmatter gains:

- `importance`
- `importanceReason`
- `importanceSource` = `llm` or `rules`
- `retentionSuggestion`
- `promoteSignals`

### Cold Surrogate Frontmatter

Cold surrogate frontmatter gains the same fields:

- `importance`
- `importanceReason`
- `importanceSource`
- `retentionSuggestion`
- `promoteSignals`

`promoteSignals` should be serialized into a stable string form because current frontmatter helpers only support scalar values.

## Derived Index Behavior

When surrogate markdown is synced into `agent_memory_documents`:

- `importance_score` should use the scored `importance` value from frontmatter when present
- if the frontmatter is missing or invalid, keep the existing rule-based score path

This allows runtime memory ranking and future promotion flows to reuse the model score without rereading raw files.

## Architecture

### A. Server-Side LLM Scoring Module

Add a focused server-side module that:

- reads the project config from `config.json`
- resolves the active provider/model
- creates a compatible chat client
- prompts the model for a small JSON scoring payload
- parses and validates the result

This module should be reusable from nightly archive and future host-side memory jobs.

### B. Lifecycle Hook

`syncAgentMemoryLifecycleFromStore(...)` should accept an optional scoring callback.

For each warm/cold candidate:

1. build the scoring input from the source daily markdown
2. try the LLM scorer when enabled
3. if scoring fails, record fallback metadata and continue
4. build the surrogate markdown with the chosen scoring result

### C. Nightly Archive Settings

Extend nightly archive settings with:

- `useLlmScoring: boolean`

Default:

- `false`

This avoids surprise model cost after upgrade.

## UI

The existing `API 服务器 -> 夜间自动归档` card should add:

- a toggle for `启用 LLM 重要性评分`

The page should also surface, in the existing status area where useful:

- whether the last run used LLM scoring
- whether any items fell back to rules

The current theme and card structure should remain intact.

## Testing

Version one should cover:

- successful model scoring writes frontmatter metadata
- failed model scoring falls back to deterministic rules
- derived SQLite rows use surrogate frontmatter importance
- nightly settings persist `useLlmScoring`
- nightly status/summary can report LLM vs fallback counts

## Follow-Ups

Deliberately postponed:

- automatic promotion into `MEMORY.md`
- using model suggestions to override tier assignment
- batched scoring or cost optimization
- extracting structured graph entities during nightly archive
