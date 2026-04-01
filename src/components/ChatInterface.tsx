import React, { Suspense, lazy, startTransition, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Globe,
  MessageSquare,
  Paperclip,
  PanelLeft,
  PanelLeftClose,
  PencilLine,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  Sun,
  Terminal,
} from 'lucide-react';
import { AgentLaneColumn } from './chat/AgentLaneColumn';
import {
  addDocument,
  listPromptSnippets,
  savePromptSnippet,
  type PromptSnippet,
} from '../lib/db';
import {
  addTopicMessages,
  createTopic,
  deleteAgentMemoryDocument,
  ensureAgentWorkspaceBootstrap,
  getAgentMemoryContext,
  getOrCreateActiveTopic,
  getSearchCapabilities,
  getTopicWorkspace,
  listAgentMemoryDocuments,
  listAgents,
  listTopics,
  maybeAutoTitleTopic,
  saveAgent,
  saveAgentMemoryDocument,
  searchWorkspace,
  type AgentMemoryDocument,
  type AgentProfile,
  type TopicMessage,
  type TopicMessageInput,
  type TopicSummary,
  type TopicWorkspace,
  type WorkspaceSearchResult,
  updateTopicTitle,
} from '../lib/agent-workspace';
import {
  type AgentConfig,
  getAgentConfig,
  normalizeAgentConfig,
  saveAgentConfig,
} from '../lib/agent/config';
import { applyThemePreferences } from '../lib/theme';
import { syncBundledKnowledgeDocuments } from '../lib/project-knowledge';
import { TimeoutError, withSoftTimeout } from '../lib/async-timeout';
import { formatErrorDetails, wrapErrorWithContext } from '../lib/error-details';
import { registerConfiguredAgentMemoryFileStore } from '../lib/agent-memory-api';

const TerminalPanel = lazy(() =>
  import('./TerminalPanel').then((module) => ({ default: module.TerminalPanel })),
);
const KnowledgePanel = lazy(() =>
  import('./KnowledgePanel').then((module) => ({ default: module.KnowledgePanel })),
);
const PromptsPanel = lazy(() =>
  import('./PromptsPanel').then((module) => ({ default: module.PromptsPanel })),
);
const SettingsView = lazy(() =>
  import('./settings/SettingsView').then((module) => ({ default: module.SettingsView })),
);

type ChatTab = 'chat' | 'prompts' | 'knowledge' | 'sandbox';
type SettingsCategory =
  | 'models'
  | 'default'
  | 'general'
  | 'display'
  | 'data'
  | 'mcp'
  | 'search'
  | 'memory'
  | 'api'
  | 'docs'
  | 'snippets'
  | 'shortcuts'
  | 'assistant';

function createLocalId(prefix: string) {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}_${uuid ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

function toTopicMessage(message: TopicMessageInput): TopicMessage {
  return {
    id: message.id ?? createLocalId('message'),
    topicId: message.topicId,
    agentId: message.agentId,
    role: message.role,
    authorName: message.authorName,
    content: message.content,
    createdAt: message.createdAt ?? new Date().toISOString(),
    tools: message.tools,
  };
}

function mergeWorkspaceMessages(
  workspace: TopicWorkspace | null,
  messages: TopicMessage[],
): TopicWorkspace | null {
  if (!workspace || messages.length === 0) {
    return workspace;
  }

  const lastMessage = messages[messages.length - 1]!;
  return {
    ...workspace,
    messages: [...workspace.messages, ...messages],
    topic: {
      ...workspace.topic,
      preview: lastMessage.content.replace(/\s+/g, ' ').trim() || workspace.topic.preview,
      updatedAt: lastMessage.createdAt,
      lastMessageAt: lastMessage.createdAt,
      messageCount: workspace.topic.messageCount + messages.length,
    },
  };
}

function stringifyMessageContent(content: unknown) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }
        if (typeof entry === 'object' && entry && 'text' in entry) {
          return String((entry as { text?: unknown }).text ?? '');
        }
        return JSON.stringify(entry);
      })
      .join('\n');
  }
  return String(content ?? '');
}

