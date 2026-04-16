import React, { useEffect, useMemo, useState } from 'react';
import { listAuditLogs, type AuditLogRecord } from '../../lib/db';
import type { AgentMemoryDocument } from '../../lib/agent-workspace';

type TimelineFilter = 'all' | 'audit' | 'index';

interface TimelineEntry {
  id: string;
  source: 'audit' | 'index';
  timestamp: string;
  title: string;
  subtitle: string;
  detail: string;
  eventLabel: string;
  tone: 'neutral' | 'success' | 'warning';
  metadata?: Record<string, unknown>;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function resolveLayerLabel(document: AgentMemoryDocument) {
  if (document.sourceType === 'warm_summary') {
    return '温层';
  }
  if (document.sourceType === 'cold_summary') {
    return '冷层';
  }
  if (document.memoryScope === 'daily' || document.memoryScope === 'session') {
    return '热层';
  }
  return '长期';
}

function resolveAuditEventLabel(entry: AuditLogRecord) {
  if (entry.action.includes('lifecycle')) {
    return '生命周期同步';
  }
  if (entry.action.includes('deleted')) {
    return '删除';
  }
  if (entry.action.includes('created')) {
    return '创建';
  }
  if (entry.action.includes('saved') || entry.action.includes('updated')) {
    return '保存';
  }
  if (entry.action.includes('restore')) {
    return '恢复';
  }
  return '变更';
}

function resolveIndexEventLabel(document: AgentMemoryDocument) {
  if (document.sourceType === 'correction') {
    return '纠错规则';
  }
  if (document.sourceType === 'reflection') {
    return '反思记录';
  }
  return resolveLayerLabel(document);
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildSearchText(entry: TimelineEntry) {
  return [
    entry.title,
    entry.subtitle,
    entry.detail,
    entry.eventLabel,
    entry.timestamp,
    entry.metadata ? JSON.stringify(entry.metadata) : '',
  ]
    .join('\n')
    .toLowerCase();
}

function buildMetadataRows(metadata?: Record<string, unknown>) {
  if (!metadata) {
    return [];
  }
  return Object.entries(metadata)
    .map(([key, value]) => [key, formatMetadataValue(value)] as const)
    .filter(([, value]) => value.trim())
    .slice(0, 8);
}

function buildAuditEntry(entry: AuditLogRecord): TimelineEntry {
  return {
    id: entry.id,
    source: 'audit',
    timestamp: entry.createdAt,
    title: entry.summary,
    subtitle: `${entry.action} · ${entry.target ?? 'memory'}`,
    detail: entry.details ?? (entry.topicTitle ? `topic: ${entry.topicTitle}` : entry.agentId ? `agent: ${entry.agentId}` : ''),
    eventLabel: resolveAuditEventLabel(entry),
    tone: entry.status === 'error' ? 'warning' : 'success',
    metadata: entry.metadata,
  };
}

function buildIndexEntry(document: AgentMemoryDocument): TimelineEntry {
  return {
    id: document.id,
    source: 'index',
    timestamp: document.updatedAt,
    title: document.title,
    subtitle: `${resolveLayerLabel(document)} · ${document.sourceType}`,
    detail: document.content,
    eventLabel: resolveIndexEventLabel(document),
    tone: 'neutral',
    metadata: {
      id: document.id,
      scope: document.memoryScope,
      sourceType: document.sourceType,
      eventDate: document.eventDate,
      importance: document.importanceScore,
    },
  };
}

export function MemoryTimelinePanel({
  agentId,
  agentName,
  documents,
}: {
  agentId?: string;
  agentName?: string;
  documents: AgentMemoryDocument[];
}) {
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const [query, setQuery] = useState('');
  const [expandedEntryIds, setExpandedEntryIds] = useState<Set<string>>(() => new Set());
  const [auditEntries, setAuditEntries] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const logs = await listAuditLogs({ category: 'memory', limit: 120 });
        if (!cancelled) {
          setAuditEntries(logs);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '读取记忆时间线失败。');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const allTimelineEntries = useMemo(() => {
    const filteredAuditEntries = auditEntries.filter((entry) => (agentId ? entry.agentId === agentId : true));
    return [
      ...filteredAuditEntries.map(buildAuditEntry),
      ...documents.map(buildIndexEntry),
    ].sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
  }, [agentId, auditEntries, documents]);

  const timeline = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const entries =
      normalizedQuery.length > 0
        ? allTimelineEntries.filter((entry) => buildSearchText(entry).includes(normalizedQuery))
        : allTimelineEntries;

    if (filter === 'audit') {
      return entries.filter((entry) => entry.source === 'audit');
    }
    if (filter === 'index') {
      return entries.filter((entry) => entry.source === 'index');
    }
    return entries;
  }, [allTimelineEntries, filter, query]);

