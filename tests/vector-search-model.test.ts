import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cosineSimilarity,
  hybridScoreDocuments,
  normalizeLexicalScore,
  summarizeEmbeddingVector,
} from '../src/lib/vector-search-model';

test('cosineSimilarity returns 1 for identical vectors', () => {
  assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
});

test('normalizeLexicalScore converts lower bm25 scores into higher relevance', () => {
  assert.ok(normalizeLexicalScore(0.2) > normalizeLexicalScore(2));
});

test('hybridScoreDocuments blends lexical and vector signals', () => {
  const ranked = hybridScoreDocuments([
    {
      id: 'lexical_top',
      title: 'Lexical Top',
      content: 'BM25 first',
      lexicalScore: 0.1,
      vectorScore: 0.2,
    },
    {
      id: 'balanced_top',
      title: 'Balanced Top',
      content: 'Hybrid first',
      lexicalScore: 0.5,
      vectorScore: 0.95,
    },
  ]);

  assert.equal(ranked[0]?.id, 'balanced_top');
});

test('summarizeEmbeddingVector reports dimensions and preview safely', () => {
  assert.equal(summarizeEmbeddingVector([0.1, 0.2, 0.3]), 'dims=3 [0.1000, 0.2000, 0.3000]');
});
