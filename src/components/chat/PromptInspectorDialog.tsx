import React from 'react';
import { BarChart3, ChevronRight, Clock3, Layers3, X } from 'lucide-react';

export interface PromptInspectorSection {
  key: string;
  label: string;
  tokens: number;
  content: string;
}

export interface PromptInspectorSnapshot {
  capturedAt: string;
  providerName: string;
  model: string;
  requestMode: 'chat' | 'responses';
  totalTokens: number;
  contextWindow?: number;
  usagePercentage: number | null;
  sections: PromptInspectorSection[];
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}`;
}

function formatDuration(durationMs?: number) {
  if (!durationMs || durationMs <= 0) {
    return '0.0s';
  }
  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
}

function formatEstimatedCost(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
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

export function PromptInspectorDialog(props: {
  open: boolean;
  onClose: () => void;
  snapshot: PromptInspectorSnapshot | null;
  latestInvocation?: {
    completedAt: string;
    streamDurationMs: number;
    reasoningDurationMs?: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost?: number;
    usageSource: 'provider' | 'estimate';
  } | null;
}) {
  if (!props.open || !props.snapshot) {
    return null;
  }

  const visibleSections = props.snapshot.sections.filter((section) => section.tokens > 0 || section.content.trim());

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm">
      <div className="flex h-[76vh] min-h-[620px] w-full max-w-[1080px] overflow-hidden rounded-[30px] border border-white/10 bg-[#171717] shadow-2xl">
        <div className="flex w-[292px] flex-col border-r border-white/5 bg-[#141414] px-5 py-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">Prompt Inspector</div>
          <div className="mt-3 text-2xl font-semibold text-white">{props.snapshot.providerName}</div>
          <div className="mt-2 text-sm text-white/55">{props.snapshot.model}</div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-[11px] text-sky-100/80">
              {props.snapshot.requestMode === 'responses' ? 'Responses' : 'Chat'}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/55">
              {formatTimestamp(props.snapshot.capturedAt)}
            </span>
          </div>
          <div className="mt-5 rounded-[24px] border border-white/8 bg-black/20 p-4">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-white/35">
              <Layers3 size={13} />
              上下文快照
            </div>
            <div className="mt-4 space-y-3">
              <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-3 py-3">
                <div className="text-[10px] uppercase tracking-[0.14em] text-white/35">总上下文</div>
                <div className="mt-1 text-lg font-semibold text-white">
                  {props.snapshot.totalTokens.toLocaleString()} tokens
                </div>
                <div className="mt-1 text-xs text-white/45">
                  {props.snapshot.contextWindow
                    ? `${props.snapshot.contextWindow.toLocaleString()} 上限`
                    : '未识别 context window'}
                  {props.snapshot.usagePercentage != null
                    ? ` · ${props.snapshot.usagePercentage.toFixed(props.snapshot.usagePercentage >= 10 ? 0 : 1)}%`
                    : ''}
                </div>
              </div>
              {props.latestInvocation ? (
                <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-3 py-3">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-white/35">
                    <BarChart3 size={12} />
                    最近调用
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-white/70">
                    <div className="flex items-center justify-between gap-3">
                      <span>输入 / 输出 / 总计</span>
                      <span className="text-white/88">
                        {props.latestInvocation.inputTokens} / {props.latestInvocation.outputTokens} /{' '}
                        {props.latestInvocation.totalTokens}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>总耗时</span>
                      <span className="text-white/88">{formatDuration(props.latestInvocation.streamDurationMs)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>思考时长</span>
                      <span className="text-white/88">{formatDuration(props.latestInvocation.reasoningDurationMs)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>估算费用</span>
                      <span className="text-white/88">{formatEstimatedCost(props.latestInvocation.estimatedCost)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>来源</span>
                      <span className="text-white/88">{props.latestInvocation.usageSource}</span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-white/5 px-6 py-5">
            <div>
              <div className="text-lg font-semibold text-white">当前请求上下文构成</div>
              <div className="mt-1 text-sm text-white/50">
                基于最近一次真实发送构建的 prompt 快照。若某项为空，表示该轮未注入。
              </div>
            </div>
            <button
              onClick={props.onClose}
              className="rounded-full p-2 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 custom-scrollbar">
            <div className="grid gap-4 lg:grid-cols-2">
              {visibleSections.map((section) => (
                <div
                  key={section.key}
                  className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.025))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-white/35">{section.label}</div>
                      <div className="mt-1 text-sm font-medium text-white/88">
                        {section.tokens.toLocaleString()} tokens
                      </div>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white/55">
                      <ChevronRight size={12} />
                    </div>
                  </div>
                  <div className="mt-3 max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words rounded-[18px] border border-white/8 bg-black/20 px-3 py-3 text-[12px] leading-6 text-white/76 custom-scrollbar">
                    {section.content.trim() || 'No content'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-white/5 px-6 py-4 text-xs text-white/40">
            <div className="flex items-center gap-2">
              <Clock3 size={12} />
              最近抓取时间 {formatTimestamp(props.snapshot.capturedAt)}
            </div>
            <div>该面板以 token 估算为主；模型返回 usage 时会在“最近调用”里覆盖真实值。</div>
          </div>
        </div>
      </div>
    </div>
  );
}
