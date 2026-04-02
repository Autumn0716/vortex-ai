import test from 'node:test';
import assert from 'node:assert/strict';
import { formatKnowledgeBaseToolPayload } from '../src/lib/agent/tools';
import { buildGroundedSystemPrompt } from '../src/lib/agent/runtime';
import type { KnowledgeDocumentSearchResult } from '../src/lib/db';

test('formatKnowledgeBaseToolPayload returns evidence summary and stable result metadata', () => {
  const payload = formatKnowledgeBaseToolPayload([
    {
      id: 'doc_high',
      title: 'Branch Handoff Guide',
      content: 'Focused branch handoff excerpt',
      sourceType: 'workspace_doc',
      sourceUri: 'skills/branch/SKILL.md',
      tags: ['skill_doc'],
      supportScore: 0.92,
      supportLabel: 'high',
      matchedTerms: ['branch', 'handoff'],
      graphHints: ['branch handoff'],
      graphExpansionHints: ['parent topic id'],
      retrievalStage: 'hybrid',
    } satisfies KnowledgeDocumentSearchResult,
    {
      id: 'doc_low',
      title: 'Generic Summary Notes',
      content: 'Loose notes',
      sourceType: 'workspace_doc',
      tags: [],
      supportScore: 0.28,
      supportLabel: 'low',
      matchedTerms: ['summary'],
      graphHints: [],
      graphExpansionHints: [],
      retrievalStage: 'corrective',
    } satisfies KnowledgeDocumentSearchResult,
  ]);

  assert.equal(payload.evidence.totalResults, 2);
  assert.equal(payload.evidence.strongestSupport, 'high');
  assert.equal(payload.evidence.recommendation, 'answer_with_citations');
  assert.equal(payload.results[0]?.support.label, 'high');
  assert.equal(payload.results[0]?.retrievalStage, 'hybrid');
  assert.deepEqual(payload.results[0]?.graph.expansionHints, ['parent topic id']);
});

test('buildGroundedSystemPrompt appends compact evidence guidance when tools are enabled', () => {
  const prompt = buildGroundedSystemPrompt('You are a focused engineering agent.', {
    enableTools: true,
  });

  assert.match(prompt, /focused engineering agent/i);
  assert.match(prompt, /medium\/high support/i);
  assert.match(prompt, /low\/unknown support/i);
});

test('buildGroundedSystemPrompt leaves the base prompt untouched when tools are disabled', () => {
  const prompt = buildGroundedSystemPrompt('You are a focused engineering agent.', {
    enableTools: false,
  });

  assert.equal(prompt, 'You are a focused engineering agent.');
});
