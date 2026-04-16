import assert from 'node:assert/strict';
import test from 'node:test';

import { getTokenUsageSummaryInDatabase, upsertTokenUsageInDatabase } from '../src/lib/db-usage';

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
              'topic_id',
              'topic_title',
              'agent_id',
              'provider_id',
              'model',
              'session_mode',
              'message_id',
              'input_tokens',
              'output_tokens',
              'total_tokens',
              'estimated_cost',
              'usage_source',
              'stream_duration_ms',
              'reasoning_duration_ms',
              'created_at',
            ],
            values: rows,
          },
        ];
      },
    },
  };
}

test('upsertTokenUsageInDatabase writes a conflict-safe token usage row', () => {
  const fake = createFakeDatabase();

  upsertTokenUsageInDatabase(fake.database as never, {
    topicId: 'topic_1',
    topicTitle: 'Topic One',
    agentId: 'agent_1',
    providerId: 'provider_1',
    model: 'qwen3.5-plus',
    sessionMode: 'agent',
    messageId: 'message_1',
    inputTokens: 120,
    outputTokens: 45,
    totalTokens: 165,
    estimatedCost: 0.0021,
    usageSource: 'provider',
    streamDurationMs: 3200,
    reasoningDurationMs: 800,
    createdAt: '2026-04-16T08:00:00.000Z',
  });

  assert.equal(fake.runCalls.length, 1);
  assert.match(fake.runCalls[0]?.query ?? '', /INSERT INTO token_usage/);
  assert.match(fake.runCalls[0]?.query ?? '', /ON CONFLICT\(message_id\) DO UPDATE/);
  assert.deepEqual(fake.runCalls[0]?.params.slice(1, 8), [
    'topic_1',
    'Topic One',
    'agent_1',
    'provider_1',
    'qwen3.5-plus',
    'agent',
    'message_1',
  ]);
});

test('getTokenUsageSummaryInDatabase aggregates periods, trends, models and topics', () => {
  const fake = createFakeDatabase([
    [
      'usage_1',
      'topic_alpha',
      'Alpha',
      'agent_1',
      'provider_1',
      'qwen3.5-plus',
      'agent',
      'message_1',
      100,
      50,
      150,
      0.003,
      'provider',
      3200,
      700,
      '2026-04-16T08:00:00.000Z',
    ],
    [
      'usage_2',
      'topic_alpha',
      'Alpha',
      'agent_1',
      'provider_1',
      'qwen3.5-plus',
      'agent',
      'message_2',
      70,
      30,
      100,
      null,
      'estimate',
      1800,
      null,
      '2026-04-15T09:00:00.000Z',
    ],
    [
      'usage_3',
      'topic_beta',
      'Beta',
      'agent_2',
      'provider_2',
      'gpt-5',
      'quick',
      'message_3',
      90,
      20,
      110,
      0.004,
      'provider',
      2200,
      null,
      '2026-04-10T07:00:00.000Z',
    ],
  ]);

  const summary = getTokenUsageSummaryInDatabase(fake.database as never, {
    now: '2026-04-16T10:00:00.000Z',
    dailyWindowDays: 7,
  });

  assert.equal(summary.today.callCount, 1);
  assert.equal(summary.today.totalTokens, 150);
  assert.equal(summary.week.callCount, 2);
  assert.equal(summary.week.totalTokens, 250);
  assert.equal(summary.month.pricedCallCount, 2);
  assert.equal(summary.month.estimatedCost, 0.007);
  assert.equal(summary.byModel[0]?.label, 'qwen3.5-plus');
  assert.equal(summary.byModel[0]?.totalTokens, 250);
  assert.equal(summary.byTopic[0]?.label, 'Alpha');
  assert.equal(summary.byTopic[0]?.callCount, 2);
  assert.equal(summary.daily.length, 7);
  assert.equal(summary.daily[6]?.date, '2026-04-16');
});
