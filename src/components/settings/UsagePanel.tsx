import React from 'react';
import type { TokenUsageSummary } from '../../lib/db';

function formatCost(value: number, pricedCallCount: number) {
  if (!pricedCallCount || value <= 0) {
    return '未识别';
  }
  if (value >= 1) {
    return `¥${value.toFixed(2)}`;
  }
  if (value >= 0.01) {
    return `¥${value.toFixed(3)}`;
  }
  return `¥${value.toFixed(4)}`;
}

function formatCompactTokens(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toLocaleString();
}

export function UsagePanel({ summary }: { summary: TokenUsageSummary | null }) {
  if (!summary) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-white/45">
        暂无 token usage 数据。
      </div>
    );
  }

  const peakDailyTokens = Math.max(...summary.daily.map((entry) => entry.totalTokens), 1);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-3">
        {[
          { label: '今日', value: summary.today },
          { label: '本周', value: summary.week },
          { label: '本月', value: summary.month },
        ].map((entry) => (
          <div
            key={entry.label}
            className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
          >
            <div className="text-[10px] uppercase tracking-[0.14em] text-white/35">{entry.label}</div>
            <div className="mt-2 text-lg font-semibold text-white">{formatCompactTokens(entry.value.totalTokens)}</div>
            <div className="mt-1 text-xs text-white/45">
              {entry.value.callCount} 次调用 · {formatCost(entry.value.estimatedCost, entry.value.pricedCallCount)}
            </div>
            <div className="mt-2 text-[11px] text-white/58">
              输入 {formatCompactTokens(entry.value.inputTokens)} · 输出 {formatCompactTokens(entry.value.outputTokens)}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-white/35">近 14 天趋势</div>
            <div className="mt-1 text-xs text-white/45">按每日总 token 聚合。</div>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white/55">
            峰值 {formatCompactTokens(peakDailyTokens)}
          </div>
        </div>
        <div className="mt-4 flex h-28 items-end gap-2">
          {summary.daily.map((entry) => (
            <div key={entry.date} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <div className="flex h-20 w-full items-end">
                <div
                  className="w-full rounded-t-xl bg-[linear-gradient(180deg,rgba(56,189,248,0.82),rgba(59,130,246,0.45))]"
                  style={{
                    height: `${Math.max(10, (entry.totalTokens / peakDailyTokens) * 100)}%`,
                  }}
                  title={`${entry.date}: ${entry.totalTokens.toLocaleString()} tokens`}
                />
              </div>
              <div className="text-[10px] text-white/35">{entry.date.slice(5)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
          <div className="text-[11px] uppercase tracking-[0.16em] text-white/35">本月按模型</div>
          <div className="mt-3 space-y-2">
            {summary.byModel.length ? (
              summary.byModel.map((entry) => (
                <div
                  key={entry.key}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-white/86">{entry.label}</div>
                    <div className="mt-1 text-[11px] text-white/45">{entry.callCount} 次调用</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-white">{formatCompactTokens(entry.totalTokens)}</div>
                    <div className="mt-1 text-[11px] text-white/45">
                      {formatCost(entry.estimatedCost, entry.pricedCallCount)}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3 text-sm text-white/45">
                暂无模型 usage 数据。
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
          <div className="text-[11px] uppercase tracking-[0.16em] text-white/35">本月按会话</div>
          <div className="mt-3 space-y-2">
            {summary.byTopic.length ? (
              summary.byTopic.map((entry) => (
                <div
                  key={entry.key}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-white/86">{entry.label}</div>
                    <div className="mt-1 text-[11px] text-white/45">{entry.callCount} 次调用</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-white">{formatCompactTokens(entry.totalTokens)}</div>
                    <div className="mt-1 text-[11px] text-white/45">
                      {formatCost(entry.estimatedCost, entry.pricedCallCount)}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3 text-sm text-white/45">
                暂无会话 usage 数据。
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
