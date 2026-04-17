import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  calculateDocumentQualityScore,
  listDocumentQualityScoresInDatabase,
  upsertDocumentQualityScore,
} from '../src/lib/db-document-quality';
import { Database } from '../src/lib/db-core';
import { createBaseSchema } from '../src/lib/db-schema';

function createMemoryDatabase() {
  const rows: unknown[][] = [];
  return {
    run(query: string, params: unknown[] = []) {
      rows.push([query, params]);
    },
    exec(query: string, params: unknown[] = []) {
      if (/FROM documents d\s+LEFT JOIN document_metadata m[\s\S]+WHERE d\.id = \?/i.test(query)) {
        return [
          {
            columns: ['id', 'content', 'updated_at'],
            values: [['doc_a', 'Stable content without open issues.', '2026-04-16T00:00:00.000Z']],
          },
        ];
      }
      if (/FROM knowledge_evidence_feedback/i.test(query)) {
        return [
          {
            columns: ['helpful_count', 'not_helpful_count'],
            values: [[2, 1]],
          },
        ];
      }
      if (/SELECT results_json FROM document_search_cache/i.test(query)) {
        return [
          {
            columns: ['results_json'],
            values: [[JSON.stringify([{ id: 'doc_a' }])], [JSON.stringify([{ id: 'doc_b' }])]],
          },
        ];
      }
      if (/SELECT id FROM documents/i.test(query)) {
        return [
          {
            columns: ['id'],
            values: [['doc_a']],
          },
        ];
      }
      if (/FROM document_quality_score q/i.test(query)) {
        return [
          {
            columns: [
              'document_id',
              'title',
              'source_type',
              'score',
              'freshness_score',
              'feedback_score',
              'completeness_score',
              'citation_score',
              'citation_count',
              'helpful_count',
              'not_helpful_count',
              'issue_count',
              'recommendation',
              'updated_at',
            ],
            values: [['doc_a', 'Doc A', 'workspace_doc', 82, 100, 67, 100, 15, 1, 2, 1, 0, 'keep', '2026-04-16']],
          },
        ];
      }
      return [];
    },
    rows,
  };
}

test('calculateDocumentQualityScore combines freshness feedback completeness and citations', () => {
  const score = calculateDocumentQualityScore(
    {
      id: 'doc_a',
      content: 'TODO: incomplete',
      updatedAt: '2026-04-16T00:00:00.000Z',
    },
    {
      helpfulCount: 1,
      notHelpfulCount: 3,
      citationCount: 0,
      now: '2026-04-17T00:00:00.000Z',
    },
  );

  assert.equal(score.documentId, 'doc_a');
  assert.equal(score.feedbackScore, 25);
  assert.equal(score.issueCount, 2);
  assert.equal(score.recommendation, 'archive_or_rewrite');
});

test('document quality table is part of the base schema', () => {
  const fake = createMemoryDatabase();
  createBaseSchema(fake as unknown as Database);
  assert.match(String(fake.rows[0]?.[0] ?? ''), /CREATE TABLE IF NOT EXISTS document_quality_score/);
});

test('upsertDocumentQualityScore writes deterministic quality rows', () => {
  const fake = createMemoryDatabase();
  const score = upsertDocumentQualityScore(fake as unknown as Database, 'doc_a');

  assert.ok(score);
  assert.equal(score?.documentId, 'doc_a');
  assert.equal(score?.helpfulCount, 2);
  assert.equal(score?.notHelpfulCount, 1);
  assert.equal(score?.citationCount, 1);
  assert.ok(fake.rows.some(([query]) => String(query).includes('INSERT INTO document_quality_score')));
});

test('listDocumentQualityScoresInDatabase returns worst documents first', () => {
  const fake = createMemoryDatabase();
  const scores = listDocumentQualityScoresInDatabase(fake as unknown as Database);

  assert.equal(scores[0]?.documentId, 'doc_a');
  assert.equal(scores[0]?.title, 'Doc A');
  assert.equal(scores[0]?.sourceType, 'workspace_doc');
});
