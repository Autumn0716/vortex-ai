import React, { useEffect, useState } from 'react';
import { Bot, Brain, CopyPlus, FolderTree, Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import type { ModelProvider } from '../lib/agent/config';
import type { PromptSnippet } from '../lib/db';
import type { AgentMemoryDocument, AgentProfile } from '../lib/agent-workspace';

interface AgentDraft {
  id?: string;
  name: string;
  description: string;
  systemPrompt: string;
  providerId?: string;
  model?: string;
  accentColor: string;
  isDefault?: boolean;
  workspaceRelpath?: string;
}

interface MemoryDraft {
  id?: string;
  title: string;
  content: string;
}

interface SnippetDraft {
  id?: string;
  title: string;
  category: string;
  content: string;
}

interface PromptsPanelProps {
  agents: AgentProfile[];
  snippets: PromptSnippet[];
  memoryDocuments: AgentMemoryDocument[];
  providers: ModelProvider[];
  currentAgentId?: string | null;
  onSelectAgent: (agentId: string) => Promise<void> | void;
  onSaveAgent: (draft: AgentDraft) => Promise<void> | void;
  onSaveMemoryDocument: (draft: MemoryDraft) => Promise<void> | void;
  onDeleteMemoryDocument: (memoryId: string) => Promise<void> | void;
  onSaveSnippet: (draft: SnippetDraft) => Promise<void> | void;
  onUseSnippet: (content: string) => void;
}

const EMPTY_AGENT: AgentDraft = {
  name: '',
  description: '',
  systemPrompt: '',
  accentColor: '#60a5fa',
};

const EMPTY_MEMORY: MemoryDraft = {
  title: '',
  content: '',
};

const EMPTY_SNIPPET: SnippetDraft = {
  title: '',
  category: 'General',
  content: '',
};

export function PromptsPanel({
  agents,
  snippets,
  memoryDocuments,
  providers,
  currentAgentId,
  onSelectAgent,
  onSaveAgent,
  onSaveMemoryDocument,
  onDeleteMemoryDocument,
  onSaveSnippet,
  onUseSnippet,
}: PromptsPanelProps) {
  const [agentDraft, setAgentDraft] = useState<AgentDraft>(EMPTY_AGENT);
  const [memoryDraft, setMemoryDraft] = useState<MemoryDraft>(EMPTY_MEMORY);
  const [snippetDraft, setSnippetDraft] = useState<SnippetDraft>(EMPTY_SNIPPET);

  const selectedAgent = agents.find((agent) => agent.id === currentAgentId) ?? agents[0] ?? null;
  const selectedProvider = providers.find((provider) => provider.id === agentDraft.providerId);

  useEffect(() => {
    if (!selectedAgent) {
      setAgentDraft(EMPTY_AGENT);
      return;
    }

    setAgentDraft({
      id: selectedAgent.id,
      name: selectedAgent.name,
      description: selectedAgent.description,
      systemPrompt: selectedAgent.systemPrompt,
      providerId: selectedAgent.providerId,
      model: selectedAgent.model,
      accentColor: selectedAgent.accentColor.startsWith('#') ? selectedAgent.accentColor : '#60a5fa',
      isDefault: selectedAgent.isDefault,
      workspaceRelpath: selectedAgent.workspaceRelpath,
    });
  }, [selectedAgent]);

  useEffect(() => {
    if (memoryDocuments.length > 0 && !memoryDraft.id) {
      const first = memoryDocuments[0]!;
      setMemoryDraft({
        id: first.id,
        title: first.title,
        content: first.content,
      });
    } else if (memoryDocuments.length === 0) {
      setMemoryDraft(EMPTY_MEMORY);
    }
  }, [memoryDocuments, memoryDraft.id]);

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

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#05050A]">
      <div className="border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-white/5 p-2 text-white/80">
            <Sparkles size={18} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Agents & Prompts</h2>
            <p className="text-xs text-white/45">
              Manage top-level agents, their memory, and reusable snippets without changing the existing UI shell.
            </p>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-px bg-white/5 md:grid-cols-[minmax(0,1.15fr)_420px]">
        <div className="min-h-0 overflow-y-auto bg-[#05050A] p-5 custom-scrollbar">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-white/35">
                Agent Library
              </h3>
              <p className="mt-1 text-sm text-white/45">
                Agents are now the top-level workspace. Topics, memory, and runtime identity hang off them.
              </p>
            </div>
            <button
              onClick={() => setAgentDraft(EMPTY_AGENT)}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/75 hover:bg-white/10 hover:text-white"
            >
              <Plus size={14} />
              新建 Agent
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:bg-white/[0.05]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Bot size={15} className="text-white/65" />
                      <h4 className="truncate text-sm font-semibold text-white">{agent.name}</h4>
                      {agent.isDefault ? (
                        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                          Default
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-white/45">
                      {agent.description}
                    </p>
                  </div>
                  <span
                    className="mt-1 h-3 w-3 rounded-full border border-white/10"
                    style={{
                      backgroundColor: agent.accentColor.startsWith('#') ? agent.accentColor : '#60a5fa',
                    }}
                  />
                </div>

                <div className="mt-3 rounded-xl border border-white/5 bg-black/20 p-3 text-xs text-white/60">
                  <div className="line-clamp-4 whitespace-pre-wrap">{agent.systemPrompt}</div>
                </div>

                <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/5 bg-black/20 px-3 py-2 text-[11px] text-white/45">
                  <FolderTree size={13} />
                  <span className="truncate">{agent.workspaceRelpath}</span>
                </div>

                <div className="mt-4 flex items-center justify-between gap-2">
                  <button
                    onClick={() =>
                      setAgentDraft({
                        id: agent.id,
                        name: agent.name,
                        description: agent.description,
                        systemPrompt: agent.systemPrompt,
                        providerId: agent.providerId,
                        model: agent.model,
                        accentColor: agent.accentColor.startsWith('#') ? agent.accentColor : '#60a5fa',
                        isDefault: agent.isDefault,
                        workspaceRelpath: agent.workspaceRelpath,
                      })
                    }
                    className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/5 hover:text-white"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => onSelectAgent(agent.id)}
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-black hover:bg-white/90"
                  >
                    切换到该 Agent
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
            <h3 className="text-sm font-semibold text-white">Agent Editor</h3>
            <div className="mt-4 space-y-3">
              <input
                value={agentDraft.name}
                onChange={(event) =>
                  setAgentDraft((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder="Agent name"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
              />
              <input
                value={agentDraft.description}
                onChange={(event) =>
                  setAgentDraft((prev) => ({ ...prev, description: event.target.value }))
                }
                placeholder="Short description"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
              />
              <div className="grid grid-cols-[1fr_92px] gap-3">
                <select
                  value={agentDraft.providerId ?? ''}
                  onChange={(event) =>
                    setAgentDraft((prev) => ({
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
                  value={agentDraft.accentColor}
                  onChange={(event) =>
                    setAgentDraft((prev) => ({ ...prev, accentColor: event.target.value }))
                  }
                  className="h-11 w-full rounded-xl border border-white/10 bg-black/20 p-1"
                />
              </div>
              <select
                value={agentDraft.model ?? ''}
                onChange={(event) =>
                  setAgentDraft((prev) => ({
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
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/45">
                <div className="mb-1 flex items-center gap-2">
                  <FolderTree size={13} />
                  <span>Managed workspace</span>
                </div>
                <div className="truncate">{agentDraft.workspaceRelpath ?? 'Will be generated automatically'}</div>
              </div>
              <textarea
                value={agentDraft.systemPrompt}
                onChange={(event) =>
                  setAgentDraft((prev) => ({ ...prev, systemPrompt: event.target.value }))
                }
                placeholder="System prompt"
                className="min-h-[180px] w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-white/30"
              />
              <label className="flex items-center gap-2 text-xs text-white/55">
                <input
                  type="checkbox"
                  checked={agentDraft.isDefault ?? false}
                  onChange={(event) =>
                    setAgentDraft((prev) => ({ ...prev, isDefault: event.target.checked }))
                  }
                />
                设为默认 Agent
              </label>
              <button
                onClick={() => onSaveAgent(agentDraft)}
                disabled={
                  !agentDraft.name.trim() ||
                  !agentDraft.description.trim() ||
                  !agentDraft.systemPrompt.trim()
                }
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save size={16} />
                保存 Agent
              </button>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center gap-2">
              <Brain size={16} className="text-white/75" />
              <h3 className="text-sm font-semibold text-white">Agent Memory</h3>
            </div>
            <div className="mt-4 space-y-3">
              <input
                value={memoryDraft.title}
                onChange={(event) =>
                  setMemoryDraft((prev) => ({ ...prev, title: event.target.value }))
                }
                placeholder="Memory title"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
              />
              <textarea
                value={memoryDraft.content}
                onChange={(event) =>
                  setMemoryDraft((prev) => ({ ...prev, content: event.target.value }))
                }
                placeholder="What this agent should remember across topics"
                className="min-h-[140px] w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-white/30"
              />
              <button
                onClick={() => onSaveMemoryDocument(memoryDraft)}
                disabled={!selectedAgent || !memoryDraft.title.trim() || !memoryDraft.content.trim()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save size={16} />
                保存记忆
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {memoryDocuments.map((document) => (
                <div
                  key={document.id}
                  className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/60"
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      onClick={() =>
                        setMemoryDraft({
                          id: document.id,
                          title: document.title,
                          content: document.content,
                        })
                      }
                      className="min-w-0 text-left"
                    >
                      <div className="truncate font-medium text-white/85">{document.title}</div>
                      <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-white/45">
                        {document.content}
                      </div>
                    </button>
                    <button
                      onClick={() => onDeleteMemoryDocument(document.id)}
                      className="rounded-lg p-1.5 text-white/35 transition-colors hover:bg-white/10 hover:text-red-300"
                      title="Delete memory"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
              {memoryDocuments.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-xs text-white/40">
                  No memory documents yet for this agent.
                </div>
              ) : null}
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
