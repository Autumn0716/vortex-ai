import React, { memo, useEffect, useRef, useState } from 'react';
import { Globe, ImagePlus, Paperclip, Plus, Search, Send, X } from 'lucide-react';
import type { AgentProfile, TopicMessageAttachment } from '../../lib/agent-workspace';
import type { SearchProviderConfig } from '../../lib/agent/config';
import type { TokenUsageAggregate } from '../../lib/db';
import type { SessionContextTokenBreakdown } from '../../lib/session-context-budget';

export interface ComposerAppendRequest {
  id: number;
  content: string;
}

interface ChatComposerProps {
  agents: AgentProfile[];
  activeAgentId: string | null;
  activeDisplayName: string;
  activeModel: string;
  activeMemoryEnabled: boolean;
  isGenerating: boolean;
  backgroundGeneratingCount: number;
  workspaceAvailable: boolean;
  composerNotice: string;
  selectedAgentName: string;
  currentContextTokens?: number;
  currentContextWindow?: number;
  currentContextUsagePercentage: number | null;
  currentContextBreakdown: SessionContextTokenBreakdown | null;
  sessionUsage: TokenUsageAggregate | null;
  imageAttachments: TopicMessageAttachment[];
  appendRequest: ComposerAppendRequest | null;
  webSearchEnabled: boolean;
  searchProvider: SearchProviderConfig | null;
  webSearchReady: boolean;
  enabledSearchProviders: SearchProviderConfig[];
  onActivateAgent: (agentId: string) => void;
  onImportFiles: () => void;
  onAttachImages: () => void;
  onOpenSearchSettings: () => void;
  onToggleWebSearch: () => void;
  onSelectSearchProvider: (providerId: string) => void;
  onOpenPrompts: () => void;
  onRemoveImageAttachment: (attachmentId: string) => void;
  onStop: () => void;
  onSend: (content: string) => void;
}

