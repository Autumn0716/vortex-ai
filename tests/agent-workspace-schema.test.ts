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
