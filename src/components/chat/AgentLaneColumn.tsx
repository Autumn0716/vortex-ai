import React, { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, ChevronDown, ChevronLeft, ChevronRight, Copy, RefreshCcw, User, Zap } from 'lucide-react';
import type { StoredToolRun } from '../../lib/db';
import type { TopicMessageAttachment } from '../../lib/agent-workspace';
import { estimateMessageCardHeight } from '../../lib/pretext';

interface LaneLike {
  id: string;
  name: string;
  description: string;
  model?: string;
  accentColor: string;
  position?: number;
}

interface MessageLike {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  authorName: string;
  content: string;
  createdAt: string;
  attachments?: TopicMessageAttachment[];
  tools?: StoredToolRun[];
}

function resolveAccentColor(input?: string) {
  if (!input) {
    return '#60a5fa';
  }

  if (input.startsWith('#')) {
    return input;
  }

  if (input.includes('cyan')) {
    return '#22d3ee';
  }
  if (input.includes('emerald') || input.includes('teal')) {
    return '#34d399';
  }
  if (input.includes('amber') || input.includes('orange')) {
    return '#f59e0b';
  }
  if (input.includes('violet')) {
    return '#8b5cf6';
  }
  return '#60a5fa';
}

export interface AgentLaneColumnProps {
  lane: LaneLike;
  messages: MessageLike[];
  isGenerating: boolean;
  showTimestamps: boolean;
  showToolResults: boolean;
  autoScroll: boolean;
  compact: boolean;
  reasoningContent?: string;
  messageMetricsById?: Record<
    string,
    {
      completedAt: string;
      streamDurationMs: number;
      reasoningDurationMs?: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      usageSource: 'provider' | 'estimate';
    }
  >;
  messageReasoningById?: Record<string, string>;
  scrollKey?: string;
  latestAssistantMessageId?: string;
  onCopyMessage?: (message: MessageLike) => void;
  onRegenerateAssistantMessage?: (messageId: string) => void;
}

interface AssistantMessageGroup {
  kind: 'assistant_group';
  key: string;
  anchorUserId?: string;
  variants: MessageLike[];
}

interface StandaloneMessageItem {
  kind: 'message';
  key: string;
  message: MessageLike;
}

type LaneDisplayItem = AssistantMessageGroup | StandaloneMessageItem;

function buildDisplayItems(messages: MessageLike[]): LaneDisplayItem[] {
  const items: LaneDisplayItem[] = [];
  let activeUserAnchorId: string | undefined;

  messages.forEach((message) => {
    if (message.role === 'user') {
      activeUserAnchorId = message.id;
      items.push({
        kind: 'message',
        key: message.id,
        message,
      });
      return;
    }

    if (message.role === 'assistant' && activeUserAnchorId) {
      const lastItem = items[items.length - 1];
      if (
        lastItem?.kind === 'assistant_group' &&
        lastItem.anchorUserId === activeUserAnchorId
      ) {
        lastItem.variants.push(message);
        return;
      }

      items.push({
        kind: 'assistant_group',
        key: `assistant_group_${activeUserAnchorId}`,
        anchorUserId: activeUserAnchorId,
        variants: [message],
      });
      return;
    }

    items.push({
      kind: 'message',
      key: message.id,
      message,
    });
  });

  return items;
}

