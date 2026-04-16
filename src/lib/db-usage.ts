import type { Database } from './db-core';
import { mapRows } from './db-row-helpers';
import type {
  TokenUsageAggregate,
  TokenUsageBreakdownEntry,
  TokenUsageDailyPoint,
  TokenUsageRecord,
  TokenUsageSummary,
} from './db-types';

function emptyAggregate(): TokenUsageAggregate {
  return {
    callCount: 0,
    pricedCallCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
  };
}

function addUsage(target: TokenUsageAggregate, usage: TokenUsageRecord) {
  target.callCount += 1;
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.totalTokens += usage.totalTokens;
  if (typeof usage.estimatedCost === 'number' && Number.isFinite(usage.estimatedCost)) {
    target.pricedCallCount += 1;
    target.estimatedCost += usage.estimatedCost;
  }
}

export function accumulateTokenUsage(records: TokenUsageRecord[]): TokenUsageAggregate {
  const aggregate = emptyAggregate();
  records.forEach((record) => {
    addUsage(aggregate, record);
  });
  return aggregate;
}

function toTokenUsageRecord(row: {
  id: string;
  topic_id: string;
  topic_title: string;
  agent_id: string;
  provider_id: string | null;
  model: string;
  session_mode: 'agent' | 'quick';
  message_id: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost: number | null;
  usage_source: 'provider' | 'estimate';
  stream_duration_ms: number | null;
  reasoning_duration_ms: number | null;
  created_at: string;
}): TokenUsageRecord {
  return {
    id: row.id,
    topicId: row.topic_id,
    topicTitle: row.topic_title,
    agentId: row.agent_id,
    providerId: row.provider_id ?? undefined,
    model: row.model,
    sessionMode: row.session_mode === 'quick' ? 'quick' : 'agent',
    messageId: row.message_id,
    inputTokens: Number(row.input_tokens) || 0,
    outputTokens: Number(row.output_tokens) || 0,
    totalTokens: Number(row.total_tokens) || 0,
    estimatedCost:
      typeof row.estimated_cost === 'number' && Number.isFinite(row.estimated_cost)
        ? row.estimated_cost
        : undefined,
    usageSource: row.usage_source === 'estimate' ? 'estimate' : 'provider',
    streamDurationMs:
      typeof row.stream_duration_ms === 'number' && Number.isFinite(row.stream_duration_ms)
        ? row.stream_duration_ms
        : undefined,
    reasoningDurationMs:
      typeof row.reasoning_duration_ms === 'number' && Number.isFinite(row.reasoning_duration_ms)
        ? row.reasoning_duration_ms
        : undefined,
    createdAt: row.created_at,
  };
}

function startOfLocalDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfLocalWeek(date: Date) {
  const next = startOfLocalDay(date);
  const weekday = next.getDay();
  const diff = weekday === 0 ? 6 : weekday - 1;
  next.setDate(next.getDate() - diff);
  return next;
}

function startOfLocalMonth(date: Date) {
  const next = startOfLocalDay(date);
  next.setDate(1);
  return next;
}

function formatLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildDailySeries(rows: TokenUsageRecord[], startDate: Date, dayCount: number): TokenUsageDailyPoint[] {
  const buckets = new Map<string, TokenUsageDailyPoint>();

  for (let index = 0; index < dayCount; index += 1) {
    const pointDate = new Date(startDate);
    pointDate.setDate(startDate.getDate() + index);
    const key = formatLocalDateKey(pointDate);
    buckets.set(key, {
      date: key,
      ...emptyAggregate(),
    });
  }

  rows.forEach((row) => {
    const key = formatLocalDateKey(new Date(row.createdAt));
    const bucket = buckets.get(key);
    if (!bucket) {
      return;
    }
    addUsage(bucket, row);
  });

  return [...buckets.values()];
}

function buildBreakdown(
  rows: TokenUsageRecord[],
  keySelector: (row: TokenUsageRecord) => string,
  labelSelector: (row: TokenUsageRecord) => string,
  limit = 5,
): TokenUsageBreakdownEntry[] {
  const groups = new Map<string, TokenUsageBreakdownEntry>();

  rows.forEach((row) => {
    const key = keySelector(row);
    const existing =
      groups.get(key) ??
      {
        key,
        label: labelSelector(row),
        ...emptyAggregate(),
      };
    addUsage(existing, row);
    groups.set(key, existing);
  });

  return [...groups.values()]
    .sort((left, right) => right.totalTokens - left.totalTokens || right.callCount - left.callCount)
    .slice(0, limit);
}

