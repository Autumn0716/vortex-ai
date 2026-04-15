import test from 'node:test';
import assert from 'node:assert/strict';
import initSqlite from '@sqlite.org/sqlite-wasm';
import {
  Database,
  upsertKnowledgeEvidenceFeedbackInDatabase,
  type StoredToolRun,
} from '../src/lib/db';
import { parseKnowledgeEvidenceToolResult } from '../src/lib/knowledge-evidence-feedback';

async function createFeedbackDatabase() {
  const sqlite3 = await initSqlite();
  const inner = new sqlite3.oo1.DB(':memory:');
  const database = new Database(sqlite3, inner);

  database.run(`
    CREATE TABLE knowledge_evidence_feedback (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      value TEXT NOT NULL,
      source_type TEXT,
      support_label TEXT,
      matched_terms_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(message_id, document_id)
    );
  `);

  return database;
}

test('parseKnowledgeEvidenceToolResult reads structured RAG evidence from tool output', () => {
  const tool: StoredToolRun = {
    name: 'search_knowledge_base',
    status: 'completed',
    result: JSON.stringify({
      evidence: {
        totalResults: 1,
        strongestSupport: 'high',
        recommendation: 'answer_with_citations',
      },
      results: [
        {
          id: 'doc_branch',
          title: 'Branch Handoff Guide',
          sourceType: 'workspace_doc',
          sourceUri: 'docs/branch.md',
          retrievalStage: 'hybrid',
          support: {
            label: 'high',
            score: 0.92,
            matchedTerms: ['branch', 'handoff'],
          },
        },
      ],
    }),
  };

  const panel = parseKnowledgeEvidenceToolResult(tool);

  assert.equal(panel?.totalResults, 1);
  assert.equal(panel?.strongestSupport, 'high');
  assert.equal(panel?.results[0]?.sourceType, 'workspace_doc');
  assert.equal(panel?.results[0]?.supportLabel, 'high');
  assert.deepEqual(panel?.results[0]?.matchedTerms, ['branch', 'handoff']);
});

test('upsertKnowledgeEvidenceFeedbackInDatabase stores one feedback value per message document pair', async () => {
  const database = await createFeedbackDatabase();

  try {
    upsertKnowledgeEvidenceFeedbackInDatabase(database, {
      messageId: 'message_1',
      documentId: 'doc_branch',
      value: 'helpful',
      sourceType: 'workspace_doc',
      supportLabel: 'high',
      matchedTerms: ['branch'],
    });
    upsertKnowledgeEvidenceFeedbackInDatabase(database, {
      messageId: 'message_1',
      documentId: 'doc_branch',
      value: 'not_helpful',
      sourceType: 'workspace_doc',
      supportLabel: 'low',
      matchedTerms: ['handoff'],
    });

    const rows = database.exec(`
      SELECT message_id, document_id, value, source_type, support_label, matched_terms_json
      FROM knowledge_evidence_feedback
    `)[0]?.values ?? [];

    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], [
      'message_1',
      'doc_branch',
      'not_helpful',
      'workspace_doc',
      'low',
      '["handoff"]',
    ]);
  } finally {
    database.close();
  }
});
