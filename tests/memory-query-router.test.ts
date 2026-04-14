import assert from 'node:assert/strict';
import test from 'node:test';

import { routeMemoryQuery } from '../src/lib/memory-lifecycle/query-router';

test('routeMemoryQuery sends YYYY-MM-DD older than 15 days to cold', () => {
  const result = routeMemoryQuery('2026-03-01 那天的结论是什么？', {
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.equal(result.mode, 'explicit_cold');
  assert.deepEqual(result.preferredLayers, ['cold', 'global']);
  assert.deepEqual(result.fallbackLayers, []);
  assert.equal(result.matchedTimeExpression, '2026-03-01');
});

test('routeMemoryQuery sends YYYY/MM/DD older than 15 days to cold', () => {
  const result = routeMemoryQuery('2026/03/01 的方案还在吗？', {
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.equal(result.mode, 'explicit_cold');
  assert.deepEqual(result.preferredLayers, ['cold', 'global']);
  assert.deepEqual(result.fallbackLayers, []);
  assert.equal(result.matchedTimeExpression, '2026/03/01');
});

test('routeMemoryQuery sends last month queries to cold', () => {
  const result = routeMemoryQuery('上个月那个方案是什么？', {
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.equal(result.mode, 'explicit_cold');
  assert.deepEqual(result.preferredLayers, ['cold', 'global']);
  assert.deepEqual(result.fallbackLayers, []);
  assert.equal(result.matchedTimeExpression, '上个月');
});

test('routeMemoryQuery sends the week before last queries to cold', () => {
  const result = routeMemoryQuery('上上周的讨论结论是什么？', {
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.equal(result.mode, 'explicit_cold');
  assert.deepEqual(result.preferredLayers, ['cold', 'global']);
  assert.deepEqual(result.fallbackLayers, []);
  assert.equal(result.matchedTimeExpression, '上上周');
});

test('routeMemoryQuery sends last year queries to cold', () => {
  const result = routeMemoryQuery('去年的项目复盘在哪里？', {
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.equal(result.mode, 'explicit_cold');
  assert.deepEqual(result.preferredLayers, ['cold', 'global']);
  assert.deepEqual(result.fallbackLayers, []);
  assert.equal(result.matchedTimeExpression, '去年');
});

test('routeMemoryQuery sends Chinese month-day older than 15 days to cold', () => {
  const result = routeMemoryQuery('3月1日那次会议的结论是什么？', {
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.equal(result.mode, 'explicit_cold');
  assert.deepEqual(result.preferredLayers, ['cold', 'global']);
  assert.deepEqual(result.fallbackLayers, []);
  assert.equal(result.matchedTimeExpression, '3月1日');
});

test('routeMemoryQuery keeps invalid explicit ISO dates on the default path', () => {
  const result = routeMemoryQuery('2026-02-30 那天的结论是什么？', {
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.equal(result.mode, 'default');
  assert.deepEqual(result.preferredLayers, ['hot', 'warm', 'global']);
  assert.deepEqual(result.fallbackLayers, ['cold']);
  assert.equal(result.matchedTimeExpression, undefined);
});

test('routeMemoryQuery keeps the first explicit time match when multiple dates exist', () => {
  const result = routeMemoryQuery('2026-03-01 和 2026-04-01 两次方案分别是什么？', {
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.equal(result.mode, 'explicit_cold');
  assert.deepEqual(result.preferredLayers, ['cold', 'global']);
  assert.deepEqual(result.fallbackLayers, []);
  assert.equal(result.matchedTimeExpression, '2026-03-01');
});

test('routeMemoryQuery rolls Chinese month-day references back to the previous year when needed', () => {
  const result = routeMemoryQuery('12月31日那次会议的结论是什么？', {
    now: '2026-01-20T12:00:00.000Z',
  });

  assert.equal(result.mode, 'explicit_cold');
  assert.deepEqual(result.preferredLayers, ['cold', 'global']);
  assert.deepEqual(result.fallbackLayers, []);
  assert.equal(result.matchedTimeExpression, '12月31日');
});

test('routeMemoryQuery keeps recent explicit dates on the default path', () => {
  const result = routeMemoryQuery('2026-04-15 那天的结论是什么？', {
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.equal(result.mode, 'default');
  assert.deepEqual(result.preferredLayers, ['hot', 'warm', 'global']);
  assert.deepEqual(result.fallbackLayers, ['cold']);
  assert.equal(result.matchedTimeExpression, '2026-04-15');
});

test('routeMemoryQuery keeps exactly 15-day-old explicit dates on the default path', () => {
  const result = routeMemoryQuery('2026-04-05 那天的结论是什么？', {
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.equal(result.mode, 'default');
  assert.deepEqual(result.preferredLayers, ['hot', 'warm', 'global']);
  assert.deepEqual(result.fallbackLayers, ['cold']);
  assert.equal(result.matchedTimeExpression, '2026-04-05');
});

test('routeMemoryQuery keeps vague time references on the default path', () => {
  const result = routeMemoryQuery('之前那天说的那个方案是什么？', {
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.equal(result.mode, 'default');
  assert.deepEqual(result.preferredLayers, ['hot', 'warm', 'global']);
  assert.deepEqual(result.fallbackLayers, ['cold']);
  assert.equal(result.matchedTimeExpression, undefined);
});
