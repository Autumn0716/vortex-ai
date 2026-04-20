import React, { useEffect, useState } from 'react';
import { listAuditLogs, type AuditLogRecord } from '../../lib/db';

type AuditFilter = 'all' | AuditLogRecord['category'];

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

function formatDuration(durationMs?: number) {
  if (!durationMs) {
    return '0ms';
  }
  if (durationMs >= 1000) {
    return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
  }
  return `${durationMs}ms`;
}

function escapeCsv(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadFile(filename: string, content: string, contentType: string) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportLogsAsCsv(logs: AuditLogRecord[]) {
  const lines = [
    ['created_at', 'category', 'action', 'status', 'topic_title', 'target', 'summary', 'details', 'duration_ms'],
    ...logs.map((entry) => [
      entry.createdAt,
      entry.category,
      entry.action,
      entry.status,
      entry.topicTitle ?? '',
      entry.target ?? '',
      entry.summary,
      entry.details ?? '',
      entry.durationMs ?? '',
    ]),
  ];
  downloadFile(
    `vortex-audit-${new Date().toISOString().slice(0, 10)}.csv`,
    lines.map((line) => line.map(escapeCsv).join(',')).join('\n'),
    'text/csv;charset=utf-8',
  );
}

function exportLogsAsJson(logs: AuditLogRecord[]) {
  downloadFile(
    `vortex-audit-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(logs, null, 2),
    'application/json;charset=utf-8',
  );
}

export function AuditLogPanel() {
  const [filter, setFilter] = useState<AuditFilter>('all');
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadLogs = async (nextFilter: AuditFilter) => {
    setLoading(true);
    setError('');
    try {
      const nextLogs = await listAuditLogs({
        category: nextFilter === 'all' ? undefined : nextFilter,
        limit: 120,
      });
      setLogs(nextLogs);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取审计日志失败。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLogs(filter);
  }, [filter]);

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35">Audit Viewer</div>
          <div className="mt-1 text-xs text-white/45">最近 {logs.length} 条行为审计记录，可按类别筛选并导出。</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void loadLogs(filter)}
            className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            刷新
          </button>
          <button
            onClick={() => exportLogsAsJson(logs)}
            disabled={!logs.length}
            className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            导出 JSON
          </button>
          <button
            onClick={() => exportLogsAsCsv(logs)}
            disabled={!logs.length}
            className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            导出 CSV
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {([
          ['all', '全部'],
          ['tool', '工具'],
          ['memory', '记忆'],
          ['config', '配置'],
        ] as Array<[AuditFilter, string]>).map(([value, label]) => {
          const active = filter === value;
          return (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`rounded-full border px-3 py-1 text-[11px] transition-colors ${
                active
                  ? 'border-sky-400/45 bg-sky-400/14 text-sky-100'
                  : 'border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.06] hover:text-white'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="mt-3 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-100/80">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white/45">
          正在读取审计日志…
        </div>
      ) : null}

      {!loading && !logs.length ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white/45">
          暂无审计记录。
        </div>
      ) : null}

      {!loading && logs.length ? (
        <div className="mt-3 space-y-2">
          {logs.map((entry) => {
            const changedKeys = Array.isArray(entry.metadata?.changedKeys)
              ? (entry.metadata?.changedKeys as string[])
              : [];
            return (
              <div
                key={entry.id}
                className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <div className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-white/50">
                    {formatTimestamp(entry.createdAt)}
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-white/58">
                    {entry.category}
                  </div>
                  <div
                    className={`rounded-full border px-2 py-1 text-[10px] ${
                      entry.status === 'error'
                        ? 'border-red-400/25 bg-red-400/10 text-red-100/80'
                        : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100/80'
                    }`}
                  >
                    {entry.status}
                  </div>
                  {entry.target ? (
                    <div className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-white/55">
                      {entry.target}
                    </div>
                  ) : null}
                  <div className="ml-auto text-[11px] text-white/42">{formatDuration(entry.durationMs)}</div>
                </div>

                <div className="mt-2 text-sm font-medium text-white/90">{entry.summary}</div>

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/45">
                  <div>action: {entry.action}</div>
                  {entry.topicTitle ? <div>topic: {entry.topicTitle}</div> : null}
                  {entry.agentId ? <div>agent: {entry.agentId}</div> : null}
                </div>

                {entry.details ? <div className="mt-2 text-xs leading-5 text-white/58">{entry.details}</div> : null}

                {changedKeys.length ? (
                  <div className="mt-2 text-[11px] text-white/42">
                    changed keys: {changedKeys.slice(0, 8).join(', ')}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