export function upsertTokenUsageInDatabase(
  database: Database,
  input: Omit<TokenUsageRecord, 'id'> & { id?: string },
) {
  const id = input.id ?? `usage_${input.messageId}`;
  database.run(
    `
      INSERT INTO token_usage (
        id,
        topic_id,
        topic_title,
        agent_id,
        provider_id,
        model,
        session_mode,
        message_id,
        input_tokens,
        output_tokens,
        total_tokens,
        estimated_cost,
        usage_source,
        stream_duration_ms,
        reasoning_duration_ms,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id) DO UPDATE SET
        topic_id = excluded.topic_id,
        topic_title = excluded.topic_title,
        agent_id = excluded.agent_id,
        provider_id = excluded.provider_id,
        model = excluded.model,
        session_mode = excluded.session_mode,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        total_tokens = excluded.total_tokens,
        estimated_cost = excluded.estimated_cost,
        usage_source = excluded.usage_source,
        stream_duration_ms = excluded.stream_duration_ms,
        reasoning_duration_ms = excluded.reasoning_duration_ms,
        created_at = excluded.created_at
    `,
    [
      id,
      input.topicId,
      input.topicTitle,
      input.agentId,
      input.providerId ?? null,
      input.model,
      input.sessionMode,
      input.messageId,
      input.inputTokens,
      input.outputTokens,
      input.totalTokens,
      input.estimatedCost ?? null,
      input.usageSource,
      input.streamDurationMs ?? null,
      input.reasoningDurationMs ?? null,
      input.createdAt,
    ],
  );
}

export function listTokenUsageForTopicInDatabase(database: Database, topicId: string): TokenUsageRecord[] {
  return mapRows<{
    id: string;
    topic_id: string;
    topic_title: string;
    agent_id: string;
    provider_id: string | null;
    model: string;
    session_mode: 'agent' | 'quick';
    message_id: string;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    estimated_cost: number | null;
    usage_source: 'provider' | 'estimate';
    stream_duration_ms: number | null;
    reasoning_duration_ms: number | null;
    created_at: string;
  }>(
    database.exec(
      `
        SELECT
          id,
          topic_id,
          topic_title,
          agent_id,
          provider_id,
          model,
          session_mode,
          message_id,
          input_tokens,
          output_tokens,
          total_tokens,
          estimated_cost,
          usage_source,
          stream_duration_ms,
          reasoning_duration_ms,
          created_at
        FROM token_usage
        WHERE topic_id = ?
        ORDER BY created_at ASC
      `,
      [topicId],
    ),
  ).map(toTokenUsageRecord);
}

export function getTokenUsageSummaryInDatabase(
  database: Database,
  options?: {
    now?: string;
    dailyWindowDays?: number;
  },
): TokenUsageSummary {
  const now = options?.now ? new Date(options.now) : new Date();
  const dailyWindowDays = Math.max(1, options?.dailyWindowDays ?? 14);
  const todayStart = startOfLocalDay(now);
  const weekStart = startOfLocalWeek(now);
  const monthStart = startOfLocalMonth(now);
  const dailyStart = new Date(todayStart);
  dailyStart.setDate(todayStart.getDate() - (dailyWindowDays - 1));
  const earliestStart = new Date(
    Math.min(dailyStart.getTime(), weekStart.getTime(), monthStart.getTime()),
  ).toISOString();

  const rows = mapRows<{
    id: string;
    topic_id: string;
    topic_title: string;
    agent_id: string;
    provider_id: string | null;
    model: string;
    session_mode: 'agent' | 'quick';
    message_id: string;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    estimated_cost: number | null;
    usage_source: 'provider' | 'estimate';
    stream_duration_ms: number | null;
    reasoning_duration_ms: number | null;
    created_at: string;
  }>(
    database.exec(
      `
        SELECT
          id,
          topic_id,
          topic_title,
          agent_id,
          provider_id,
          model,
          session_mode,
          message_id,
          input_tokens,
          output_tokens,
          total_tokens,
          estimated_cost,
          usage_source,
          stream_duration_ms,
          reasoning_duration_ms,
          created_at
        FROM token_usage
        WHERE created_at >= ?
        ORDER BY created_at ASC
      `,
      [earliestStart],
    ),
  ).map(toTokenUsageRecord);

  const today = emptyAggregate();
  const week = emptyAggregate();
  const month = emptyAggregate();

  rows.forEach((row) => {
    const createdAt = row.createdAt;
    if (createdAt >= todayStart.toISOString()) {
      addUsage(today, row);
    }
    if (createdAt >= weekStart.toISOString()) {
      addUsage(week, row);
    }
    if (createdAt >= monthStart.toISOString()) {
      addUsage(month, row);
    }
  });

  const monthRows = rows.filter((row) => row.createdAt >= monthStart.toISOString());

  return {
    today,
    week,
    month,
    daily: buildDailySeries(rows, dailyStart, dailyWindowDays),
    byModel: buildBreakdown(monthRows, (row) => row.model, (row) => row.model),
    byTopic: buildBreakdown(monthRows, (row) => row.topicId, (row) => row.topicTitle),
  };
}
