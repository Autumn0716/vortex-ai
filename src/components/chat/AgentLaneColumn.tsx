import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, User, Zap } from 'lucide-react';
import type { StoredToolRun } from '../../lib/db';
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
  scrollKey?: string;
}

export function AgentLaneColumn({
  lane,
  messages,
  isGenerating,
  showTimestamps,
  showToolResults,
  autoScroll,
  compact,
  scrollKey,
}: AgentLaneColumnProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(280);

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

  const lastMessageSignature = `${messages[messages.length - 1]?.id ?? 'empty'}::${
    messages[messages.length - 1]?.content.length ?? 0
  }::${messages.length}`;

  useLayoutEffect(() => {
    if (!autoScroll || !bodyRef.current) {
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
        <div ref={bodyRef} className="h-full overflow-y-auto p-4 custom-scrollbar">
          <div className="flex min-h-full flex-col gap-4">
            {messages.map((message) => {
              const estimatedHeight = estimateMessageCardHeight({
                content: message.content,
                width: cardContentWidth,
                toolsCount: message.tools?.length ?? 0,
                chromeOffset: compact ? 70 : 86,
              });
              const isUser = message.role === 'user';

              return (
                <div
                  key={message.id}
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
                      <div className="flex items-center gap-2 px-1 text-[11px] text-white/45">
                        <span className="font-medium text-white/60">
                          {isUser ? 'You' : message.authorName}
                        </span>
                        {showTimestamps ? (
                          <span>
                            {new Date(message.createdAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        ) : null}
                      </div>

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
