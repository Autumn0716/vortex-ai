import assert from 'node:assert/strict';
import test from 'node:test';

import { syncPromotedMemoryFromSurrogates } from '../server/memory-promotion';
import type { AgentMemoryFileStore } from '../src/lib/agent-memory-sync';

class InMemoryFileStore implements AgentMemoryFileStore {
  constructor(private readonly files = new Map<string, string>()) {}

  async listPaths(prefix: string) {
    return [...this.files.keys()].filter((filePath) => filePath.startsWith(prefix)).sort();
  }

  async readText(filePath: string) {
    return this.files.get(filePath) ?? null;
  }

  async writeText(filePath: string, content: string) {
    this.files.set(filePath, content);
  }
}

test('syncPromotedMemoryFromSurrogates appends managed learned patterns without overwriting manual memory', async () => {
  const fileStore = new InMemoryFileStore(
    new Map([
      [
        'memory/agents/core/MEMORY.md',
        '---\ntitle: "Core Memory"\n---\n\nKeep answers in Chinese.',
      ],
      [
        'memory/agents/core/daily/2026-04-10.warm.md',
        [
          '---',
          'promotionCategory: "behavioral_patterns"',
          'promotionEntry: "Be concise, avoid disclaimers"',
          'shouldPromote: true',
          'importance: 5',
          'promoteSignals: "preference"',
          'abstractionLevel: "principle"',
          'transferability: "high"',
          'goldenLabel: "preferred"',
          '---',
          '',
          '## Summary',
          'Reusable style guidance.',
        ].join('\n'),
      ],
    ]),
  );

  const result = await syncPromotedMemoryFromSurrogates({
    agentSlug: 'core',
    fileStore,
    now: '2026-04-22T03:00:00.000Z',
  });

  const memoryMarkdown = await fileStore.readText('memory/agents/core/MEMORY.md');
  assert.equal(result.promotedCount, 1);
  assert.match(memoryMarkdown ?? '', /Keep answers in Chinese\./);
  assert.match(memoryMarkdown ?? '', /## Learned Patterns/);
  assert.match(memoryMarkdown ?? '', /### Behavioral Patterns/);
  assert.match(memoryMarkdown ?? '', /- Be concise, avoid disclaimers/);
});

test('syncPromotedMemoryFromSurrogates promotes repeated entries even without explicit shouldPromote', async () => {
  const surrogate = [
    '---',
    'promotionCategory: "workflow_improvements"',
    'promotionEntry: "Spawn sub-agents for long tasks"',
    'shouldPromote: false',
    'importance: 4',
    'promoteSignals: "workflow"',
    'abstractionLevel: "pattern"',
    'transferability: "high"',
    'goldenLabel: ""',
    '---',
    '',
    '## Summary',
    'Reusable workflow.',
  ].join('\n');

  const fileStore = new InMemoryFileStore(
    new Map([
      ['memory/agents/core/daily/2026-04-10.warm.md', surrogate],
      ['memory/agents/core/daily/2026-03-01.cold.md', surrogate],
    ]),
  );

  const result = await syncPromotedMemoryFromSurrogates({
    agentSlug: 'core',
    fileStore,
    now: '2026-04-22T03:00:00.000Z',
  });

  const memoryMarkdown = await fileStore.readText('memory/agents/core/MEMORY.md');
  assert.equal(result.promotedCount, 2);
  assert.match(memoryMarkdown ?? '', /### Workflow Improvements/);
  assert.match(memoryMarkdown ?? '', /- Spawn sub-agents for long tasks/);
});
