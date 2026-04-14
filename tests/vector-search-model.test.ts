import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cosineSimilarity,
  hybridScoreDocuments,
  normalizeLexicalScore,
  rerankHybridDocuments,
  summarizeEmbeddingVector,
} from '../src/lib/vector-search-model';

test('cosineSimilarity returns 1 for identical vectors', () => {
  assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
});

test('cosineSimilarity returns 0 for mismatched vector dimensions', () => {
  assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0);
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

test('hybridScoreDocuments clamps missing or negative vector scores safely', () => {
  const ranked = hybridScoreDocuments([
    {
      id: 'lexical_safe',
      title: 'Lexical Safe',
      content: 'lexical candidate',
      lexicalScore: 0.1,
      vectorScore: -4,
    },
    {
      id: 'vector_missing',
      title: 'Vector Missing',
      content: 'candidate without vector score',
      lexicalScore: 0.8,
    },
  ]);

  assert.equal(ranked[0]?.id, 'lexical_safe');
  assert.ok((ranked[0]?.hybridScore ?? 0) > (ranked[1]?.hybridScore ?? 0));
});

test('summarizeEmbeddingVector reports dimensions and preview safely', () => {
  assert.equal(summarizeEmbeddingVector([0.1, 0.2, 0.3]), 'dims=3 [0.1000, 0.2000, 0.3000]');
});

test('rerankHybridDocuments boosts candidates with stronger query coverage', () => {
  const hybrid = hybridScoreDocuments([
    {
      id: 'broad_match',
      title: 'General Planning Notes',
      content: 'planning rollout checklist overview',
      lexicalScore: 0.2,
      vectorScore: 0.92,
    },
    {
      id: 'focused_match',
      title: 'Branch Handoff Summary',
      content: 'branch handoff summary to parent topic with rollout steps',
      lexicalScore: 0.45,
      vectorScore: 0.8,
    },
  ]);

  const reranked = rerankHybridDocuments(hybrid, 'branch handoff summary');

  assert.equal(reranked[0]?.id, 'focused_match');
});
