import assert from 'node:assert/strict';
import test from 'node:test';

import { insertAuditLogInDatabase, listAuditLogsInDatabase } from '../src/lib/db-audit';

function createFakeDatabase(rows: unknown[][] = []) {
  const runCalls: Array<{ query: string; params: unknown[] }> = [];
  const execCalls: Array<{ query: string; params: unknown[] }> = [];
  return {
    runCalls,
    execCalls,
    database: {
      run(query: string, params: unknown[] = []) {
        runCalls.push({ query, params });
      },
      exec(query: string, params: unknown[] = []) {
        execCalls.push({ query, params });
        return [
          {
            columns: [
              'id',
              'category',
              'action',
              'topic_id',
              'topic_title',
              'agent_id',
              'message_id',
              'target',
              'status',
              'summary',
              'details',
              'metadata_json',
              'duration_ms',
              'created_at',
            ],
            values: rows,
          },
        ];
      },
    },
  };
}

test('insertAuditLogInDatabase stores a log row with serialized metadata', () => {
  const fake = createFakeDatabase();

  insertAuditLogInDatabase(fake.database as never, {
    category: 'config',
    action: 'config_saved',
    target: 'config.json',
    status: 'success',
    summary: 'Saved project config.',
    metadata: {
      changedKeys: ['activeModel'],
    },
    createdAt: '2026-04-16T08:00:00.000Z',
  });

  assert.equal(fake.runCalls.length, 1);
  assert.match(fake.runCalls[0]?.query ?? '', /INSERT INTO audit_log/);
  assert.equal(fake.runCalls[0]?.params[1], 'config');
  assert.equal(fake.runCalls[0]?.params[2], 'config_saved');
  assert.equal(fake.runCalls[0]?.params[8], 'success');
  assert.match(String(fake.runCalls[0]?.params[11] ?? ''), /activeModel/);
});

test('listAuditLogsInDatabase returns newest rows first and applies filters', () => {
  const fake = createFakeDatabase([
    [
      'audit_tool',
      'tool',
      'tool_call',
      'topic_b',
      'Branch Topic',
      'agent_1',
      'message_1',
      'search_knowledge_base',
      'success',
      'Tool completed.',
      'Returned 4 results.',
      null,
      420,
      '2026-04-16T09:00:00.000Z',
    ],
    [
      'audit_memory',
      'memory',
      'memory_file_saved',
      'topic_a',
      'Memory Topic',
      'agent_2',
      null,
      'memory/agents/demo/MEMORY.md',
      'success',
      'Saved memory file.',
      null,
      '{"changedKeys":["content"]}',
      null,
      '2026-04-16T08:00:00.000Z',
    ],
  ]);

  const allLogs = listAuditLogsInDatabase(fake.database as never, { limit: 10 });
  assert.equal(allLogs.length, 2);
  assert.equal(allLogs[0]?.id, 'audit_tool');
  assert.match(JSON.stringify(allLogs[1]?.metadata ?? {}), /content/);

  const filtered = listAuditLogsInDatabase(fake.database as never, {
    category: 'memory',
    topicId: 'topic_a',
    limit: 20,
  });
  assert.equal(filtered.length, 2);
  assert.match(fake.execCalls[1]?.query ?? '', /WHERE category = \? AND topic_id = \?/);
  assert.deepEqual(fake.execCalls[1]?.params, ['memory', 'topic_a', 20]);
});
