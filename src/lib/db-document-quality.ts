import type { Database } from './db-core';
import { mapRows } from './db-row-helpers';
import type { DocumentQualityScoreRecord, KnowledgeDocumentRecord } from './db-types';

function nowIso() {
  return new Date().toISOString();
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function daysSince(input?: string) {
  if (!input) {
    return 365;
  }
  const timestamp = Date.parse(input);
  if (!Number.isFinite(timestamp)) {
    return 365;
  }
  return Math.max(0, (Date.now() - timestamp) / 86_400_000);
}

function countQualityIssues(content: string) {
  const markers = content.match(/\b(TODO|FIXME|TBD|待补|未完成|截断|truncated)\b/gi);
  const tooShort = content.trim().length > 0 && content.trim().length < 120 ? 1 : 0;
  return (markers?.length ?? 0) + tooShort;
}

function estimateFreshnessScore(updatedAt?: string) {
  const age = daysSince(updatedAt);
  if (age <= 7) {
    return 100;
  }
  if (age <= 30) {
    return 85;
  }
  if (age <= 90) {
    return 65;
  }
  if (age <= 180) {
    return 45;
  }
  return 25;
}

function estimateFeedbackScore(helpfulCount: number, notHelpfulCount: number) {
  const total = helpfulCount + notHelpfulCount;
  if (total === 0) {
    return 70;
  }
  return clampScore(100 * (helpfulCount / total));
}

function estimateCompletenessScore(content: string, issueCount: number) {
  const lengthBonus = Math.min(20, Math.max(0, content.trim().length - 120) / 40);
  return clampScore(80 + lengthBonus - issueCount * 18);
}

function estimateCitationScore(citationCount: number) {
  return clampScore(Math.min(100, citationCount * 15));
}

function chooseRecommendation(score: number, issueCount: number, notHelpfulCount: number) {
  if (score < 45) {
    return 'archive_or_rewrite';
  }
  if (issueCount > 0 || notHelpfulCount > 0) {
    return 'review';
  }
  return 'keep';
}

function readFeedbackCounts(database: Database, documentId: string) {
  const row = mapRows<{ helpful_count: number; not_helpful_count: number }>(
    database.exec(
      `
        SELECT
          SUM(CASE WHEN value = 'helpful' THEN 1 ELSE 0 END) AS helpful_count,
          SUM(CASE WHEN value = 'not_helpful' THEN 1 ELSE 0 END) AS not_helpful_count
        FROM knowledge_evidence_feedback
        WHERE document_id = ?
      `,
      [documentId],
    ),
  )[0];

  return {
    helpfulCount: Number(row?.helpful_count ?? 0),
    notHelpfulCount: Number(row?.not_helpful_count ?? 0),
  };
}

function readCitationCount(database: Database, documentId: string) {
  const rows = mapRows<{ results_json: string }>(
    database.exec('SELECT results_json FROM document_search_cache'),
  );
  let count = 0;
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.results_json) as Array<{ id?: string }>;
      if (Array.isArray(parsed) && parsed.some((entry) => entry?.id === documentId)) {
        count += 1;
      }
    } catch {
      // Ignore malformed cache entries; search cache already has its own recovery path.
    }
  }
  return count;
}

export function calculateDocumentQualityScore(
  document: Pick<KnowledgeDocumentRecord, 'id' | 'content' | 'updatedAt'>,
  input: { helpfulCount: number; notHelpfulCount: number; citationCount: number; now?: string },
): DocumentQualityScoreRecord {
  const issueCount = countQualityIssues(document.content);
  const freshnessScore = estimateFreshnessScore(document.updatedAt);
  const feedbackScore = estimateFeedbackScore(input.helpfulCount, input.notHelpfulCount);
  const completenessScore = estimateCompletenessScore(document.content, issueCount);
  const citationScore = estimateCitationScore(input.citationCount);
  const score = clampScore(
    freshnessScore * 0.25 + feedbackScore * 0.25 + completenessScore * 0.3 + citationScore * 0.2,
  );

  return {
    documentId: document.id,
    score,
    freshnessScore,
    feedbackScore,
    completenessScore,
    citationScore,
    citationCount: input.citationCount,
    helpfulCount: input.helpfulCount,
    notHelpfulCount: input.notHelpfulCount,
    issueCount,
    recommendation: chooseRecommendation(score, issueCount, input.notHelpfulCount),
    updatedAt: input.now ?? nowIso(),
  };
}