  const toggleExpanded = (entryKey: string) => {
    setExpandedEntryIds((previous) => {
      const next = new Set(previous);
      if (next.has(entryKey)) {
        next.delete(entryKey);
      } else {
        next.add(entryKey);
      }
      return next;
    });
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35">Memory Timeline</div>
          <div className="mt-1 text-xs text-white/45">
            {agentName ? `${agentName} 的` : '当前 agent 的'}记忆演变轨迹，按时间逆序拼接索引快照与记忆审计。
          </div>
        </div>
        <div className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/55">
          {timeline.length} / {allTimelineEntries.length} 条记录
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {([
          ['all', '全部'],
          ['audit', '变更'],
          ['index', '快照'],
        ] as Array<[TimelineFilter, string]>).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`rounded-full border px-3 py-1 text-[11px] transition-colors ${
              filter === value
                ? 'border-emerald-400/35 bg-emerald-400/12 text-emerald-100'
                : 'border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.06] hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索标题、路径、层级、metadata..."
          className="min-w-[220px] flex-1 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] text-white/80 outline-none transition-colors placeholder:text-white/30 focus:border-emerald-400/40"
        />
      </div>

      {error ? (
        <div className="mt-3 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-100/80">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white/45">
          正在读取时间线…
        </div>
      ) : null}

      {!loading && !timeline.length ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white/45">
          {query.trim() ? '没有匹配当前搜索条件的记忆轨迹。' : '当前还没有可展示的记忆轨迹。'}
        </div>
      ) : null}

      {!loading && timeline.length ? (
        <div className="mt-4 space-y-3">
          {timeline.slice(0, 30).map((entry) => {
            const entryKey = `${entry.source}:${entry.id}`;
            const metadataRows = buildMetadataRows(entry.metadata);
            const expanded = expandedEntryIds.has(entryKey);
            return (
            <div key={entryKey} className="relative pl-5">
              <div className="absolute left-[7px] top-0 h-full w-px bg-white/10" />
              <div
                className={`absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full border ${
                  entry.tone === 'success'
                    ? 'border-emerald-300/40 bg-emerald-400/25'
                    : entry.tone === 'warning'
                      ? 'border-amber-300/40 bg-amber-400/25'
                      : 'border-white/20 bg-white/10'
                }`}
              />
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-white/50">
                    {formatTimestamp(entry.timestamp)}
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-white/55">
                    {entry.source === 'audit' ? '变更' : '快照'}
                  </div>
                  <div className="rounded-full border border-emerald-300/15 bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-100/70">
                    {entry.eventLabel}
                  </div>
                </div>
                <div className="mt-2 text-sm font-medium text-white/90">{entry.title}</div>
                <div className="mt-1 text-[11px] text-white/45">{entry.subtitle}</div>
                <div className={`${expanded ? '' : 'line-clamp-2'} mt-2 text-xs leading-5 text-white/58`}>
                  {entry.detail || '无详细内容'}
                </div>
                {metadataRows.length ? (
                  <button
                    onClick={() => toggleExpanded(entryKey)}
                    className="mt-3 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white"
                  >
                    {expanded ? '收起细节' : `展开 ${metadataRows.length} 项 metadata`}
                  </button>
                ) : null}
                {expanded && metadataRows.length ? (
                  <div className="mt-3 grid gap-2 rounded-2xl border border-white/8 bg-black/20 p-3">
                    {metadataRows.map(([key, value]) => (
                      <div key={key} className="grid gap-1 text-[11px] md:grid-cols-[120px_minmax(0,1fr)]">
                        <div className="uppercase tracking-[0.12em] text-white/35">{key}</div>
                        <div className="break-words text-white/62">{value}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          );
          })}
          {timeline.length > 30 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-center text-xs text-white/45">
              仅显示前 30 条，使用搜索缩小范围。
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
