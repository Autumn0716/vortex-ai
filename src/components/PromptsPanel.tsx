import React, { useEffect, useState } from 'react';
import { Bot, CopyPlus, Plus, Save, Sparkles } from 'lucide-react';
import type { ModelProvider } from '../lib/agent/config';
import type { AssistantProfile, PromptSnippet } from '../lib/db';

interface AssistantDraft {
  id?: string;
  name: string;
  description: string;
  systemPrompt: string;
  providerId?: string;
  model?: string;
  accentColor: string;
  isDefault?: boolean;
}

interface SnippetDraft {
  id?: string;
  title: string;
  category: string;
  content: string;
}

interface PromptsPanelProps {
  assistants: AssistantProfile[];
  snippets: PromptSnippet[];
  providers: ModelProvider[];
  currentConversationId?: string | null;
  onAddAssistantToConversation: (assistantId: string) => Promise<void> | void;
  onSaveAssistant: (draft: AssistantDraft) => Promise<void> | void;
  onSaveSnippet: (draft: SnippetDraft) => Promise<void> | void;
  onUseSnippet: (content: string) => void;
}

const EMPTY_ASSISTANT: AssistantDraft = {
  name: '',
  description: '',
  systemPrompt: '',
  accentColor: '#60a5fa',
};

const EMPTY_SNIPPET: SnippetDraft = {
  title: '',
  category: 'General',
  content: '',
};

