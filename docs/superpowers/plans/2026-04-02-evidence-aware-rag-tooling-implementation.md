# Evidence-Aware RAG Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agent runtime actually use the richer RAG evidence signals that already exist, so knowledge-base answers become more grounded and less likely to overstate weak retrieval results.

**Architecture:** Keep the retrieval stack unchanged. Improve the `search_knowledge_base` tool output so it returns an explicit evidence summary, support distribution, retrieval-stage metadata, and graph hints in a stable shape. Then add a small runtime instruction layer telling the agent how to answer differently for strong, mixed, and weak evidence.

**Tech Stack:** TypeScript, LangGraph runtime, local SQLite knowledge base, current deterministic and graph-assisted RAG pipeline

---

### Task 1: Evidence-aware tool output

**Files:**
- Modify: `src/lib/agent/tools.ts`
- Add or modify tests around tool output formatting

- [x] Return an explicit evidence summary alongside document hits
- [x] Surface `supportLabel`, `supportScore`, `retrievalStage`, `graphHints`, and `graphExpansionHints` in a stable agent-facing shape
- [x] Add a recommendation field for strong vs weak evidence situations

### Task 2: Runtime grounding instruction

**Files:**
- Modify: `src/lib/agent/runtime.ts`

- [x] Add a compact system instruction for how to use strong vs weak evidence from the knowledge tool
- [x] Keep the instruction narrow so it affects knowledge answers without bloating every prompt

### Task 3: Verification and records

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `todo-list.md`

- [x] Run `npm run lint`
- [x] Run targeted tests for tool formatting / runtime behavior
- [x] Run `npm run dev`
- [x] Record that the agent runtime now consumes evidence-aware RAG tool output
