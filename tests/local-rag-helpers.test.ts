import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSemanticCacheKey,
  chunkDocumentContent,
  decomposeTaskQuery,
  planCorrectiveKnowledgeQueries,
} from '../src/lib/local-rag-helpers';

test('chunkDocumentContent splits long content into overlapping chunks', () => {
  const chunks = chunkDocumentContent('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu', {
    chunkSize: 20,
    overlap: 5,
  });

  assert.equal(chunks.length, 4);
  assert.equal(chunks[0]?.text, 'alpha beta gamma');
  assert.equal(chunks[1]?.text, 'gamma delta epsilon');
});

test('decomposeTaskQuery splits multi-step intent into focused subtasks', () => {
  const subtasks = decomposeTaskQuery('先查询日志，再发送邮件，然后整理总结');
  assert.deepEqual(subtasks, ['查询日志', '发送邮件', '整理总结']);
});

test('buildSemanticCacheKey normalizes punctuation and casing', () => {
  assert.equal(
    buildSemanticCacheKey('  Build   me a RAG  Plan!! '),
    'build me a rag plan',
  );
});

test('planCorrectiveKnowledgeQueries returns no follow-up queries when support is already sufficient', () => {
  const plan = planCorrectiveKnowledgeQueries(
    'branch handoff summary',
    [
      { supportLabel: 'high', matchedTerms: ['branch', 'handoff', 'summary'] },
      { supportLabel: 'medium', matchedTerms: ['branch', 'summary'] },
      { supportLabel: 'medium', matchedTerms: ['handoff'] },
    ],
    { maxResults: 3 },
  );

  assert.equal(plan.reason, 'none');
  assert.deepEqual(plan.queries, []);
});

test('planCorrectiveKnowledgeQueries expands sparse results from graph and matched-term hints', () => {
  const plan = planCorrectiveKnowledgeQueries(
    'return branch findings',
    [
      {
        supportLabel: 'low',
        matchedTerms: ['branch'],
        graphHints: ['parent topic id'],
        graphExpansionHints: ['review audit record'],
      },
    ],
    { maxQueries: 4 },
  );

  assert.equal(plan.reason, 'sparse');
  assert.ok(plan.queries.length > 0);
  assert.ok(plan.queries.length <= 4);
  assert.ok(plan.queries.includes('return branch findings'));
  assert.ok(plan.queries.some((query) => query.includes('branch subtask child')));
});

test('planCorrectiveKnowledgeQueries marks low-support retrievals distinctly from sparse ones', () => {
  const plan = planCorrectiveKnowledgeQueries(
    'workflow reviewer branch',
    [
      { supportLabel: 'low', matchedTerms: ['workflow'] },
      { supportLabel: 'low', matchedTerms: ['reviewer'] },
      { supportLabel: 'low', matchedTerms: ['branch'], graphHints: ['review ready'] },
    ],
    { maxResults: 5, maxQueries: 3 },
  );

  assert.equal(plan.reason, 'low_support');
  assert.ok(plan.queries.length > 0);
  assert.ok(plan.queries.length <= 3);
});
