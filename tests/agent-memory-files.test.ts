import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAgentMemoryPaths,
  detectMemoryFileKind,
  parseMemoryMarkdown,
  resolveDailyMemoryDate,
  serializeMemoryMarkdown,
} from '../src/lib/agent-memory-files';

test('buildAgentMemoryPaths resolves MEMORY.md and daily paths for an agent slug', () => {
  const paths = buildAgentMemoryPaths('flowagent-core', '2026-04-01');
  assert.equal(paths.baseDir, 'memory/agents/flowagent-core');
  assert.equal(paths.memoryFile, 'memory/agents/flowagent-core/MEMORY.md');
  assert.equal(paths.dailyDir, 'memory/agents/flowagent-core/daily');
  assert.equal(paths.dailyFile, 'memory/agents/flowagent-core/daily/2026-04-01.md');
  assert.equal(paths.warmFile, 'memory/agents/flowagent-core/daily/2026-04-01.warm.md');
  assert.equal(paths.coldFile, 'memory/agents/flowagent-core/daily/2026-04-01.cold.md');
});

test('detectMemoryFileKind distinguishes source warm and cold daily files', () => {
  assert.equal(detectMemoryFileKind('memory/agents/core/MEMORY.md'), 'memory');
  assert.equal(detectMemoryFileKind('memory/agents/core/daily/2026-04-01.md'), 'daily_source');
  assert.equal(detectMemoryFileKind('memory/agents/core/daily/2026-04-01.warm.md'), 'daily_warm');
  assert.equal(detectMemoryFileKind('memory/agents/core/daily/2026-04-01.cold.md'), 'daily_cold');
  assert.equal(detectMemoryFileKind('memory/agents/core/notes/2026-04-01.md'), 'unknown');
  assert.equal(detectMemoryFileKind('docs/2026-04-01.md'), 'unknown');
});

test('resolveDailyMemoryDate extracts the source date from surrogate file names', () => {
  assert.equal(resolveDailyMemoryDate('memory/agents/core/MEMORY.md'), null);
  assert.equal(resolveDailyMemoryDate('memory/agents/core/daily/2026-04-01.cold.md'), '2026-04-01');
  assert.equal(resolveDailyMemoryDate('memory/agents/core/notes/2026-04-01.md'), null);
  assert.equal(resolveDailyMemoryDate('docs/2026-04-01.md'), null);
});

test('serializeMemoryMarkdown round-trips frontmatter and body', () => {
  const markdown = serializeMemoryMarkdown({
    frontmatter: { title: 'Long-term Memory', updatedAt: '2026-04-01T12:00:00.000Z' },
    body: '默认使用中文输出。',
  });
  const parsed = parseMemoryMarkdown(markdown);
  assert.equal(parsed.frontmatter.title, 'Long-term Memory');
  assert.equal(parsed.frontmatter.updatedAt, '2026-04-01T12:00:00.000Z');
  assert.equal(parsed.body, '默认使用中文输出。');
});

test('serializeMemoryMarkdown preserves string-like frontmatter values', () => {
  const markdown = serializeMemoryMarkdown({
    frontmatter: { active: 'true', count: '42', disabled: 'false' },
    body: 'body',
  });
  const parsed = parseMemoryMarkdown(markdown);
  assert.equal(parsed.frontmatter.active, 'true');
  assert.equal(parsed.frontmatter.count, '42');
  assert.equal(parsed.frontmatter.disabled, 'false');
});

test('serializeMemoryMarkdown preserves escaped newline strings', () => {
  const markdown = serializeMemoryMarkdown({
    frontmatter: { note: 'line 1\nline 2' },
    body: 'body',
  });
  const parsed = parseMemoryMarkdown(markdown);
  assert.equal(parsed.frontmatter.note, 'line 1\nline 2');
});

test('parseMemoryMarkdown tolerates CRLF frontmatter fences', () => {
  const parsed = parseMemoryMarkdown('---\r\ntitle: Memory\r\nupdatedAt: 2026-04-01T12:00:00.000Z\r\n---\r\n\r\nbody');
  assert.equal(parsed.frontmatter.title, 'Memory');
  assert.equal(parsed.frontmatter.updatedAt, '2026-04-01T12:00:00.000Z');
  assert.equal(parsed.body, 'body');
});
