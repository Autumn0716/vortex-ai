import type { Database } from './db-core';
import { mapRows } from './db-row-helpers';
import type { AuditLogCategory, AuditLogRecord } from './db-types';

function toAuditLogRecord(row: {
  id: string;
  category: AuditLogCategory;
  action: string;
  topic_id: string | null;
  topic_title: string | null;
  agent_id: string | null;
  message_id: string | null;
  target: string | null;
  status: 'success' | 'error';
  summary: string;
  details: string | null;
  metadata_json: string | null;
  duration_ms: number | null;
  created_at: string;
}): AuditLogRecord {
  let metadata: Record<string, unknown> | undefined;
  if (row.metadata_json) {
    try {
      const parsed = JSON.parse(row.metadata_json);
      metadata = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
    } catch {
      metadata = undefined;
    }
  }

  return {
    id: row.id,
    category: row.category,
    action: row.action,
    topicId: row.topic_id ?? undefined,
    topicTitle: row.topic_title ?? undefined,
    agentId: row.agent_id ?? undefined,
    messageId: row.message_id ?? undefined,
    target: row.target ?? undefined,
    status: row.status,
    summary: row.summary,
    details: row.details ?? undefined,
    metadata,
    durationMs:
      typeof row.duration_ms === 'number' && Number.isFinite(row.duration_ms) ? row.duration_ms : undefined,
    createdAt: row.created_at,
  };
}

export function insertAuditLogInDatabase(database: Database, input: Omit<AuditLogRecord, 'id'> & { id?: string }) {
  const createdAt = input.createdAt;
  const id = input.id ?? `audit_${createdAt}_${Math.random().toString(36).slice(2, 8)}`;
  database.run(
    `
      INSERT INTO audit_log (
        id,
        category,
        action,
        topic_id,
        topic_title,
        agent_id,
        message_id,
        target,
        status,
        summary,
        details,
        metadata_json,
        duration_ms,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      input.category,
      input.action,
      input.topicId ?? null,
      input.topicTitle ?? null,
      input.agentId ?? null,
      input.messageId ?? null,
      input.target ?? null,
      input.status,
      input.summary,
      input.details ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.durationMs ?? null,
      createdAt,
    ],
  );
}

export function listAuditLogsInDatabase(
  database: Database,
  options: {
    category?: AuditLogCategory;
    topicId?: string;
    limit?: number;
  } = {},
): AuditLogRecord[] {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (options.category) {
    conditions.push('category = ?');
    params.push(options.category);
  }
  if (options.topicId) {
    conditions.push('topic_id = ?');
    params.push(options.topicId);
  }

  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 120)));
  params.push(limit);

  return mapRows<{
    id: string;
    category: AuditLogCategory;
    action: string;
    topic_id: string | null;
    topic_title: string | null;
    agent_id: string | null;
    message_id: string | null;
    target: string | null;
    status: 'success' | 'error';
    summary: string;
    details: string | null;
    metadata_json: string | null;
    duration_ms: number | null;
    created_at: string;
  }>(
    database.exec(
      `
        SELECT
          id,
          category,
          action,
          topic_id,
          topic_title,
          agent_id,
          message_id,
          target,
          status,
          summary,
          details,
          metadata_json,
          duration_ms,
          created_at
        FROM audit_log
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY created_at DESC
        LIMIT ?
      `,
      params,
    ),
  ).map(toAuditLogRecord);
}