export function upsertDocumentQualityScore(database: Database, documentId: string) {
  const document = mapRows<{ id: string; content: string; updated_at: string | null }>(
    database.exec(
      `
        SELECT d.id, d.content, m.updated_at
        FROM documents d
        LEFT JOIN document_metadata m ON m.document_id = d.id
        WHERE d.id = ?
        LIMIT 1
      `,
      [documentId],
    ),
  )[0];
  if (!document) {
    database.run('DELETE FROM document_quality_score WHERE document_id = ?', [documentId]);
    return null;
  }

  const feedback = readFeedbackCounts(database, documentId);
  const score = calculateDocumentQualityScore(
    {
      id: document.id,
      content: document.content,
      updatedAt: document.updated_at ?? undefined,
    },
    {
      ...feedback,
      citationCount: readCitationCount(database, documentId),
    },
  );
  database.run(
    `
      INSERT INTO document_quality_score (
        document_id,
        score,
        freshness_score,
        feedback_score,
        completeness_score,
        citation_score,
        citation_count,
        helpful_count,
        not_helpful_count,
        issue_count,
        recommendation,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(document_id) DO UPDATE SET
        score = excluded.score,
        freshness_score = excluded.freshness_score,
        feedback_score = excluded.feedback_score,
        completeness_score = excluded.completeness_score,
        citation_score = excluded.citation_score,
        citation_count = excluded.citation_count,
        helpful_count = excluded.helpful_count,
        not_helpful_count = excluded.not_helpful_count,
        issue_count = excluded.issue_count,
        recommendation = excluded.recommendation,
        updated_at = excluded.updated_at
    `,
    [
      score.documentId,
      score.score,
      score.freshnessScore,
      score.feedbackScore,
      score.completenessScore,
      score.citationScore,
      score.citationCount,
      score.helpfulCount,
      score.notHelpfulCount,
      score.issueCount,
      score.recommendation,
      score.updatedAt,
    ],
  );
  return score;
}

export function refreshDocumentQualityScoresInDatabase(database: Database) {
  const rows = mapRows<{ id: string }>(database.exec('SELECT id FROM documents ORDER BY rowid ASC'));
  return rows
    .map((row) => upsertDocumentQualityScore(database, row.id))
    .filter((score): score is DocumentQualityScoreRecord => Boolean(score));
}

export function listDocumentQualityScoresInDatabase(database: Database) {
  refreshDocumentQualityScoresInDatabase(database);
  return mapRows<{
    document_id: string;
    title: string | null;
    source_type: string | null;
    score: number;
    freshness_score: number;
    feedback_score: number;
    completeness_score: number;
    citation_score: number;
    citation_count: number;
    helpful_count: number;
    not_helpful_count: number;
    issue_count: number;
    recommendation: DocumentQualityScoreRecord['recommendation'];
    updated_at: string;
  }>(
    database.exec(`
      SELECT
        q.document_id,
        d.title,
        m.source_type,
        q.score,
        q.freshness_score,
        q.feedback_score,
        q.completeness_score,
        q.citation_score,
        q.citation_count,
        q.helpful_count,
        q.not_helpful_count,
        q.issue_count,
        q.recommendation,
        q.updated_at
      FROM document_quality_score q
      LEFT JOIN documents d ON d.id = q.document_id
      LEFT JOIN document_metadata m ON m.document_id = q.document_id
      ORDER BY q.score ASC, q.updated_at DESC
    `),
  ).map((row) => ({
    documentId: row.document_id,
    title: row.title ?? row.document_id,
    sourceType: row.source_type ?? 'user_upload',
    score: row.score,
    freshnessScore: row.freshness_score,
    feedbackScore: row.feedback_score,
    completenessScore: row.completeness_score,
    citationScore: row.citation_score,
    citationCount: row.citation_count,
    helpfulCount: row.helpful_count,
    notHelpfulCount: row.not_helpful_count,
    issueCount: row.issue_count,
    recommendation: row.recommendation,
    updatedAt: row.updated_at,
  }));
}

export function readDocumentQualityScoreMap(database: Database) {
  try {
    return new Map(
      mapRows<{ document_id: string; score: number }>(
        database.exec('SELECT document_id, score FROM document_quality_score'),
      ).map((row) => [row.document_id, row.score]),
    );
  } catch {
    return new Map<string, number>();
  }
}