function extractToolUsage(messages: any[], initialCount: number) {
  const tools: { name: string; status: 'completed'; result: string }[] = [];
  for (let index = initialCount; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?._getType?.() === 'tool') {
      const toolMessage = message as { name: string; content: unknown };
      tools.push({
        name: toolMessage.name,
        status: 'completed',
        result: String(toolMessage.content).slice(0, 1200),
      });
    }
  }
  return tools;
}

const WORKSPACE_BOOT_SOFT_TIMEOUT_MS = 8000;
const WORKSPACE_BOOT_HARD_TIMEOUT_MS = 45000;

export const ChatInterface: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState<ChatTab>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialCategory, setSettingsInitialCategory] =
    useState<SettingsCategory>('models');
  const [input, setInput] = useState('');
  const [workspace, setWorkspace] = useState<TopicWorkspace | null>(null);
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [snippets, setSnippets] = useState<PromptSnippet[]>([]);
  const [memoryDocuments, setMemoryDocuments] = useState<AgentMemoryDocument[]>([]);
  const [config, setConfig] = useState<AgentConfig>(() => normalizeAgentConfig());
  const [activeAgentId, setActiveAgentIdState] = useState<string | null>(null);
  const [activeTopicId, setActiveTopicIdState] = useState<string | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [composerNotice, setComposerNotice] = useState('');
  const [bootstrapErrorDetails, setBootstrapErrorDetails] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<WorkspaceSearchResult[]>([]);
  const [fts5Enabled, setFts5Enabled] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedAgent =
    workspace?.agent ?? agents.find((entry) => entry.id === activeAgentId) ?? null;

  const refreshLibrary = async () => {
    const [agentRecords, snippetRecords] = await Promise.all([
      listAgents(),
      listPromptSnippets(),
    ]);

    startTransition(() => {
      setAgents(agentRecords);
      setSnippets(snippetRecords);
    });
  };

  const refreshMemory = async (agentId: string) => {
    const records = await listAgentMemoryDocuments(agentId);
    startTransition(() => {
      setMemoryDocuments(records);
      setWorkspace((previous) =>
        previous && previous.agent.id === agentId
          ? {
              ...previous,
              memoryDocuments: records,
            }
          : previous,
      );
    });
  };

  const hydrateTopic = async (topicId: string) => {
    setLoadingWorkspace(true);
    const nextWorkspace = await getTopicWorkspace(topicId);
    if (!nextWorkspace) {
      startTransition(() => {
        setWorkspace(null);
        setLoadingWorkspace(false);
      });
      return;
    }

    const [topicRecords, memoryRecords] = await Promise.all([
      listTopics(nextWorkspace.agent.id),
      listAgentMemoryDocuments(nextWorkspace.agent.id),
      refreshLibrary(),
    ]);

    startTransition(() => {
      setWorkspace({
        ...nextWorkspace,
        memoryDocuments: memoryRecords,
      });
      setTopics(topicRecords);
      setMemoryDocuments(memoryRecords);
      setActiveAgentIdState(nextWorkspace.agent.id);
      setActiveTopicIdState(nextWorkspace.topic.id);
      setLoadingWorkspace(false);
    });
  };

  const bootstrapWorkspace = async () => {
    setLoadingWorkspace(true);
    setComposerNotice('');
    setBootstrapErrorDetails('');

    try {
      const [searchCapabilities, bootstrap] = await withSoftTimeout(
        Promise.all([
          getSearchCapabilities().catch((error) => {
            throw wrapErrorWithContext('Checking local search capabilities failed', error);
          }),
          ensureAgentWorkspaceBootstrap().catch((error) => {
            throw wrapErrorWithContext('Opening local workspace failed', error);
          }),
        ]),
        {
          softTimeoutMs: WORKSPACE_BOOT_SOFT_TIMEOUT_MS,
          hardTimeoutMs: WORKSPACE_BOOT_HARD_TIMEOUT_MS,
          onSoftTimeout: () => {
            startTransition(() => {
              setComposerNotice(
                'Opening the local workspace is taking longer than usual. FlowAgent is still loading your local data.',
              );
            });
          },
          hardTimeoutMessage: 'Timed out while opening the local workspace.',
        },
      );

      startTransition(() => {
        setFts5Enabled(searchCapabilities.fts5Available);
      });

      if (!bootstrap) {
        startTransition(() => {
          setWorkspace(null);
          setTopics([]);
          setAgents([]);
          setMemoryDocuments([]);
          setActiveTopicIdState(null);
          setLoadingWorkspace(false);
          setComposerNotice(
            'Local workspace is empty or did not finish initializing. You can still open Settings or retry.',
          );
        });
        return;
      }

      await withSoftTimeout(
        hydrateTopic(bootstrap.topic.id).catch((error) => {
          throw wrapErrorWithContext('Loading the current topic failed', error);
        }),
        {
          softTimeoutMs: WORKSPACE_BOOT_SOFT_TIMEOUT_MS,
          hardTimeoutMs: WORKSPACE_BOOT_HARD_TIMEOUT_MS,
          onSoftTimeout: () => {
            startTransition(() => {
              setComposerNotice(
                'Loading the current topic is taking longer than usual. FlowAgent is still waiting on local workspace data.',
              );
            });
          },
          hardTimeoutMessage: 'Timed out while loading the current topic.',
        },
      );
      setComposerNotice('');
    } catch (error) {
      console.error('Failed to initialize agent workspace:', error);
      const errorDetails = formatErrorDetails(error);
      startTransition(() => {
        setWorkspace(null);
        setTopics([]);
        setAgents([]);
        setMemoryDocuments([]);
        setActiveTopicIdState(null);
        setLoadingWorkspace(false);
        setBootstrapErrorDetails(errorDetails);
        setComposerNotice(
          error instanceof TimeoutError
            ? 'Local workspace is still taking too long to open. Settings is still available, and you can retry the workspace bootstrap.'
            : 'Local workspace failed to open. Settings is still available, and you can retry the workspace bootstrap.',
        );
      });
    }
  };

  const activateAgent = async (agentId: string) => {
    const topic = await getOrCreateActiveTopic(agentId);
    await hydrateTopic(topic.id);
    setComposerNotice('');
    setActiveTab('chat');
  };

  const activateTopic = async (topicId: string) => {
    await hydrateTopic(topicId);
    setComposerNotice('');
    setActiveTab('chat');
  };

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      try {
        const currentConfig = await getAgentConfig();
        registerConfiguredAgentMemoryFileStore(currentConfig.apiServer);
        if (!cancelled) {
          startTransition(() => {
            setConfig(currentConfig);
          });
        }
      } catch (error) {
        console.error('Failed to load agent config:', error);
      }

      try {
        await bootstrapWorkspace();
      } finally {
        if (!cancelled) {
          void syncBundledKnowledgeDocuments().catch((error) => {
            console.warn('Bundled knowledge sync failed after bootstrap:', error);
          });
        }
      }
    };

    setup();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    applyThemePreferences(config);
    registerConfiguredAgentMemoryFileStore(config.apiServer);
  }, [config]);

  useEffect(() => {
    let cancelled = false;

    const loadSearchResults = async () => {
      if (!searchQuery.trim()) {
        startTransition(() => setSearchResults([]));
        return;
      }

      const results = await searchWorkspace(searchQuery);
      if (cancelled) {
        return;
      }
      startTransition(() => setSearchResults(results));
    };

    loadSearchResults().catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [searchQuery]);

  const openSettings = (category: SettingsCategory = 'models') => {
    setSettingsInitialCategory(category);
    setShowSettings(true);
  };

  const handleMemoryFilesChanged = async (agentId: string) => {
    if (workspace?.agent.id === agentId) {
      await refreshMemory(agentId);
    }

    if (activeAgentId === agentId && activeTopicId) {
      const nextWorkspace = await getTopicWorkspace(activeTopicId);
      if (nextWorkspace) {
        startTransition(() => {
          setWorkspace(nextWorkspace);
        });
      }
    }
  };

  const handleCreateTopic = async () => {
    const targetAgentId = activeAgentId ?? agents[0]?.id;
    if (!targetAgentId) {
      return;
    }

    const created = await createTopic({ agentId: targetAgentId });
    await activateTopic(created.id);
  };

  const handleModelChange = async (value: string) => {
    const [providerId, model] = value.split('::');
    const nextConfig: AgentConfig = {
      ...config,
      activeProviderId: providerId,
      activeModel: model,
    };
    setConfig(nextConfig);
    await saveAgentConfig(nextConfig);
  };

  const handleSaveAgent = async (draft: {
    id?: string;
    name: string;
    description: string;
    systemPrompt: string;
    providerId?: string;
    model?: string;
    accentColor: string;
    isDefault?: boolean;
    workspaceRelpath?: string;
  }) => {
    const saved = await saveAgent({
      id: draft.id ?? '',
      name: draft.name,
      description: draft.description,
      systemPrompt: draft.systemPrompt,
      providerId: draft.providerId,
      model: draft.model,
      accentColor: draft.accentColor,
      isDefault: draft.isDefault,
      workspaceRelpath: draft.workspaceRelpath,
    });
    setComposerNotice(`Saved agent "${saved.name}".`);
    await refreshLibrary();
    if (!activeAgentId || activeAgentId === saved.id || !draft.id) {
      await activateAgent(saved.id);
    }
  };

  const handleSaveMemoryDocument = async (draft: { id?: string; title: string; content: string }) => {
    if (!activeAgentId) {
      return;
    }

    await saveAgentMemoryDocument({
      id: draft.id,
      agentId: activeAgentId,
      title: draft.title,
      content: draft.content,
    });
    setComposerNotice(`Updated memory for ${selectedAgent?.name ?? 'the current agent'}.`);
    await refreshMemory(activeAgentId);
  };

  const handleDeleteMemoryDocument = async (memoryId: string) => {
    if (!activeAgentId) {
      return;
    }

    await deleteAgentMemoryDocument(memoryId);
    setComposerNotice(`Removed an agent memory entry.`);
    await refreshMemory(activeAgentId);
  };

  const handleSaveSnippet = async (draft: {
    id?: string;
    title: string;
    category: string;
    content: string;
  }) => {
    await savePromptSnippet({
      id: draft.id ?? '',
      title: draft.title,
      category: draft.category,
      content: draft.content,
    });
    setComposerNotice(`Saved snippet "${draft.title}".`);
    await refreshLibrary();
  };

  const handleUseSnippet = (content: string) => {
    setInput((previous) => `${previous.trim() ? `${previous.trim()}\n\n` : ''}${content}`);
    setActiveTab('chat');
  };

  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    const entries = await Promise.all(
      files.map(async (file) => ({
        id: createLocalId('document'),
        title: file.name,
        content: await file.text(),
      })),
    );

    await Promise.all(entries.map((entry) => addDocument(entry.id, entry.title, entry.content)));
    setComposerNotice(
      `Imported ${entries.length} document${entries.length > 1 ? 's' : ''} into the shared knowledge base.`,
    );
    event.target.value = '';
  };

  const handleRenameTopic = async () => {
    if (!workspace) {
      return;
    }

    const nextTitle = globalThis.prompt('Rename topic', workspace.topic.title);
    if (nextTitle === null) {
      return;
    }

    await updateTopicTitle(workspace.topic.id, nextTitle);
    await hydrateTopic(workspace.topic.id);
    setComposerNotice(`Renamed topic to "${nextTitle.trim() || workspace.topic.title}".`);
  };

  const handleSend = async () => {
    if (!workspace || !input.trim() || isGenerating) {
      return;
    }

    const userContent = input.trim();
    const workspaceSnapshot = workspace;
    const configSnapshot = config;
    const timestamp = new Date().toISOString();
    const userMessage: TopicMessageInput = {
      id: createLocalId('message'),
      topicId: workspaceSnapshot.topic.id,
      agentId: workspaceSnapshot.agent.id,
      role: 'user',
      authorName: 'You',
      content: userContent,
      createdAt: timestamp,
    };

    const optimisticUserMessage = toTopicMessage(userMessage);
    setWorkspace((previous) => mergeWorkspaceMessages(previous, [optimisticUserMessage]));
    setInput('');
    setComposerNotice('');
    setIsGenerating(true);
    await addTopicMessages([userMessage]);
    await maybeAutoTitleTopic(workspaceSnapshot.topic.id, userContent);

    try {
      const [{ HumanMessage, AIMessage }, { createAgentRuntime }] = await Promise.all([
        import('@langchain/core/messages'),
        import('../lib/agent/runtime'),
      ]);

      const messageHistory = [...workspaceSnapshot.messages, optimisticUserMessage]
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .slice(-configSnapshot.memory.historyWindow);

      const lcMessages = messageHistory.map((message) =>
        message.role === 'user' ? new HumanMessage(message.content) : new AIMessage(message.content),
      );

      const memoryContext = configSnapshot.memory.includeGlobalMemory
        ? (
            await getAgentMemoryContext(workspaceSnapshot.agent.id, {
              includeRecentMemorySnapshot: configSnapshot.memory.includeRecentMemorySnapshot,
            })
          ).slice(0, 4000)
        : '';

      const runtime = createAgentRuntime({
        config: configSnapshot,
        providerId: workspaceSnapshot.agent.providerId,
        model: workspaceSnapshot.agent.model,
        systemPrompt: [
          configSnapshot.systemPrompt,
          memoryContext ? `Agent memory:\n${memoryContext}` : '',
          `Agent identity:\n${workspaceSnapshot.agent.systemPrompt}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      });

      const result = await runtime.invoke({ messages: lcMessages });
      const finalMessages = result.messages;
      const lastAssistantMessage = [...finalMessages]
        .reverse()
        .find((message) => message?._getType?.() === 'ai') as { content: unknown } | undefined;

      if (!lastAssistantMessage) {
        throw new Error('The model did not return a final assistant message.');
      }

      const assistantMessage: TopicMessageInput = {
        id: createLocalId('message'),
        topicId: workspaceSnapshot.topic.id,
        agentId: workspaceSnapshot.agent.id,
        role: 'assistant',
        authorName: workspaceSnapshot.agent.name,
        content: stringifyMessageContent(lastAssistantMessage.content),
        createdAt: new Date().toISOString(),
        tools: extractToolUsage(finalMessages, lcMessages.length),
      };

      const optimisticAssistantMessage = toTopicMessage(assistantMessage);
      setWorkspace((previous) => mergeWorkspaceMessages(previous, [optimisticAssistantMessage]));
      await addTopicMessages([assistantMessage]);
    } catch (error: any) {
      const fallbackMessage: TopicMessageInput = {
        id: createLocalId('message'),
        topicId: workspaceSnapshot.topic.id,
        agentId: workspaceSnapshot.agent.id,
        role: 'assistant',
        authorName: workspaceSnapshot.agent.name,
        content: `**Agent error:** ${error.message}\n\nPlease check model credentials or the runtime configuration in Settings.`,
        createdAt: new Date().toISOString(),
      };
      setWorkspace((previous) => mergeWorkspaceMessages(previous, [toTopicMessage(fallbackMessage)]));
      await addTopicMessages([fallbackMessage]);
    } finally {
      setIsGenerating(false);
      await hydrateTopic(workspaceSnapshot.topic.id);
    }
  };

  const enabledProviders = config.providers.filter((provider) => provider.enabled);

  return (
    <div className="app-shell relative z-10 flex h-screen w-full overflow-hidden font-sans text-white">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileImport}
      />

      <div className="z-30 flex w-16 flex-shrink-0 flex-col items-center gap-4 border-r border-white/5 bg-[#0A0A0F] py-4">
        <div
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-gradient-brand font-bold text-white shadow-lg"
          onClick={onBack}
        >
          FA
        </div>

        <button
          onClick={() => setActiveTab('chat')}
          className={`rounded-xl p-2.5 transition-all ${
            activeTab === 'chat'
              ? 'bg-white/10 text-white shadow-sm'
              : 'text-white/40 hover:bg-white/5 hover:text-white/80'
          }`}
          title="Chat"
        >
          <MessageSquare size={20} />
        </button>
        <button
          onClick={() => setActiveTab('prompts')}
          className={`rounded-xl p-2.5 transition-all ${
            activeTab === 'prompts'
              ? 'bg-white/10 text-white shadow-sm'
              : 'text-white/40 hover:bg-white/5 hover:text-white/80'
          }`}
          title="Agents & Prompts"
        >
          <Sparkles size={20} />
        </button>
        <button
          onClick={() => setActiveTab('knowledge')}
          className={`rounded-xl p-2.5 transition-all ${
            activeTab === 'knowledge'
              ? 'bg-white/10 text-white shadow-sm'
              : 'text-white/40 hover:bg-white/5 hover:text-white/80'
          }`}
          title="Knowledge Base"
        >
          <Globe size={20} />
        </button>
        <button
          onClick={() => setActiveTab('sandbox')}
          className={`rounded-xl p-2.5 transition-all ${
            activeTab === 'sandbox'
              ? 'bg-white/10 text-white shadow-sm'
              : 'text-white/40 hover:bg-white/5 hover:text-white/80'
          }`}
          title="WebContainer Sandbox"
        >
          <Terminal size={20} />
        </button>

        <div className="flex-1" />

        <button
          className="rounded-xl p-2.5 text-white/40 transition-all hover:bg-white/5 hover:text-white/80"
          title="Theme"
        >
          <Sun size={20} />
        </button>
        <button
          onClick={() => openSettings('models')}
          className={`rounded-xl p-2.5 transition-all ${
            showSettings
              ? 'bg-white/10 text-white shadow-sm'
              : 'text-white/40 hover:bg-white/5 hover:text-white/80'
          }`}
          title="Settings"
        >
          <Settings size={20} />
        </button>
      </div>

      {activeTab === 'chat' && sidebarOpen ? (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 320, opacity: 1 }}
          className="flex flex-shrink-0 flex-col border-r border-white/10 bg-[#0A0A0F]"
        >
          <div className="space-y-3 p-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                Active Agent
              </div>
              <select
                value={activeAgentId ?? ''}
                onChange={(event) => activateAgent(event.target.value).catch(console.error)}
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id} className="bg-[#111111]">
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleCreateTopic}
              className="group flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 transition-colors hover:bg-white/10"
            >
              <span className="text-sm font-medium text-white/90">New Topic</span>
              <Plus size={16} className="text-white/50 transition-colors group-hover:text-white" />
            </button>

            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <Search size={15} className="text-white/35" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search topic titles and message content"
                className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/35"
              />
            </label>

            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-white/35">
              <span>{searchQuery.trim() ? 'Search Results' : 'Topics'}</span>
              <span>{fts5Enabled ? 'FTS5 ready' : 'Fallback search'}</span>
            </div>
          </div>

          <div className="flex-1 space-y-1 overflow-y-auto px-3 py-2 custom-scrollbar">
            {searchQuery.trim() ? (
              searchResults.length > 0 ? (
                searchResults.map((result) => (
                  <button
                    key={`${result.type}_${result.topicId}_${result.preview}`}
                    onClick={() => {
                      setSearchQuery('');
                      activateTopic(result.topicId).catch(console.error);
                    }}
                    className="w-full rounded-xl border border-transparent px-3 py-3 text-left text-white/70 transition-colors hover:border-white/10 hover:bg-white/5 hover:text-white"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium">{result.topicTitle}</span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/45">
                        {result.type}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-white/40">{result.agentName}</p>
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-white/45">
                      {result.preview}
                    </p>
                  </button>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-white/10 px-3 py-8 text-center text-sm text-white/35">
                  No matching topics or messages found.
                </div>
              )
            ) : topics.length > 0 ? (
              topics.map((topic) => (
                <button
                  key={topic.id}
                  onClick={() => activateTopic(topic.id).catch(console.error)}
                  className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                    activeTopicId === topic.id
                      ? 'border-white/10 bg-white/10 text-white'
                      : 'border-transparent bg-transparent text-white/60 hover:bg-white/5 hover:text-white/90'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium">{topic.title}</span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/45">
                      {topic.messageCount}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/40">
                    {topic.preview}
                  </p>
                </button>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 px-3 py-8 text-center text-sm text-white/35">
                No topics yet. Create one to start chatting with this agent.
              </div>
            )}
          </div>
        </motion.div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col bg-[#05050A]">
        {activeTab === 'chat' ? (
          <>
            <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-white/10 px-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSidebarOpen((previous) => !previous)}
                  className="rounded-lg p-1.5 text-white/60 transition-colors hover:bg-white/10"
                >
                  {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
                </button>
                <div className="flex min-w-0 items-center gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-sm font-semibold text-white">
                        {workspace?.topic.title ?? 'Loading topic...'}
                      </div>
                      {workspace ? (
                        <button
                          onClick={handleRenameTopic}
                          className="rounded-md p-1 text-white/35 transition-colors hover:bg-white/10 hover:text-white/80"
                          title="Rename topic"
                        >
                          <PencilLine size={14} />
                        </button>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-white/40">
                      {workspace?.agent.name ?? selectedAgent?.name ?? 'Loading agent...'} ·{' '}
                      {workspace?.agent.workspaceRelpath ?? selectedAgent?.workspaceRelpath ?? 'agents/...'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="rounded-lg border border-white/10 bg-white/5 px-2">
                  <select
                    value={`${config.activeProviderId}::${config.activeModel}`}
                    onChange={(event) => handleModelChange(event.target.value)}
                    className="bg-transparent py-2 text-sm text-white outline-none"
                  >
                    {enabledProviders.map((provider) =>
                      provider.models.map((model) => (
                        <option
                          key={`${provider.id}_${model}`}
                          value={`${provider.id}::${model}`}
                          className="bg-[#111111]"
                        >
                          {provider.name} · {model}
                        </option>
                      )),
                    )}
                  </select>
                </div>
                <button
                  onClick={() => setActiveTab('prompts')}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75 hover:bg-white/10 hover:text-white"
                >
                  Agent Library
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-hidden">
              {loadingWorkspace ? (
                <div className="flex h-full items-center justify-center text-sm text-white/40">
                  Loading agent workspace...
                </div>
              ) : !workspace ? (
                <div className="flex h-full items-center justify-center p-6">
                  <div className="w-full max-w-xl rounded-[28px] border border-white/10 bg-white/[0.03] p-6 text-white/80">
                    <div className="text-lg font-semibold text-white">Local workspace unavailable</div>
                    <p className="mt-3 text-sm leading-6 text-white/55">
                      {composerNotice ||
                        'The current topic could not be opened, but the rest of the interface is still available.'}
                    </p>
                    {bootstrapErrorDetails ? (
                      <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-red-200/80">
                          Bootstrap Error Details
                        </div>
                        <pre className="mt-3 whitespace-pre-wrap break-words text-xs leading-6 text-red-100/85">
                          {bootstrapErrorDetails}
                        </pre>
                      </div>
                    ) : null}
                    <div className="mt-5 flex flex-wrap gap-3">
                      <button
                        onClick={() => bootstrapWorkspace().catch(console.error)}
                        className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
                      >
                        Retry Workspace
                      </button>
                      <button
                        onClick={() => openSettings('data')}
                        className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
                      >
                        Open Settings
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full overflow-x-auto custom-scrollbar">
                  <div className="mx-auto grid min-h-full max-w-6xl gap-4 p-4 md:p-6">
                    <AgentLaneColumn
                      lane={{
                        id: workspace.agent.id,
                        name: workspace.agent.name,
                        description: workspace.agent.description,
                        model: workspace.agent.model,
                        accentColor: workspace.agent.accentColor,
                        position: 0,
                      }}
                      messages={workspace.messages}
                      isGenerating={isGenerating}
                      showTimestamps={config.ui.showTimestamps}
                      showToolResults={config.ui.showToolResults}
                      autoScroll={config.ui.autoScroll}
                      compact={config.ui.compactLanes}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="bg-gradient-to-t from-[#05050A] via-[#05050A] to-transparent p-4">
              <div className="mx-auto max-w-5xl">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-2 shadow-lg transition-all focus-within:border-white/30 focus-within:bg-white/10">
                  <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        handleSend().catch(console.error);
                      }
                    }}
                    placeholder={
                      selectedAgent ? `Message ${selectedAgent.name}...` : 'Message FlowAgent...'
                    }
                    className="min-h-[44px] max-h-[200px] w-full resize-none bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-white/40 custom-scrollbar"
                    rows={1}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={activeAgentId ?? ''}
                        onChange={(event) => activateAgent(event.target.value).catch(console.error)}
                        className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none"
                      >
                        {agents.map((agent) => (
                          <option key={agent.id} value={agent.id} className="bg-[#111111]">
                            {agent.name}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="rounded-lg p-2 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                        title="Import files into shared knowledge base"
                      >
                        <Paperclip size={18} />
                      </button>
                      <button
                        onClick={() => openSettings('search')}
                        className="rounded-lg p-2 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                        title="Search settings"
                      >
                        <Globe size={18} />
                      </button>
                      <button
                        onClick={() => setActiveTab('prompts')}
                        className="rounded-lg p-2 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                        title="Manage agents"
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                    <button
                      onClick={() => handleSend().catch(console.error)}
                      disabled={!input.trim() || isGenerating || !workspace}
                      className="rounded-xl bg-white p-2 text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Send size={18} className="ml-0.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/35">
                  <span>
                    {selectedAgent?.name ?? 'Agent'} ·{' '}
                    {config.memory.includeGlobalMemory ? 'Agent memory injected' : 'Agent memory paused'} · Shared knowledge base
                  </span>
                  <span>
                    {composerNotice || 'FlowAgent can make mistakes. Verify important output before shipping.'}
                  </span>
                </div>
              </div>
            </div>
          </>
        ) : activeTab === 'prompts' ? (
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center text-sm text-white/40">
                Loading agent library...
              </div>
            }
          >
            <PromptsPanel
              agents={agents}
              snippets={snippets}
              memoryDocuments={memoryDocuments}
              providers={enabledProviders}
              currentAgentId={activeAgentId}
              onSelectAgent={activateAgent}
              onSaveAgent={handleSaveAgent}
              onSaveMemoryDocument={handleSaveMemoryDocument}
              onDeleteMemoryDocument={handleDeleteMemoryDocument}
              onSaveSnippet={handleSaveSnippet}
              onUseSnippet={handleUseSnippet}
            />
          </Suspense>
        ) : activeTab === 'knowledge' ? (
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center text-sm text-white/40">
                Loading knowledge base...
              </div>
            }
          >
            <div className="flex flex-1 overflow-hidden">
              <KnowledgePanel onClose={() => setActiveTab('chat')} />
            </div>
          </Suspense>
        ) : (
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center text-sm text-white/40">
                Loading sandbox...
              </div>
            }
          >
            <div className="flex flex-1 overflow-hidden">
              <TerminalPanel onClose={() => setActiveTab('chat')} />
            </div>
          </Suspense>
        )}
      </div>

      {showSettings ? (
        <Suspense fallback={null}>
          <SettingsView
            config={config}
            agents={agents}
            activeAgentId={activeAgentId}
            initialCategory={settingsInitialCategory}
            onClose={() => setShowSettings(false)}
            onConfigSaved={(nextConfig) => setConfig(nextConfig)}
            onMemoryFilesChanged={(agentId) => {
              void handleMemoryFilesChanged(agentId);
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
};
