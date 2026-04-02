import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureAgentWorkspaceSchema } from '../src/lib/agent-workspace-schema';

test('ensureAgentWorkspaceSchema adds missing memory columns before creating indexes that depend on them', () => {
  const runs: string[] = [];

  const database = {
    run(sql: string) {
      runs.push(sql);
    },
    exec(sql: string) {
      if (sql === 'PRAGMA table_info(agent_memory_documents)') {
        return [
          {
            columns: ['name'],
            values: [
              ['id'],
              ['agent_id'],
              ['title'],
              ['content'],
              ['created_at'],
              ['updated_at'],
            ],
          },
        ];
      }

      return [];
    },
  };

  ensureAgentWorkspaceSchema(database);

  const alterIndex = runs.findIndex((sql) => sql.includes('ALTER TABLE agent_memory_documents ADD COLUMN memory_scope'));
  const createIndex = runs.findIndex((sql) => sql.includes('CREATE INDEX IF NOT EXISTS idx_agent_memory_scope_updated'));

  assert.notEqual(alterIndex, -1);
  assert.notEqual(createIndex, -1);
  assert.ok(alterIndex < createIndex);
});

test('ensureAgentWorkspaceSchema creates cold memory embedding storage', () => {
  const runs: string[] = [];

  const database = {
    run(sql: string) {
      runs.push(sql);
    },
    exec(sql: string) {
      if (sql === 'PRAGMA table_info(agent_memory_documents)') {
        return [
          {
            columns: ['name'],
            values: [
              ['id'],
              ['agent_id'],
              ['title'],
              ['content'],
              ['memory_scope'],
              ['source_type'],
              ['importance_score'],
              ['topic_id'],
              ['event_date'],
              ['created_at'],
              ['updated_at'],
            ],
          },
        ];
      }

      return [];
    },
  };

  ensureAgentWorkspaceSchema(database);

  assert.ok(runs.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS agent_memory_embeddings')));
  assert.ok(runs.some((sql) => sql.includes('CREATE INDEX IF NOT EXISTS idx_agent_memory_embeddings_agent_source')));
  assert.ok(runs.some((sql) => sql.includes('CREATE INDEX IF NOT EXISTS idx_agent_memory_embeddings_agent_event')));
});

test('ensureAgentWorkspaceSchema adds session runtime columns to topics', () => {
  const runs: string[] = [];

  const database = {
    run(sql: string) {
      runs.push(sql);
    },
    exec(sql: string) {
      if (sql === 'PRAGMA table_info(agent_memory_documents)') {
        return [
          {
            columns: ['name'],
            values: [
              ['id'],
              ['agent_id'],
              ['title'],
              ['content'],
              ['memory_scope'],
              ['source_type'],
              ['importance_score'],
              ['topic_id'],
              ['event_date'],
              ['created_at'],
              ['updated_at'],
            ],
          },
        ];
      }

      if (sql === 'PRAGMA table_info(topics)') {
        return [
          {
            columns: ['name'],
            values: [
              ['id'],
              ['agent_id'],
              ['title'],
              ['title_source'],
              ['created_at'],
              ['updated_at'],
              ['last_message_at'],
            ],
          },
        ];
      }

      return [];
    },
  };

  ensureAgentWorkspaceSchema(database);

  assert.ok(runs.some((sql) => sql.includes("ALTER TABLE topics ADD COLUMN session_mode TEXT NOT NULL DEFAULT 'agent'")));
  assert.ok(runs.some((sql) => sql.includes('ALTER TABLE topics ADD COLUMN display_name TEXT')));
  assert.ok(runs.some((sql) => sql.includes('ALTER TABLE topics ADD COLUMN system_prompt_override TEXT')));
  assert.ok(runs.some((sql) => sql.includes('ALTER TABLE topics ADD COLUMN provider_id_override TEXT')));
  assert.ok(runs.some((sql) => sql.includes('ALTER TABLE topics ADD COLUMN model_override TEXT')));
  assert.ok(runs.some((sql) => sql.includes("ALTER TABLE topics ADD COLUMN enable_memory INTEGER NOT NULL DEFAULT 1")));
  assert.ok(runs.some((sql) => sql.includes("ALTER TABLE topics ADD COLUMN enable_skills INTEGER NOT NULL DEFAULT 1")));
  assert.ok(runs.some((sql) => sql.includes("ALTER TABLE topics ADD COLUMN enable_tools INTEGER NOT NULL DEFAULT 1")));
  assert.ok(
    runs.some((sql) =>
      sql.includes("ALTER TABLE topics ADD COLUMN enable_agent_shared_short_term INTEGER NOT NULL DEFAULT 0"),
    ),
  );
});
