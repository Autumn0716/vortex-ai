import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSemanticCacheKey,
  chunkDocumentContent,
  decomposeTaskQuery,
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
