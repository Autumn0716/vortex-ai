import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeAgentConfig } from '../src/lib/agent/config';
import { scoreMemoryImportanceWithModel } from '../server/memory-importance-scorer';

test('scoreMemoryImportanceWithModel parses a strict JSON response and normalizes the assessment', async () => {
  const assessment = await scoreMemoryImportanceWithModel({
    config: normalizeAgentConfig(),
    date: '2026-04-01',
    tier: 'warm',
    sourceMarkdown: '- TODO 保留关键决策',
    invokeModel: async () =>
      JSON.stringify({
        importanceScore: 5,
        reason: 'Contains a durable project decision.',
        suggestedRetention: 'warm',
        promoteSignals: ['decision', 'project state'],
      }),
  });

  assert.deepEqual(assessment, {
    importanceScore: 5,
    reason: 'Contains a durable project decision.',
    suggestedRetention: 'warm',
    promoteSignals: ['decision', 'project state'],
    source: 'llm',
  });
});

test('scoreMemoryImportanceWithModel defensively parses fenced or noisy JSON and clamps values', async () => {
  const assessment = await scoreMemoryImportanceWithModel({
    config: normalizeAgentConfig(),
    date: '2026-04-01',
    tier: 'cold',
    sourceMarkdown: '- TODO archive this later',
    invokeModel: async () => `Here is the result:\n\`\`\`json\n${JSON.stringify({
      importanceScore: 9,
      reason: 'High signal despite the noisy wrapper.',
      retentionSuggestion: 'warm',
      promoteSignals: ['signal', 'signal', 'follow-up'],
    })}\n\`\`\``,
  });

  assert.equal(assessment.importanceScore, 5);
  assert.equal(assessment.suggestedRetention, 'warm');
  assert.deepEqual(assessment.promoteSignals, ['signal', 'follow-up']);
  assert.equal(assessment.source, 'llm');
});

test('scoreMemoryImportanceWithModel reuses the active provider and model selection for supported providers', async () => {
  const cases = [
    {
      providerId: 'openai',
      activeModel: 'gpt-4o',
      expectedProviderLabel: 'openai (openai)',
      expectedModel: 'gpt-4o',
    },
    {
      providerId: 'anthropic',
      activeModel: 'claude-3-7-sonnet-latest',
      expectedProviderLabel: 'anthropic (anthropic)',
      expectedModel: 'claude-3-7-sonnet-latest',
    },
    {
      providerId: 'deepseek',
      activeModel: 'deepseek-chat',
      expectedProviderLabel: 'deepseek (custom_openai)',
      expectedModel: 'deepseek-chat',
    },
  ] as const;

  for (const currentCase of cases) {
    let observedPrompt = '';
    await scoreMemoryImportanceWithModel({
      config: normalizeAgentConfig({
        activeProviderId: currentCase.providerId,
        activeModel: currentCase.activeModel,
      }),
      date: '2026-04-01',
      tier: 'warm',
      sourceMarkdown: '- TODO keep',
      invokeModel: async (prompt) => {
        observedPrompt = prompt;
        return JSON.stringify({
          importanceScore: 3,
          reason: 'Selected provider was routed into the prompt.',
          suggestedRetention: 'warm',
          promoteSignals: [],
        });
      },
    });

    assert.ok(observedPrompt.includes(`Selected provider: ${currentCase.expectedProviderLabel}`));
    assert.ok(observedPrompt.includes(`Selected model: ${currentCase.expectedModel}`));
  }
});
