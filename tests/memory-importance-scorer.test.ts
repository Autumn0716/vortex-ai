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
        dimensionScores: {
          compression: 5,
          timeliness: 4,
          connectivity: 5,
          conflictResolution: 5,
          abstraction: 5,
          goldenLabel: 5,
          transferability: 5,
        },
        reason: 'Contains a durable project decision.',
        suggestedRetention: 'warm',
        promoteSignals: ['decision', 'project state'],
        shouldPromote: true,
        promotionCategory: 'workflow_improvements',
        promotionEntry: 'Record durable project decisions in nightly memory.',
        validityHint: 'stable',
        conflictStatus: 'latest_consensus',
        knowledgeLinks: ['nightly archive', 'project decisions'],
        abstractionLevel: 'principle',
        transferability: 'high',
        goldenLabel: 'validated',
      }),
  });

  assert.deepEqual(assessment, {
    importanceScore: 5,
    promotionScore: 4.87,
    dimensionScores: {
      compression: 5,
      timeliness: 4,
      connectivity: 5,
      conflictResolution: 5,
      abstraction: 5,
      goldenLabel: 5,
      transferability: 5,
    },
    reason: 'Contains a durable project decision.',
    suggestedRetention: 'warm',
    promoteSignals: ['decision', 'project state'],
    promotionDecision: {
      shouldPromote: true,
      category: 'workflow_improvements',
      entry: 'Record durable project decisions in nightly memory.',
    },
    validityHint: 'stable',
    conflictStatus: 'latest_consensus',
    knowledgeLinks: ['nightly archive', 'project decisions'],
    abstractionLevel: 'principle',
    transferability: 'high',
    goldenLabel: 'validated',
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
      dimensionScores: {
        compression: 4,
        timeliness: 3,
        connectivity: 3,
        conflictResolution: 3,
        abstraction: 3,
        goldenLabel: 2,
        transferability: 3,
      },
      reason: 'High signal despite the noisy wrapper.',
      retentionSuggestion: 'warm',
      promoteSignals: ['signal', 'signal', 'follow-up'],
    })}\n\`\`\``,
  });

  assert.equal(assessment.importanceScore, 5);
  assert.equal(typeof assessment.promotionScore, 'number');
  assert.equal(assessment.suggestedRetention, 'warm');
  assert.deepEqual(assessment.promoteSignals, ['signal', 'follow-up']);
  assert.equal(assessment.promotionDecision.entry, 'TODO archive this later');
  assert.equal(assessment.transferability, 'medium');
  assert.equal(assessment.source, 'llm');
});

test('scoreMemoryImportanceWithModel exposes the underlying parse error for invalid JSON', async () => {
  await assert.rejects(
    () =>
      scoreMemoryImportanceWithModel({
        config: normalizeAgentConfig(),
        date: '2026-04-01',
        tier: 'cold',
        sourceMarkdown: '- malformed scorer output',
        invokeModel: async () => '```json\n{"importanceScore": \n```',
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Memory scorer returned invalid JSON/);
      assert.ok(error.cause instanceof SyntaxError);
      return true;
    },
  );
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
          dimensionScores: {
            compression: 3,
            timeliness: 3,
            connectivity: 3,
            conflictResolution: 3,
            abstraction: 2,
            goldenLabel: 1,
            transferability: 2,
          },
          reason: 'Selected provider was routed into the prompt.',
          suggestedRetention: 'warm',
          promoteSignals: [],
          shouldPromote: false,
          promotionCategory: 'durable_facts',
          promotionEntry: 'Current provider selection matters for nightly scoring.',
          validityHint: 'stable',
          conflictStatus: 'stable',
          knowledgeLinks: [],
          abstractionLevel: 'concrete',
          transferability: 'low',
          goldenLabel: '',
        });
      },
    });

    assert.ok(observedPrompt.includes(`Selected provider: ${currentCase.expectedProviderLabel}`));
    assert.ok(observedPrompt.includes(`Selected model: ${currentCase.expectedModel}`));
  }
});