function ChatComposerComponent({
  agents,
  activeAgentId,
  activeDisplayName,
  activeModel,
  activeMemoryEnabled,
  isGenerating,
  backgroundGeneratingCount,
  workspaceAvailable,
  composerNotice,
  selectedAgentName,
  currentContextTokens,
  currentContextWindow,
  currentContextUsagePercentage,
  currentContextBreakdown,
  sessionUsage,
  imageAttachments,
  appendRequest,
  webSearchEnabled,
  searchProvider,
  webSearchReady,
  enabledSearchProviders,
  onActivateAgent,
  onImportFiles,
  onAttachImages,
  onOpenSearchSettings,
  onToggleWebSearch,
  onSelectSearchProvider,
  onOpenPrompts,
  onRemoveImageAttachment,
  onStop,
  onSend,
}: ChatComposerProps) {
  const [draft, setDraft] = useState('');
  const [showWebSearchMenu, setShowWebSearchMenu] = useState(false);
  const lastAppendRequestIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!appendRequest || appendRequest.id === lastAppendRequestIdRef.current) {
      return;
    }

    lastAppendRequestIdRef.current = appendRequest.id;
    setDraft((previous) => `${previous.trim() ? `${previous.trim()}\n\n` : ''}${appendRequest.content}`);
  }, [appendRequest]);

  const canSend = workspaceAvailable && (draft.trim().length > 0 || imageAttachments.length > 0);
  const submit = () => {
    if (!canSend || isGenerating) {
      return;
    }

    const content = draft;
    setDraft('');
    onSend(content);
  };

  return (
    <div className="chat-composer-shell bg-gradient-to-t from-[var(--app-bg-secondary)] via-[var(--app-bg-secondary)] to-transparent px-4 pt-4 pb-6">
      <div className="mx-auto w-full max-w-4xl">
        <div className="chat-composer-card rounded-[20px] border border-white/[0.08] bg-white/[0.04] p-2.5 shadow-[0_20px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl transition-[border-color,background-color] focus-within:border-white/[0.14] focus-within:bg-white/[0.06]">
          <div className="mb-1 flex flex-wrap items-center gap-1 px-2 pb-1">
            <span className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/55 tabular-nums">
              {activeDisplayName}
            </span>
            <span className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/40">
              {activeModel}
            </span>
            <span className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/40">
              {activeMemoryEnabled ? '记忆开启' : '记忆暂停'}
            </span>
            {isGenerating ? (
              <span className="rounded-md border border-emerald-400/15 bg-emerald-400/8 px-2 py-0.5 text-[10px] text-emerald-100/70">
                正在生成
              </span>
            ) : null}
            {!isGenerating && backgroundGeneratingCount > 0 ? (
              <span className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/40 tabular-nums">
                后台 {backgroundGeneratingCount}
              </span>
            ) : null}
          </div>

          {imageAttachments.length ? (
            <div className="mb-1.5 flex flex-wrap gap-1.5 border-b border-white/[0.06] px-2 pb-2">
              {imageAttachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03]"
                >
                  <img
                    src={attachment.dataUrl}
                    alt={attachment.name}
                    className="h-16 w-20 object-cover outline outline-1 outline-black/[0.1]"
                  />
                  <button
                    onClick={() => onRemoveImageAttachment(attachment.id)}
                    className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-md border border-white/[0.08] bg-black/60 text-white/55 opacity-0 transition-[opacity,background-color,color] group-hover:opacity-100 hover:bg-red-500/20 hover:text-red-100"
                    title="移除图片"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <label className="sr-only" htmlFor="vortex-chat-composer">
            Message {activeDisplayName}
          </label>
          <textarea
            id="vortex-chat-composer"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={workspaceAvailable ? `Message ${activeDisplayName}...` : 'Message Vortex...'}
            className="chat-composer-input min-h-[48px] max-h-[200px] w-full resize-none bg-transparent px-3 py-2 text-sm leading-7 text-white outline-none placeholder:text-white/35 custom-scrollbar"
            rows={1}
          />

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] px-2 pt-2">
            <div className="flex flex-wrap items-center gap-1">
              <select
                value={activeAgentId ?? ''}
                onChange={(event) => onActivateAgent(event.target.value)}
                className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-white/70 outline-none transition-[background-color,color] hover:bg-white/[0.08] hover:text-white focus:outline-none focus:ring-1 focus:ring-white/15"
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id} className="bg-[#111111]">
                    {agent.name}
                  </option>
                ))}
              </select>
              <button
                onClick={onImportFiles}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-white/35 transition-[background-color,color,transform] hover:border-white/[0.08] hover:bg-white/[0.08] hover:text-white/70 active:scale-[0.96] focus:outline-none focus:ring-1 focus:ring-white/15"
                title="Import files into shared knowledge base"
              >
                <Paperclip size={15} strokeWidth={1.5} />
              </button>
              <button
                onClick={onAttachImages}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-white/35 transition-[background-color,color,transform] hover:border-white/[0.08] hover:bg-white/[0.08] hover:text-white/70 active:scale-[0.96] focus:outline-none focus:ring-1 focus:ring-white/15"
                title="Attach images"
              >
                <ImagePlus size={15} strokeWidth={1.5} />
              </button>
              <button
                onClick={onOpenSearchSettings}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-white/35 transition-[background-color,color,transform] hover:border-white/[0.08] hover:bg-white/[0.08] hover:text-white/70 active:scale-[0.96] focus:outline-none focus:ring-1 focus:ring-white/15"
                title="Search settings"
              >
                <Globe size={15} strokeWidth={1.5} />
              </button>
              <div className="relative">
                {showWebSearchMenu ? (
                  <div className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-[300px] rounded-xl border border-white/[0.08] bg-[#0F1118]/95 p-2.5 shadow-[0_16px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-white/80">基础联网搜索</div>
                        <div className="mt-0.5 text-[10px] leading-5 text-white/35">
                          控制外部搜索 provider。模型专属能力在右上角"模型功能"中设置。
                        </div>
                      </div>
                      <button
                        onClick={onToggleWebSearch}
                        className={`flex-shrink-0 rounded-md border px-2 py-0.5 text-[10px] transition-[background-color,color] ${
                          webSearchEnabled
                            ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100/80'
                            : 'border-white/[0.08] bg-white/[0.04] text-white/40 hover:bg-white/[0.08] hover:text-white/60'
                        }`}
                      >
                        {webSearchEnabled ? '已启用' : '已关闭'}
                      </button>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {enabledSearchProviders.length > 0 ? (
                        enabledSearchProviders.map((provider) => {
                          const isSelected = searchProvider?.id === provider.id;
                          const isReady =
                            provider.category === 'local' || provider.apiKey.trim().length > 0;
                          return (
                            <button
                              key={provider.id}
                              onClick={() => onSelectSearchProvider(provider.id)}
                              className={`w-full rounded-lg border px-2.5 py-2.5 text-left transition-[border-color,background-color,color] ${
                                isSelected
                                  ? 'border-white/[0.12] bg-white/[0.075] text-white/90'
                                  : 'border-white/[0.06] bg-white/[0.02] text-white/60 hover:border-white/[0.10] hover:bg-white/[0.04] hover:text-white/80'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="truncate text-[12px] font-medium">{provider.name}</span>
                                    <span className="rounded-sm border border-white/[0.08] bg-white/[0.04] px-1.5 py-px text-[9px] text-white/35">
                                      {provider.type}
                                    </span>
                                  </div>
                                  <div className="mt-0.5 line-clamp-2 text-[10px] leading-5 text-white/35">
                                    {provider.description}
                                  </div>
                                </div>
                                <span
                                  className={`rounded-sm border px-1.5 py-0.5 text-[9px] ${
                                    isReady
                                      ? 'border-emerald-400/15 bg-emerald-400/8 text-emerald-100/70'
                                      : 'border-amber-400/15 bg-amber-400/8 text-amber-100/70'
                                  }`}
                                >
                                  {isReady ? 'Ready' : '未配置'}
                                </span>
                              </div>
                            </button>
                          );
                        })
                      ) : (
                        <div className="rounded-lg border border-dashed border-white/[0.06] px-2.5 py-3 text-[11px] leading-6 text-white/35">
                          当前没有已启用的搜索 provider。先去 Settings - Search 打开一个 provider。
                        </div>
                      )}
                    </div>
                    <div className="mt-2 text-[10px] leading-5 text-white/30">
                      {searchProvider
                        ? webSearchReady
                          ? `当前将使用 ${searchProvider.name} 作为实时搜索工具。`
                          : `${searchProvider.name} 尚未配置 API Key，调用时会直接报出缺失原因。`
                        : '未选择搜索 provider。'}
                    </div>
                  </div>
                ) : null}
                <button
                  onClick={() => setShowWebSearchMenu((previous) => !previous)}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-[border-color,background-color,color,transform,box-shadow] active:scale-[0.96] focus:outline-none focus:ring-1 focus:ring-white/15 ${
                    webSearchEnabled
                      ? 'border-white/[0.12] bg-white/[0.075] text-white/80'
                      : 'border-transparent text-white/35 hover:border-white/[0.08] hover:bg-white/[0.08] hover:text-white/60'
                  }`}
                  title="联网搜索"
                >
                  <Search size={15} strokeWidth={1.5} />
                </button>
              </div>
              <button
                onClick={onOpenPrompts}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-white/35 transition-[background-color,color,transform] hover:border-white/[0.08] hover:bg-white/[0.08] hover:text-white/70 active:scale-[0.96] focus:outline-none focus:ring-1 focus:ring-white/15"
                title="Manage agents"
              >
                <Plus size={15} strokeWidth={1.5} />
              </button>
            </div>

            {isGenerating ? (
              <button
                onClick={onStop}
                disabled={!workspaceAvailable}
                className="inline-flex items-center gap-1.5 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-1.5 text-[12px] font-medium text-red-100/80 transition-[background-color,color,transform] hover:bg-red-400/16 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 focus:outline-none focus:ring-1 focus:ring-red-400/20"
              >
                <X size={14} strokeWidth={1.5} />
                停止
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!canSend}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-[12px] font-medium text-black transition-[background-color,transform] hover:bg-white/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 focus:outline-none focus:ring-1 focus:ring-white/20"
              >
                <Send size={14} strokeWidth={1.5} />
                发送
              </button>
            )}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-white/25">
          <span>{selectedAgentName} · Shared knowledge base</span>
          <div className="flex min-w-0 items-center gap-2">
            {currentContextTokens != null ? (
              <div className="flex flex-col items-end gap-0.5">
                <span className="rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[10px] text-white/40 tabular-nums">
                  {currentContextTokens.toLocaleString()} / {currentContextWindow?.toLocaleString() ?? '?'} tokens
                  {currentContextUsagePercentage != null
                    ? ` · ${currentContextUsagePercentage.toFixed(currentContextUsagePercentage >= 10 ? 0 : 1)}%`
                    : ''}
                </span>
                {currentContextBreakdown ? (
                  <span className="text-[9px] text-white/20 tabular-nums">
                    系统 {currentContextBreakdown.systemPromptTokens.toLocaleString()} · 摘要 {currentContextBreakdown.sessionSummaryTokens.toLocaleString()} · 会话设定 {currentContextBreakdown.runtimeSystemPromptTokens.toLocaleString()} · 工具 {currentContextBreakdown.toolContextTokens.toLocaleString()} · 消息 {currentContextBreakdown.messageTokens.toLocaleString()}
                  </span>
                ) : null}
              </div>
            ) : null}
            {sessionUsage ? (
              <span className="rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[10px] text-white/40 tabular-nums">
                累计 {sessionUsage.inputTokens.toLocaleString()} 入 · {sessionUsage.outputTokens.toLocaleString()} 出 · {sessionUsage.totalTokens.toLocaleString()} 总
              </span>
            ) : null}
            {composerNotice ? (
              <span className="max-w-[50ch] truncate">{composerNotice}</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export const ChatComposer = memo(ChatComposerComponent);