function AgentLaneColumnComponent({
  lane,
  messages,
  isGenerating,
  showTimestamps,
  showToolResults,
  autoScroll,
  compact,
  reasoningContent,
  messageMetricsById = {},
  messageReasoningById = {},
  scrollKey,
  latestAssistantMessageId,
  onCopyMessage,
  onRegenerateAssistantMessage,
}: AgentLaneColumnProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const [contentWidth, setContentWidth] = useState(280);
  const [selectedVariantByGroup, setSelectedVariantByGroup] = useState<Record<string, number>>({});
  const [collapsedReasoningById, setCollapsedReasoningById] = useState<Record<string, boolean>>({});
  const displayItems = useMemo(() => buildDisplayItems(messages), [messages]);

  useEffect(() => {
    if (!widthRef.current) {
      return;
    }

    const element = widthRef.current;
    const observer = new ResizeObserver(() => {
      setContentWidth(element.clientWidth);
    });
    observer.observe(element);
    setContentWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setSelectedVariantByGroup((previous) => {
      let changed = false;
      const next: Record<string, number> = {};

      displayItems.forEach((item) => {
        if (item.kind !== 'assistant_group') {
          return;
        }

        const priorIndex = previous[item.key];
        const previousVariantCount = Number.isInteger(priorIndex) ? priorIndex + 1 : 0;
        const shouldSnapToLatest =
          !Number.isInteger(priorIndex) || priorIndex >= item.variants.length - 2 || item.variants.length > previousVariantCount;
        next[item.key] = shouldSnapToLatest
          ? item.variants.length - 1
          : Math.min(priorIndex as number, item.variants.length - 1);

        if (next[item.key] !== previous[item.key]) {
          changed = true;
        }
      });

      Object.keys(previous).forEach((key) => {
        if (!(key in next)) {
          changed = true;
        }
      });

      return changed ? next : previous;
    });
  }, [displayItems]);

  const lastMessageSignature = `${messages[messages.length - 1]?.id ?? 'empty'}::${
    messages[messages.length - 1]?.content.length ?? 0
  }::${messages.length}`;

  useEffect(() => {
    shouldStickToBottomRef.current = true;
  }, [scrollKey]);

  useLayoutEffect(() => {
    if (!autoScroll || !bodyRef.current || !shouldStickToBottomRef.current) {
      return;
    }

    const scrollToBottom = () => {
      if (bottomRef.current) {
        bottomRef.current.scrollIntoView({
          block: 'end',
          behavior: isGenerating ? 'smooth' : 'auto',
        });
        return;
      }

      bodyRef.current?.scrollTo({
        top: bodyRef.current.scrollHeight,
        behavior: isGenerating ? 'smooth' : 'auto',
      });
    };

    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(scrollToBottom);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoScroll, isGenerating, lastMessageSignature, scrollKey]);

  const handleScroll = () => {
    const element = bodyRef.current;
    if (!element) {
      return;
    }

    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom <= 80;
  };

  const formatChatTimestamp = (value: string) => {
    const date = new Date(value);
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const hours = `${date.getHours()}`.padStart(2, '0');
    const minutes = `${date.getMinutes()}`.padStart(2, '0');
    return `${month}-${day} ${hours}:${minutes}`;
  };

  const formatDuration = (durationMs?: number) => {
    if (!durationMs || durationMs <= 0) {
      return '0.0s';
    }
    return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
  };

  const accentColor = resolveAccentColor(lane.accentColor);
  const cardContentWidth = Math.max(contentWidth - (compact ? 42 : 54), 180);

  return (
    <section
      className="flex min-w-0 w-full max-w-[980px] flex-1 flex-col overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.03] shadow-[0_20px_60px_rgba(0,0,0,0.35)]"
      style={{
        boxShadow: `0 18px 45px color-mix(in srgb, ${accentColor} 18%, transparent)`,
      }}
    >
      <header className="border-b border-white/10 bg-black/20 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: accentColor }}
              />
              <h3 className="truncate text-sm font-semibold text-white">{lane.name}</h3>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-white/45">{lane.description}</p>
          </div>
          <div className="flex flex-col items-end gap-1 text-[10px] text-white/45">
            {lane.model ? (
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5">
                {lane.model}
              </span>
            ) : null}
            <span>Agent View {typeof lane.position === 'number' ? lane.position + 1 : 1}</span>
          </div>
        </div>
      </header>

      <div ref={widthRef} className="min-h-0 flex-1">
        <div ref={bodyRef} onScroll={handleScroll} className="h-full overflow-y-auto p-4 custom-scrollbar">
          <div className="flex min-h-full flex-col gap-4">
            {displayItems.map((item) => {
              const message =
                item.kind === 'assistant_group'
                  ? item.variants[
                      Math.min(
                        selectedVariantByGroup[item.key] ?? item.variants.length - 1,
                        item.variants.length - 1,
                      )
                    ]!
                  : item.message;
              const estimatedHeight = estimateMessageCardHeight({
                content: message.content,
                width: cardContentWidth,
                toolsCount: message.tools?.length ?? 0,
                chromeOffset: compact ? 70 : 86,
              });
              const isUser = message.role === 'user';
              const isAssistantGroup = item.kind === 'assistant_group';
              const currentVariantIndex = isAssistantGroup
                ? Math.min(
                    selectedVariantByGroup[item.key] ?? item.variants.length - 1,
                    item.variants.length - 1,
                  )
                : 0;
              const totalVariants = isAssistantGroup ? item.variants.length : 1;
              const canRegenerate =
                isAssistantGroup &&
                message.id === latestAssistantMessageId &&
                typeof onRegenerateAssistantMessage === 'function';
              const canCopy = typeof onCopyMessage === 'function';
              const reasoningText = !isUser ? messageReasoningById[message.id] ?? '' : '';
              const metrics = !isUser ? messageMetricsById[message.id] : undefined;
              const reasoningCollapsed = collapsedReasoningById[message.id] ?? false;

              return (
                <div
                  key={item.key}
                  className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                  style={{
                    contentVisibility: 'auto',
                    containIntrinsicSize: `${estimatedHeight}px`,
                  }}
                >
                  <div className={`flex max-w-[92%] gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
                    <div
                      className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
                        isUser ? 'bg-white/10' : 'bg-white text-black'
                      }`}
                      style={!isUser ? { color: accentColor } : undefined}
                    >
                      {isUser ? <User size={16} className="text-white/80" /> : <Bot size={16} />}
                    </div>

                    <div className={`flex min-w-0 flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`}>
                      <div className="flex flex-wrap items-center gap-2 px-1 text-[11px] text-white/45">
                        <span className="font-medium text-white/60">{isUser ? 'You' : message.authorName}</span>
                        {showTimestamps ? (
                          <span>{formatChatTimestamp(metrics?.completedAt ?? message.createdAt)}</span>
                        ) : null}
                        {!isUser ? (
                          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/50">
                            {`<${currentVariantIndex + 1}/${totalVariants}>`}
                          </span>
                        ) : null}
                        {isAssistantGroup && totalVariants > 1 ? (
                          <div className="ml-1 inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-1 py-0.5">
                            <button
                              onClick={() =>
                                setSelectedVariantByGroup((previous) => ({
                                  ...previous,
                                  [item.key]: Math.max(0, currentVariantIndex - 1),
                                }))
                              }
                              disabled={currentVariantIndex === 0}
                              className="rounded-full p-0.5 text-white/45 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                              title="Previous output"
                            >
                              <ChevronLeft size={12} />
                            </button>
                            <button
                              onClick={() =>
                                setSelectedVariantByGroup((previous) => ({
                                  ...previous,
                                  [item.key]: Math.min(totalVariants - 1, currentVariantIndex + 1),
                                }))
                              }
                              disabled={currentVariantIndex >= totalVariants - 1}
                              className="rounded-full p-0.5 text-white/45 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                              title="Next output"
                            >
                              <ChevronRight size={12} />
                            </button>
                          </div>
                        ) : null}
                        {!isUser && metrics ? (
                          <>
                            {metrics.reasoningDurationMs != null ? (
                              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/50">
                                思考 {formatDuration(metrics.reasoningDurationMs)}
                              </span>
                            ) : null}
                            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/50">
                              输出 {formatDuration(metrics.streamDurationMs)}
                            </span>
                            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/50">
                              Tokens {metrics.inputTokens}/{metrics.outputTokens}/{metrics.totalTokens}
                            </span>
                          </>
                        ) : null}
                        {canCopy ? (
                          <button
                            onClick={() => onCopyMessage?.(message)}
                            className="ml-1 rounded-full border border-transparent p-1 text-white/35 transition-all hover:border-white/10 hover:bg-white/10 hover:text-white"
                            title="Copy message"
                          >
                            <Copy size={12} />
                          </button>
                        ) : null}
                        {canRegenerate ? (
                          <button
                            onClick={() => onRegenerateAssistantMessage?.(message.id)}
                            className="rounded-full border border-transparent p-1 text-white/35 transition-all hover:border-white/10 hover:bg-white/10 hover:text-white"
                            title="Regenerate output"
                          >
                            <RefreshCcw size={12} />
                          </button>
                        ) : null}
                      </div>

                      {!isUser && reasoningText ? (
                        <div className="w-full rounded-2xl border border-fuchsia-400/15 bg-fuchsia-400/8 px-4 py-3 text-sm text-white/80">
                          <button
                            onClick={() =>
                              setCollapsedReasoningById((previous) => ({
                                ...previous,
                                [message.id]: !reasoningCollapsed,
                              }))
                            }
                            className="flex w-full items-center justify-between gap-3 text-left"
                          >
                            <div className="flex items-center gap-2">
                              <span className="rounded-full border border-fuchsia-400/20 bg-fuchsia-400/10 px-2 py-0.5 text-[10px] text-fuchsia-100">
                                思考过程
                              </span>
                              {metrics?.reasoningDurationMs != null ? (
                                <span className="text-[11px] text-fuchsia-100/70">
                                  总时长 {formatDuration(metrics.reasoningDurationMs)}
                                </span>
                              ) : null}
                            </div>
                            <span className="text-fuchsia-100/70">
                              {reasoningCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                            </span>
                          </button>
                          {!reasoningCollapsed ? (
                            <div className="mt-3 max-h-[320px] overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-white/8 bg-black/20 p-3 text-[12px] leading-6 text-fuchsia-50/92 custom-scrollbar">
                              {reasoningText}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {message.tools?.length ? (
                        <div className="flex w-full flex-col gap-2">
                          {message.tools.map((tool, index) => (
                            <div
                              key={`${message.id}_${tool.name}_${index}`}
                              className="rounded-xl border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-300"
                            >
                              <div className="flex items-center gap-2">
                                <Zap size={12} />
                                <span className="font-medium">
                                  {tool.name} · {tool.status}
                                </span>
                              </div>
                              {showToolResults && tool.result ? (
                                <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] text-blue-100/80">
                                  {tool.result}
                                </pre>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {message.attachments?.length ? (
                        <div className="grid w-full gap-2 sm:grid-cols-2">
                          {message.attachments.map((attachment) => (
                            <div
                              key={attachment.id}
                              className={`overflow-hidden rounded-2xl border ${
                                isUser
                                  ? 'border-white/10 bg-white/5'
                                  : 'border-white/10 bg-black/20'
                              }`}
                            >
                              <img
                                src={attachment.dataUrl}
                                alt={attachment.name}
                                className="h-40 w-full object-cover"
                              />
                              <div className="flex items-center justify-between gap-3 px-3 py-2 text-[11px] text-white/55">
                                <span className="truncate">{attachment.name}</span>
                                <span>{Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      <div
                        className={`rounded-2xl border px-4 py-3 text-sm leading-relaxed ${
                          isUser
                            ? 'rounded-tr-sm border-white/5 bg-white/10 text-white/90'
                            : 'rounded-tl-sm border-white/10 bg-black/20 text-white/90'
                        }`}
                        style={
                          isUser
                            ? undefined
                            : {
                                borderColor: `color-mix(in srgb, ${accentColor} 28%, rgba(255,255,255,0.08))`,
                              }
                        }
                      >
                        <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:border prose-pre:border-white/10 prose-pre:bg-black/40">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {message.content}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {isGenerating ? (
              <div className="flex justify-start">
                <div className="flex max-w-[92%] gap-3">
                  <div
                    className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white text-black"
                    style={{ color: accentColor }}
                  >
                    <Bot size={16} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="px-1 text-[11px] text-white/45">{lane.name}</div>
                    {reasoningContent?.trim() ? (
                      <div className="max-w-[720px] rounded-2xl border border-fuchsia-400/15 bg-fuchsia-400/8 px-4 py-3 text-sm text-white/80">
                        <div className="flex items-center gap-2">
                          <span className="rounded-full border border-fuchsia-400/20 bg-fuchsia-400/10 px-2 py-0.5 text-[10px] text-fuchsia-100">
                            思考过程
                          </span>
                          <span className="text-[11px] text-fuchsia-100/70">流式更新中</span>
                        </div>
                        <div className="mt-3 max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-white/8 bg-black/20 p-3 text-[12px] leading-6 text-fuchsia-50/92 custom-scrollbar">
                          {reasoningContent}
                        </div>
                      </div>
                    ) : null}
                    <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-white/10 bg-black/20 px-4 py-3">
                      <div
                        className="h-2 w-2 animate-bounce rounded-full"
                        style={{ backgroundColor: accentColor, animationDelay: '0ms' }}
                      />
                      <div
                        className="h-2 w-2 animate-bounce rounded-full"
                        style={{ backgroundColor: accentColor, animationDelay: '120ms' }}
                      />
                      <div
                        className="h-2 w-2 animate-bounce rounded-full"
                        style={{ backgroundColor: accentColor, animationDelay: '240ms' }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
            <div ref={bottomRef} className="h-px w-full" />
          </div>
        </div>
      </div>
    </section>
  );
}

function areLanePropsEqual(previous: AgentLaneColumnProps, next: AgentLaneColumnProps) {
  return (
    previous.messages === next.messages &&
    previous.isGenerating === next.isGenerating &&
    previous.showTimestamps === next.showTimestamps &&
    previous.showToolResults === next.showToolResults &&
    previous.autoScroll === next.autoScroll &&
    previous.compact === next.compact &&
    previous.reasoningContent === next.reasoningContent &&
    previous.messageMetricsById === next.messageMetricsById &&
    previous.messageReasoningById === next.messageReasoningById &&
    previous.scrollKey === next.scrollKey &&
    previous.latestAssistantMessageId === next.latestAssistantMessageId &&
    previous.lane.id === next.lane.id &&
    previous.lane.name === next.lane.name &&
    previous.lane.description === next.lane.description &&
    previous.lane.model === next.lane.model &&
    previous.lane.accentColor === next.lane.accentColor &&
    previous.lane.position === next.lane.position
  );
}

export const AgentLaneColumn = memo(AgentLaneColumnComponent, areLanePropsEqual);
