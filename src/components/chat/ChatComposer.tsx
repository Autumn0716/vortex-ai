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
    <div className="bg-gradient-to-t from-[#05050A] via-[#05050A] to-transparent p-4">
      <div className="mx-auto w-full max-w-[1120px]">
        <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-2 shadow-[0_18px_50px_rgba(0,0,0,0.32)] transition-all focus-within:border-white/20 focus-within:bg-[linear-gradient(180deg,rgba(255,255,255,0.09),rgba(255,255,255,0.04))]">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5 px-2 pb-1.5">
            <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-white/65">
              {activeDisplayName}
            </span>
            <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-white/50">
              {activeModel}
            </span>
            <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-white/50">
              {activeMemoryEnabled ? '记忆开启' : '记忆暂停'}
            </span>
            {isGenerating ? (
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-200/85">
                正在生成
              </span>
            ) : null}
            {!isGenerating && backgroundGeneratingCount > 0 ? (
              <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-white/55">
                后台 {backgroundGeneratingCount}
              </span>
            ) : null}
          </div>

          {imageAttachments.length ? (
            <div className="mb-2 flex flex-wrap gap-2 border-b border-white/10 px-2 pb-2.5">
              {imageAttachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="group relative overflow-hidden rounded-2xl border border-white/10 bg-black/20"
                >
                  <img
                    src={attachment.dataUrl}
                    alt={attachment.name}
                    className="h-20 w-24 object-cover"
                  />
                  <button
                    onClick={() => onRemoveImageAttachment(attachment.id)}
                    className="absolute right-1 top-1 rounded-full border border-white/10 bg-black/55 p-1 text-white/65 transition-all hover:border-red-400/25 hover:bg-red-500/20 hover:text-red-100"
                    title="移除图片"
                  >
                    <X size={12} />
                  </button>
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 py-1 text-[10px] text-white/80">
                    <div className="truncate">{attachment.name}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <label className="sr-only" htmlFor="flowagent-chat-composer">
            Message {activeDisplayName}
          </label>
          <textarea
            id="flowagent-chat-composer"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={workspaceAvailable ? `Message ${activeDisplayName}...` : 'Message FlowAgent...'}
            className="min-h-[52px] max-h-[200px] w-full resize-none bg-transparent px-3 py-2 text-sm leading-7 text-white outline-none placeholder:text-white/40 custom-scrollbar"
            rows={1}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-2 pt-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                value={activeAgentId ?? ''}
                onChange={(event) => onActivateAgent(event.target.value)}
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none transition-colors hover:bg-white/[0.06]"
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id} className="bg-[#111111]">
                    {agent.name}
                  </option>
                ))}
              </select>
              <button
                onClick={onImportFiles}
                className="rounded-xl border border-transparent p-2 text-white/40 transition-colors hover:border-white/10 hover:bg-white/10 hover:text-white"
                title="Import files into shared knowledge base"
              >
                <Paperclip size={17} />
              </button>
              <button
                onClick={onAttachImages}
                className="rounded-xl border border-transparent p-2 text-white/40 transition-colors hover:border-white/10 hover:bg-white/10 hover:text-white"
                title="Attach images"
              >
                <ImagePlus size={17} />
              </button>
              <button
                onClick={onOpenSearchSettings}
                className="rounded-xl border border-transparent p-2 text-white/40 transition-colors hover:border-white/10 hover:bg-white/10 hover:text-white"
                title="Search settings"
              >
                <Globe size={17} />
              </button>
              <div className="relative">
                {showWebSearchMenu ? (
                  <div className="absolute bottom-[calc(100%+10px)] left-0 z-30 w-[320px] rounded-2xl border border-white/10 bg-[#0F1118]/95 p-3 shadow-[0_20px_45px_rgba(0,0,0,0.4)] backdrop-blur-xl">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold text-white">基础联网搜索</div>
                        <div className="mt-1 text-[11px] leading-5 text-white/45">
                          控制外部搜索 provider。模型专属能力在右上角“模型功能”中设置。
                        </div>
                      </div>
                      <button
                        onClick={onToggleWebSearch}
                        className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                          webSearchEnabled
                            ? 'border-emerald-400/25 bg-emerald-400/12 text-emerald-100'
                            : 'border-white/10 bg-white/5 text-white/55 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        {webSearchEnabled ? '搜索已启用' : '搜索已关闭'}
                      </button>
                    </div>
                    <div className="mt-3 grid gap-2">
                      {enabledSearchProviders.length > 0 ? (
                        enabledSearchProviders.map((provider) => {
                          const isSelected = searchProvider?.id === provider.id;
                          const isReady =
                            provider.category === 'local' || provider.apiKey.trim().length > 0;
                          return (
                            <button
                              key={provider.id}
                              onClick={() => onSelectSearchProvider(provider.id)}
                              className={`rounded-2xl border px-3 py-3 text-left transition-all ${
                                isSelected
                                  ? 'border-sky-400/25 bg-sky-400/12 text-white shadow-[0_14px_28px_rgba(0,0,0,0.2)]'
                                  : 'border-white/10 bg-white/[0.03] text-white/72 hover:bg-white/8 hover:text-white'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="truncate text-sm font-medium">{provider.name}</span>
                                    <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] text-white/45">
                                      {provider.type}
                                    </span>
                                  </div>
                                  <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-white/45">
                                    {provider.description}
                                  </div>
                                </div>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] ${
                                    isReady
                                      ? 'border border-emerald-400/25 bg-emerald-400/12 text-emerald-100'
                                      : 'border border-amber-400/25 bg-amber-400/12 text-amber-100'
                                  }`}
                                >
                                  {isReady ? 'Ready' : '未配置'}
                                </span>
                              </div>
                            </button>
                          );
                        })
                      ) : (
                        <div className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-xs leading-6 text-white/45">
                          当前没有已启用的搜索 provider。先去 Settings - Search 打开一个 provider。
                        </div>
                      )}
                    </div>
                    <div className="mt-3 text-[11px] leading-5 text-white/38">
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
                  className={`rounded-xl border p-2 transition-all ${
                    webSearchEnabled
                      ? 'border-sky-400/25 bg-sky-400/12 text-sky-100 shadow-[0_12px_28px_rgba(14,165,233,0.16)]'
                      : 'border-transparent text-white/40 hover:border-white/10 hover:bg-white/10 hover:text-white'
                  }`}
                  title="联网搜索"
                >
                  <Search size={17} />
                </button>
              </div>
              <button
                onClick={onOpenPrompts}
                className="rounded-xl border border-transparent p-2 text-white/40 transition-colors hover:border-white/10 hover:bg-white/10 hover:text-white"
                title="Manage agents"
              >
                <Plus size={17} />
              </button>
            </div>

            {isGenerating ? (
              <button
                onClick={onStop}
                disabled={!workspaceAvailable}
                className="inline-flex items-center gap-2 rounded-2xl border border-red-400/25 bg-red-400/12 px-4 py-2 text-sm font-medium text-red-100 transition-colors hover:bg-red-400/18 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X size={17} className="ml-0.5" />
                停止
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!canSend}
                className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send size={17} className="ml-0.5" />
                发送
              </button>
            )}
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-white/35">
          <span>{selectedAgentName} · Shared knowledge base</span>
          <div className="flex min-w-0 items-center gap-3">
            {currentContextTokens != null ? (
              <div className="flex flex-col items-end gap-1">
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-white/58">
                  当前会话上下文 {currentContextTokens.toLocaleString()} tokens
                  {currentContextWindow ? ` / ${currentContextWindow.toLocaleString()}` : ''}
                  {currentContextUsagePercentage != null
                    ? ` · ${currentContextUsagePercentage.toFixed(currentContextUsagePercentage >= 10 ? 0 : 1)}%`
                    : ''}
                </span>
                {currentContextBreakdown ? (
                  <span className="text-[10px] text-white/28">
                    系统 {currentContextBreakdown.systemPromptTokens.toLocaleString()} · 摘要{' '}
                    {currentContextBreakdown.sessionSummaryTokens.toLocaleString()} · 会话设定{' '}
                    {currentContextBreakdown.runtimeSystemPromptTokens.toLocaleString()} · 工具{' '}
                    {currentContextBreakdown.toolContextTokens.toLocaleString()} · 消息{' '}
                    {currentContextBreakdown.messageTokens.toLocaleString()}
                  </span>
                ) : null}
              </div>
            ) : null}
            {sessionUsage ? (
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-white/58">
                当前会话累计 输入 {sessionUsage.inputTokens.toLocaleString()} · 输出{' '}
                {sessionUsage.outputTokens.toLocaleString()} · 总计 {sessionUsage.totalTokens.toLocaleString()}
                {' · '}
                {sessionUsage.callCount} 次
              </span>
            ) : null}
            {composerNotice ? (
              <span className="max-w-[60ch] truncate">{composerNotice}</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export const ChatComposer = memo(ChatComposerComponent);
