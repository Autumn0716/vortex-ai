# Corrections and Reflections Bootstrap Memory Design

## Goal

Add two agent-scoped Markdown bootstrap files:

- `memory/agents/<agent-slug>/corrections.md`
- `memory/agents/<agent-slug>/reflections.md`

They sit beside `MEMORY.md`, are editable by users, are reindexed from file source, and are injected into the runtime system prompt before normal retrieved memory.

## Non-Goals

- No cloud sync.
- No LLM-based correction classifier in the first batch.
- No cross-agent sharing.
- No automatic deletion or compaction of user-authored entries.

## Memory Semantics

`corrections.md` records explicit user corrections and stable user rules learned from mistakes. It has higher priority than long-term memory.

`reflections.md` records agent-side failure lessons: what failed, why it failed, and what to check next time. It is useful context, but lower priority than user corrections.

Prompt priority:

1. Current user instruction
2. `corrections.md`
3. `MEMORY.md`
4. `reflections.md`
5. daily / warm / cold retrieved memory
6. skills and tool context

This ordering prevents self-generated reflections from overriding user corrections.

## File Format

Both files use normal memory frontmatter plus structured Markdown:

```md
---
title: "Agent Corrections"
kind: "corrections"
updatedAt: "2026-04-16T00:00:00.000Z"
---

## Active Corrections

### 2026-04-16 - Git tracking rule
- Trigger: 用户指出 todolist 不纳入 git 管理
- Rule: 不要把 todo-list.md 加入 git；只追加本地记录。
- Scope: repository
- Confidence: high
- Source: user_correction
```

```md
---
title: "Agent Reflections"
kind: "reflections"
updatedAt: "2026-04-16T00:00:00.000Z"
---

## Active Reflections

### 2026-04-16 - Config source mismatch
- Failure: web UI 和 app 没有读取同一份本地 config。
- Cause: 只验证了浏览器路径，没有验证 Electron/app 路径。
- Lesson: 涉及配置文件时必须检查 web、api-server、desktop 三个入口。
- Applies When: 修改配置加载、模型设置、app 启动逻辑。
- Confidence: medium
```

## Runtime Injection

The chat send path reads a bootstrap memory snapshot for the active agent:

- Corrections: fixed injection, compacted by character budget.
- Reflections: fixed injection, compacted by smaller character budget.
- Long-term memory: continues through the existing memory context path.

The injected text is visible in Prompt Inspector as independent sections.

## Indexing

The Markdown files remain the source of truth. SQLite rows are derived on rescan, matching the existing `MEMORY.md` and `daily/*.md` pattern.

Derived rows:

- `corrections.md` -> `memory_scope = global`, `source_type = correction`
- `reflections.md` -> `memory_scope = global`, `source_type = reflection`

The first implementation may inject these files directly from the file store and also index them for search. Direct bootstrap injection must not depend on RAG recall.

## UI

Settings -> memory file editor lists:

- `MEMORY.md`
- `corrections.md`
- `reflections.md`
- `daily/*.md`

Users can edit and save both new files through the same editor used for memory files.

## Auto-Capture Rules

First batch only includes conservative rule-based capture:

- Append to `corrections.md` only when the user message contains explicit correction language such as “不要”, “下次”, “以后”, “不是这样”, “你错在”, “记住”.
- Append to `reflections.md` only from explicit failure-handling code paths where a runtime/tool error is observed and later represented as a compact lesson.

If no safe signal exists, do not write either file.

## Error Handling

- Missing files are created lazily during bootstrap or when opened in settings.
- A failed read/write should not block workspace bootstrap.
- If local API server is disabled, the UI shows the same disabled memory-file state as existing memory editing.

## Verification

- Unit tests cover path resolution, file-kind detection, template creation, and derived document indexing.
- Runtime tests cover prompt assembly including corrections/reflections.
- Build verification remains `npm run lint` and `npm run build`.