export function PromptsPanel({
  assistants,
  snippets,
  providers,
  currentConversationId,
  onAddAssistantToConversation,
  onSaveAssistant,
  onSaveSnippet,
  onUseSnippet,
}: PromptsPanelProps) {
  const [assistantDraft, setAssistantDraft] = useState<AssistantDraft>(EMPTY_ASSISTANT);
  const [snippetDraft, setSnippetDraft] = useState<SnippetDraft>(EMPTY_SNIPPET);

  useEffect(() => {
    if (assistants.length > 0 && !assistantDraft.id) {
      const first = assistants[0]!;
      setAssistantDraft({
        id: first.id,
        name: first.name,
        description: first.description,
        systemPrompt: first.systemPrompt,
        providerId: first.providerId,
        model: first.model,
        accentColor: first.accentColor.startsWith('#') ? first.accentColor : '#60a5fa',
        isDefault: first.isDefault,
      });
    }
  }, [assistants, assistantDraft.id]);

  useEffect(() => {
    if (snippets.length > 0 && !snippetDraft.id) {
      const first = snippets[0]!;
      setSnippetDraft({
        id: first.id,
        title: first.title,
        category: first.category,
        content: first.content,
      });
    }
  }, [snippets, snippetDraft.id]);

  const selectedProvider = providers.find((provider) => provider.id === assistantDraft.providerId);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#05050A]">
      <div className="border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-white/5 p-2 text-white/80">
            <Sparkles size={18} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Prompts & Assistants</h2>
            <p className="text-xs text-white/45">
              Build assistant presets, edit lane prompts, and inject reusable snippets into the composer.
            </p>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-px bg-white/5 md:grid-cols-[minmax(0,1.15fr)_420px]">
        <div className="min-h-0 overflow-y-auto bg-[#05050A] p-5 custom-scrollbar">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-white/35">
                Assistant Library
              </h3>
              <p className="mt-1 text-sm text-white/45">
                Add assistants to the active conversation as extra agent lanes.
              </p>
            </div>
            <button
              onClick={() => setAssistantDraft(EMPTY_ASSISTANT)}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/75 hover:bg-white/10 hover:text-white"
            >
              <Plus size={14} />
              新建助手
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {assistants.map((assistant) => (
              <div
                key={assistant.id}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:bg-white/[0.05]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Bot size={15} className="text-white/65" />
                      <h4 className="truncate text-sm font-semibold text-white">{assistant.name}</h4>
                      {assistant.isDefault ? (
                        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                          Default
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-white/45">
                      {assistant.description}
                    </p>
                  </div>
                  <span
                    className="mt-1 h-3 w-3 rounded-full border border-white/10"
                    style={{
                      backgroundColor: assistant.accentColor.startsWith('#')
                        ? assistant.accentColor
                        : '#60a5fa',
                    }}
                  />
                </div>

                <div className="mt-3 rounded-xl border border-white/5 bg-black/20 p-3 text-xs text-white/60">
                  <div className="line-clamp-4 whitespace-pre-wrap">{assistant.systemPrompt}</div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-2">
                  <button
                    onClick={() =>
                      setAssistantDraft({
                        id: assistant.id,
                        name: assistant.name,
                        description: assistant.description,
                        systemPrompt: assistant.systemPrompt,
                        providerId: assistant.providerId,
                        model: assistant.model,
                        accentColor: assistant.accentColor.startsWith('#')
                          ? assistant.accentColor
                          : '#60a5fa',
                        isDefault: assistant.isDefault,
                      })
                    }
                    className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/5 hover:text-white"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => onAddAssistantToConversation(assistant.id)}
                    disabled={!currentConversationId}
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    添加到当前会话
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-white/35">
                  Prompt Snippets
                </h3>
                <p className="mt-1 text-sm text-white/45">
                  Reusable prompt starters that can be inserted into the composer.
                </p>
              </div>
              <button
                onClick={() => setSnippetDraft(EMPTY_SNIPPET)}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/75 hover:bg-white/10 hover:text-white"
              >
                <CopyPlus size={14} />
                新建短语
              </button>
            </div>

            <div className="grid gap-3">
              {snippets.map((snippet) => (
                <div
                  key={snippet.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="truncate text-sm font-semibold text-white">{snippet.title}</h4>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/45">
                          {snippet.category}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-white/50">
                        {snippet.content}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <button
                        onClick={() =>
                          setSnippetDraft({
                            id: snippet.id,
                            title: snippet.title,
                            category: snippet.category,
                            content: snippet.content,
                          })
                        }
                        className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/5 hover:text-white"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => onUseSnippet(snippet.content)}
                        className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-black hover:bg-white/90"
                      >
                        插入到输入框
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="min-h-0 overflow-y-auto bg-[#08080D] p-5 custom-scrollbar">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-sm font-semibold text-white">Assistant Editor</h3>
            <div className="mt-4 space-y-3">
              <input
                value={assistantDraft.name}
                onChange={(event) =>
                  setAssistantDraft((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder="Assistant name"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
              />
              <input
                value={assistantDraft.description}
                onChange={(event) =>
                  setAssistantDraft((prev) => ({ ...prev, description: event.target.value }))
                }
                placeholder="Short description"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
              />
              <div className="grid grid-cols-[1fr_92px] gap-3">
                <select
                  value={assistantDraft.providerId ?? ''}
                  onChange={(event) =>
                    setAssistantDraft((prev) => ({
                      ...prev,
                      providerId: event.target.value || undefined,
                      model: undefined,
                    }))
                  }
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
                >
                  <option value="">Follow workspace default</option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
                <input
                  type="color"
                  value={assistantDraft.accentColor}
                  onChange={(event) =>
                    setAssistantDraft((prev) => ({ ...prev, accentColor: event.target.value }))
                  }
                  className="h-11 w-full rounded-xl border border-white/10 bg-black/20 p-1"
                />
              </div>
              <select
                value={assistantDraft.model ?? ''}
                onChange={(event) =>
                  setAssistantDraft((prev) => ({
                    ...prev,
                    model: event.target.value || undefined,
                  }))
                }
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
              >
                <option value="">Follow provider default</option>
                {(selectedProvider?.models ?? []).map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
              <textarea
                value={assistantDraft.systemPrompt}
                onChange={(event) =>
                  setAssistantDraft((prev) => ({ ...prev, systemPrompt: event.target.value }))
                }
                placeholder="System prompt"
                className="min-h-[180px] w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-white/30"
              />
              <label className="flex items-center gap-2 text-xs text-white/55">
                <input
                  type="checkbox"
                  checked={assistantDraft.isDefault ?? false}
                  onChange={(event) =>
                    setAssistantDraft((prev) => ({ ...prev, isDefault: event.target.checked }))
                  }
                />
                设为默认助手
              </label>
              <button
                onClick={() => onSaveAssistant(assistantDraft)}
                disabled={
                  !assistantDraft.name.trim() ||
                  !assistantDraft.description.trim() ||
                  !assistantDraft.systemPrompt.trim()
                }
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save size={16} />
                保存助手
              </button>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-sm font-semibold text-white">Snippet Editor</h3>
            <div className="mt-4 space-y-3">
              <input
                value={snippetDraft.title}
                onChange={(event) =>
                  setSnippetDraft((prev) => ({ ...prev, title: event.target.value }))
                }
                placeholder="Snippet title"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
              />
              <input
                value={snippetDraft.category}
                onChange={(event) =>
                  setSnippetDraft((prev) => ({ ...prev, category: event.target.value }))
                }
                placeholder="Category"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
              />
              <textarea
                value={snippetDraft.content}
                onChange={(event) =>
                  setSnippetDraft((prev) => ({ ...prev, content: event.target.value }))
                }
                placeholder="Snippet body"
                className="min-h-[140px] w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-white/30"
              />
              <button
                onClick={() => onSaveSnippet(snippetDraft)}
                disabled={!snippetDraft.title.trim() || !snippetDraft.content.trim()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save size={16} />
                保存短语
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
