import React, { Suspense, lazy, startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  ChevronDown,
  ChevronRight,
  Cloud,
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
  X,
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
  createQuickTopic,
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
import { syncProjectKnowledgeDocuments } from '../lib/project-knowledge';
import { TimeoutError, withSoftTimeout } from '../lib/async-timeout';
import { formatErrorDetails, wrapErrorWithContext } from '../lib/error-details';
import { registerConfiguredAgentMemoryFileStore } from '../lib/agent-memory-api';
import { buildModelGroups } from '../lib/model-groups';
import { isAIMessageChunk } from '@langchain/core/messages';
import { subscribeProjectKnowledgeEvents } from '../lib/project-knowledge-api';
import { getRelevantSkillContext, syncAgentSkillDocuments } from '../lib/agent-skills';

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

function upsertWorkspaceMessage(
  workspace: TopicWorkspace | null,
  message: TopicMessage,
): TopicWorkspace | null {
  if (!workspace) {
    return workspace;
  }

  const existingIndex = workspace.messages.findIndex((entry) => entry.id === message.id);
  const nextMessages =
    existingIndex >= 0
      ? workspace.messages.map((entry, index) => (index === existingIndex ? message : entry))
      : [...workspace.messages, message];
  const lastMessage = nextMessages[nextMessages.length - 1]!;

  return {
    ...workspace,
    messages: nextMessages,
    topic: {
      ...workspace.topic,
      preview: lastMessage.content.replace(/\s+/g, ' ').trim() || workspace.topic.preview,
      updatedAt: lastMessage.createdAt,
      lastMessageAt: lastMessage.createdAt,
      messageCount: nextMessages.length,
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

interface TopicRunState {
  isGenerating: boolean;
  composerNotice: string;
  draftAssistantMessage?: TopicMessage;
}

const WORKSPACE_BOOT_SOFT_TIMEOUT_MS = 8000;
const WORKSPACE_BOOT_HARD_TIMEOUT_MS = 45000;

export const ChatInterface: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState<ChatTab>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
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
  const [shellNotice, setShellNotice] = useState('');
  const [bootstrapErrorDetails, setBootstrapErrorDetails] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<WorkspaceSearchResult[]>([]);
  const [fts5Enabled, setFts5Enabled] = useState(false);
  const [modelPickerProviderId, setModelPickerProviderId] = useState<string>('');
  const [modelPickerProviderQuery, setModelPickerProviderQuery] = useState('');
  const [modelPickerSearchQuery, setModelPickerSearchQuery] = useState('');
  const [collapsedPickerGroups, setCollapsedPickerGroups] = useState<Record<string, boolean>>({});
  const [collapsedPickerSeries, setCollapsedPickerSeries] = useState<Record<string, boolean>>({});
  const [topicRunStates, setTopicRunStates] = useState<Record<string, TopicRunState>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectKnowledgeVersionRef = useRef('');

  const selectedAgent =
    workspace?.agent ?? agents.find((entry) => entry.id === activeAgentId) ?? null;
  const activeRunState = activeTopicId ? topicRunStates[activeTopicId] : undefined;
  const isGenerating = activeRunState?.isGenerating ?? false;
  const composerNotice = activeRunState?.composerNotice ?? shellNotice;

  const setTopicRunState = (topicId: string, updater: (previous: TopicRunState | undefined) => TopicRunState) => {
    setTopicRunStates((previous) => ({
      ...previous,
      [topicId]: updater(previous[topicId]),
    }));
  };

  const clearTopicRunState = (topicId: string) => {
    setTopicRunStates((previous) => {
      if (!(topicId in previous)) {
        return previous;
      }
      const next = { ...previous };
      delete next[topicId];
      return next;
    });
  };

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

  const refreshTopicList = async (agentId: string) => {
    const records = await listTopics(agentId);
    startTransition(() => {
      setTopics(records);
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
    const draftAssistantMessage = topicRunStates[topicId]?.draftAssistantMessage;
    const hydratedWorkspace = {
      ...nextWorkspace,
      memoryDocuments: memoryRecords,
    };

    startTransition(() => {
      setWorkspace(
        draftAssistantMessage ? upsertWorkspaceMessage(hydratedWorkspace, draftAssistantMessage) : hydratedWorkspace,
      );
      setTopics(topicRecords);
      setMemoryDocuments(memoryRecords);
      setActiveAgentIdState(nextWorkspace.agent.id);
      setActiveTopicIdState(nextWorkspace.topic.id);
      setLoadingWorkspace(false);
    });
  };

  const bootstrapWorkspace = async () => {
    setLoadingWorkspace(true);
    setShellNotice('');
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
              setShellNotice(
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
          setShellNotice(
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
              setShellNotice(
                'Loading the current topic is taking longer than usual. FlowAgent is still waiting on local workspace data.',
              );
            });
          },
          hardTimeoutMessage: 'Timed out while loading the current topic.',
        },
      );
      setShellNotice('');
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
        setShellNotice(
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
    setShellNotice('');
    setActiveTab('chat');
  };

  const activateTopic = async (topicId: string) => {
    await hydrateTopic(topicId);
    setShellNotice('');
    setActiveTab('chat');
  };

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      let currentConfig = normalizeAgentConfig();
      try {
        currentConfig = await getAgentConfig();
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
          void syncProjectKnowledgeDocuments(currentConfig.apiServer).then((result) => {
            projectKnowledgeVersionRef.current = result.version;
          }).catch((error) => {
            console.warn('Project knowledge sync failed after bootstrap:', error);
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
    if (!config.apiServer.enabled) {
      return undefined;
    }

    let cancelled = false;
    const unsubscribe = subscribeProjectKnowledgeEvents(config.apiServer, {
      onStatus(status) {
        if (cancelled || status.version === projectKnowledgeVersionRef.current) {
          return;
        }
        void syncProjectKnowledgeDocuments(config.apiServer)
          .then((result) => {
            if (!cancelled) {
              projectKnowledgeVersionRef.current = result.version;
            }
          })
          .catch((error) => {
            console.warn('Project knowledge event sync failed:', error);
          });
      },
      onError(error) {
        console.warn(error.message);
      },
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [config.apiServer]);

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

  const handleCreateQuickTopic = async () => {
    const targetAgentId = activeAgentId ?? agents[0]?.id;
    if (!targetAgentId) {
      return;
    }

    const title = globalThis.prompt('快速会话标题', 'Quick Chat')?.trim() || 'Quick Chat';
    const displayName = globalThis.prompt('快速会话身份名', 'Quick Assistant')?.trim() || 'Quick Assistant';
    const systemPromptOverride =
      globalThis.prompt('快速会话系统提示词', 'You are a concise, helpful assistant.')?.trim() ||
      'You are a concise, helpful assistant.';

    const created = await createQuickTopic({
      agentId: targetAgentId,
      title,
      displayName,
      systemPromptOverride,
      providerIdOverride: config.activeProviderId,
      modelOverride: config.activeModel,
    });
    await activateTopic(created.id);
    setShellNotice(`Created quick session "${created.title}".`);
  };

  const handleModelChange = async (value: string) => {
    const [providerId, model] = value.split('::');
    const nextConfig: AgentConfig = {
      ...config,
      activeProviderId: providerId,
      activeModel: model,
    };
    setConfig(nextConfig);
    try {
      await saveAgentConfig(nextConfig);
    } catch (error) {
      setShellNotice(error instanceof Error ? error.message : '配置未能写入 config.json。');
    }
  };

  const handleModelSelection = async (providerId: string, model: string) => {
    await handleModelChange(`${providerId}::${model}`);
    setShowModelPicker(false);
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
    setShellNotice(`Saved agent "${saved.name}".`);
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
    setShellNotice(`Updated memory for ${selectedAgent?.name ?? 'the current agent'}.`);
    await refreshMemory(activeAgentId);
  };

  const handleDeleteMemoryDocument = async (memoryId: string) => {
    if (!activeAgentId) {
      return;
    }

    await deleteAgentMemoryDocument(memoryId);
    setShellNotice(`Removed an agent memory entry.`);
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
    setShellNotice(`Saved snippet "${draft.title}".`);
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
    setShellNotice(
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
    setShellNotice(`Renamed topic to "${nextTitle.trim() || workspace.topic.title}".`);
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
    setTopicRunState(workspaceSnapshot.topic.id, () => ({
      isGenerating: true,
      composerNotice: '',
    }));
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

      const includeAgentSharedShortTerm =
        workspaceSnapshot.runtime.enableAgentSharedShortTerm || configSnapshot.memory.enableAgentSharedShortTerm;
      const memoryContext = workspaceSnapshot.runtime.enableMemory && configSnapshot.memory.enableAgentLongTerm
        ? (
            await getAgentMemoryContext(workspaceSnapshot.agent.id, {
              includeRecentMemorySnapshot: configSnapshot.memory.includeRecentMemorySnapshot,
              query: userContent,
              topicId: workspaceSnapshot.topic.id,
              includeSessionMemory: configSnapshot.memory.enableSessionMemory,
              includeAgentSharedShortTerm,
            })
          ).slice(0, 4000)
        : '';
      if (workspaceSnapshot.runtime.enableSkills && configSnapshot.apiServer.enabled) {
        await syncAgentSkillDocuments(workspaceSnapshot.agent.id, configSnapshot.apiServer).catch((error) => {
          console.warn('Agent skill sync failed before send:', error);
        });
      }
      const skillContext = workspaceSnapshot.runtime.enableSkills
        ? (
            await getRelevantSkillContext(workspaceSnapshot.agent.id, userContent, {
              maxResults: 4,
              maxChars: 420,
            })
          ).slice(0, 2400)
        : '';

      const runtime = createAgentRuntime({
        config: configSnapshot,
        providerId: workspaceSnapshot.runtime.providerId,
        model: workspaceSnapshot.runtime.model,
        enableTools: workspaceSnapshot.runtime.enableTools,
        systemPrompt: [
          configSnapshot.systemPrompt,
          memoryContext ? `Agent memory:\n${memoryContext}` : '',
          skillContext ? skillContext : '',
          `Session identity:\n${workspaceSnapshot.runtime.systemPrompt}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      });

      const stream = await runtime.stream(
        { messages: lcMessages },
        { streamMode: ['messages', 'values'] },
      );

      let lastValuesState: { messages?: any[] } | null = null;
      let assistantDraftId = createLocalId('message');
      let streamedAssistantContent = '';

      for await (const chunk of stream) {
        if (!Array.isArray(chunk) || chunk.length < 2) {
          continue;
        }

        const [mode, payload] = chunk as unknown as [string, any];
        if (mode === 'values') {
          lastValuesState = payload;
          continue;
        }

        if (mode !== 'messages' || !Array.isArray(payload)) {
          continue;
        }

        const [message] = payload;
        if (!message || message?._getType?.() !== 'ai') {
          continue;
        }

        if (typeof message.id === 'string' && message.id.trim()) {
          assistantDraftId = message.id;
        }

        if (isAIMessageChunk(message)) {
          streamedAssistantContent += stringifyMessageContent(message.content);
        } else {
          streamedAssistantContent = stringifyMessageContent(message.content);
        }

        const optimisticAssistantMessage = toTopicMessage({
          id: assistantDraftId,
          topicId: workspaceSnapshot.topic.id,
          agentId: workspaceSnapshot.agent.id,
          role: 'assistant',
          authorName: workspaceSnapshot.runtime.displayName,
          content: streamedAssistantContent,
          createdAt: new Date().toISOString(),
        });
        setTopicRunState(workspaceSnapshot.topic.id, (previous) => ({
          isGenerating: true,
          composerNotice: previous?.composerNotice ?? '',
          draftAssistantMessage: optimisticAssistantMessage,
        }));
        setWorkspace((previous) =>
          previous?.topic.id === workspaceSnapshot.topic.id
            ? upsertWorkspaceMessage(previous, optimisticAssistantMessage)
            : previous,
        );
      }

      const finalMessages = lastValuesState?.messages ?? [];
      const lastAssistantMessage = [...finalMessages]
        .reverse()
        .find((message) => message?._getType?.() === 'ai') as { id?: string; content: unknown } | undefined;

      if (!lastAssistantMessage) {
        throw new Error('The model did not return a final assistant message.');
      }

      const assistantMessage: TopicMessageInput = {
        id: lastAssistantMessage.id ?? assistantDraftId,
        topicId: workspaceSnapshot.topic.id,
        agentId: workspaceSnapshot.agent.id,
        role: 'assistant',
        authorName: workspaceSnapshot.runtime.displayName,
        content: stringifyMessageContent(lastAssistantMessage.content),
        createdAt: new Date().toISOString(),
        tools: extractToolUsage(finalMessages, lcMessages.length),
      };

      setWorkspace((previous) => upsertWorkspaceMessage(previous, toTopicMessage(assistantMessage)));
      await addTopicMessages([assistantMessage]);
    } catch (error: any) {
      const fallbackMessage: TopicMessageInput = {
        id: createLocalId('message'),
        topicId: workspaceSnapshot.topic.id,
        agentId: workspaceSnapshot.agent.id,
        role: 'assistant',
        authorName: workspaceSnapshot.runtime.displayName,
        content: `**Agent error:** ${error.message}\n\nPlease check model credentials or the runtime configuration in Settings.`,
        createdAt: new Date().toISOString(),
      };
      setWorkspace((previous) => mergeWorkspaceMessages(previous, [toTopicMessage(fallbackMessage)]));
      await addTopicMessages([fallbackMessage]);
    } finally {
      clearTopicRunState(workspaceSnapshot.topic.id);
      void refreshTopicList(workspaceSnapshot.agent.id).catch(console.error);
    }
  };

  const enabledProviders = config.providers.filter((provider) => provider.enabled);
  const filteredModelPickerProviders = useMemo(
    () =>
      enabledProviders.filter((provider) =>
        provider.name.toLowerCase().includes(modelPickerProviderQuery.trim().toLowerCase()),
      ),
    [enabledProviders, modelPickerProviderQuery],
  );
  const modelPickerProvider =
    enabledProviders.find((provider) => provider.id === modelPickerProviderId) ?? enabledProviders[0] ?? null;
  const modelPickerGroups = useMemo(
    () => (modelPickerProvider ? buildModelGroups(modelPickerProvider, modelPickerSearchQuery) : { totalCount: 0, groups: [] }),
    [modelPickerProvider, modelPickerSearchQuery],
  );

  useEffect(() => {
    if (!enabledProviders.length) {
      setModelPickerProviderId('');
      return;
    }

    setModelPickerProviderId((current) =>
      enabledProviders.some((provider) => provider.id === current) ? current : config.activeProviderId || enabledProviders[0]!.id,
    );
  }, [enabledProviders, config.activeProviderId]);

  useEffect(() => {
    if (!showModelPicker) {
      setModelPickerProviderQuery('');
      setModelPickerSearchQuery('');
      setCollapsedPickerGroups({});
      setCollapsedPickerSeries({});
    }
  }, [showModelPicker]);

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
          animate={{ width: 272, opacity: 1 }}
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

            <div className="grid gap-2">
              <button
                onClick={handleCreateTopic}
                className="group flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 transition-colors hover:bg-white/10"
              >
                <span className="text-sm font-medium text-white/90">New Topic</span>
                <Plus size={16} className="text-white/50 transition-colors group-hover:text-white" />
              </button>
              <button
                onClick={handleCreateQuickTopic}
                className="group flex w-full items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3 transition-colors hover:bg-white/10"
              >
                <span className="text-sm font-medium text-white/80">Quick Topic</span>
                <Sparkles size={16} className="text-white/45 transition-colors group-hover:text-white" />
              </button>
            </div>

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
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">{topic.title}</span>
                      {topic.sessionMode === 'quick' ? (
                        <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200/80">
                          Quick
                        </span>
                      ) : null}
                    </div>
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
                      {workspace?.topic.sessionMode === 'quick' ? (
                        <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200/80">
                          Quick
                        </span>
                      ) : null}
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
                      {workspace?.runtime.displayName ?? workspace?.agent.name ?? selectedAgent?.name ?? 'Loading agent...'} ·{' '}
                      {workspace?.agent.workspaceRelpath ?? selectedAgent?.workspaceRelpath ?? 'agents/...'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setModelPickerProviderId(config.activeProviderId);
                    setShowModelPicker(true);
                  }}
                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <span className="max-w-[260px] truncate">
                    {(enabledProviders.find((provider) => provider.id === config.activeProviderId)?.name ?? 'Model')}
                    {' · '}
                    {config.activeModel}
                  </span>
                  <ChevronDown size={14} className="text-white/45" />
                </button>
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
                  <div className="mx-auto grid min-h-full w-full max-w-[1180px] gap-4 p-4 md:p-6">
                    <AgentLaneColumn
                      lane={{
                        id: workspace.agent.id,
                        name: workspace.runtime.displayName,
                        description: workspace.agent.description,
                        model: workspace.runtime.model,
                        accentColor: workspace.agent.accentColor,
                        position: 0,
                      }}
                      messages={workspace.messages}
                      isGenerating={isGenerating}
                      showTimestamps={config.ui.showTimestamps}
                      showToolResults={config.ui.showToolResults}
                      autoScroll={config.ui.autoScroll}
                      compact={config.ui.compactLanes}
                      scrollKey={workspace.topic.id}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="bg-gradient-to-t from-[#05050A] via-[#05050A] to-transparent p-4">
              <div className="mx-auto w-full max-w-[1120px]">
                <div className="rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-2.5 shadow-[0_18px_50px_rgba(0,0,0,0.32)] transition-all focus-within:border-white/20 focus-within:bg-[linear-gradient(180deg,rgba(255,255,255,0.09),rgba(255,255,255,0.04))]">
                  <div className="mb-2 flex flex-wrap items-center gap-2 px-2 pb-2">
                    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-white/65">
                      {workspace.runtime.displayName}
                    </span>
                    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-white/50">
                      {workspace.runtime.model ?? config.activeModel}
                    </span>
                    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-white/50">
                      {config.memory.includeGlobalMemory ? '记忆注入已开启' : '记忆注入已暂停'}
                    </span>
                  </div>
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
                      workspace ? `Message ${workspace.runtime.displayName}...` : 'Message FlowAgent...'
                    }
                    className="min-h-[56px] max-h-[220px] w-full resize-none bg-transparent px-3 py-2 text-sm leading-7 text-white outline-none placeholder:text-white/40 custom-scrollbar"
                    rows={1}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-2 pt-2.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <select
                        value={activeAgentId ?? ''}
                        onChange={(event) => activateAgent(event.target.value).catch(console.error)}
                        className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none"
                      >
                        {agents.map((agent) => (
                          <option key={agent.id} value={agent.id} className="bg-[#111111]">
                            {agent.name}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="rounded-xl border border-transparent p-2 text-white/40 transition-colors hover:border-white/10 hover:bg-white/10 hover:text-white"
                        title="Import files into shared knowledge base"
                      >
                        <Paperclip size={18} />
                      </button>
                      <button
                        onClick={() => openSettings('search')}
                        className="rounded-xl border border-transparent p-2 text-white/40 transition-colors hover:border-white/10 hover:bg-white/10 hover:text-white"
                        title="Search settings"
                      >
                        <Globe size={18} />
                      </button>
                      <button
                        onClick={() => setActiveTab('prompts')}
                        className="rounded-xl border border-transparent p-2 text-white/40 transition-colors hover:border-white/10 hover:bg-white/10 hover:text-white"
                        title="Manage agents"
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                    <button
                      onClick={() => handleSend().catch(console.error)}
                      disabled={!input.trim() || isGenerating || !workspace}
                      className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Send size={18} className="ml-0.5" />
                      发送
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-white/35">
                  <span>{selectedAgent?.name ?? 'Agent'} · Shared knowledge base</span>
                  <span className="max-w-[70ch] truncate">{composerNotice || 'FlowAgent can make mistakes. Verify important output before shipping.'}</span>
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

      {showModelPicker ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm">
          <div className="flex h-[78vh] min-h-[560px] w-full max-w-[1080px] overflow-hidden rounded-[30px] border border-white/10 bg-[#171717] shadow-2xl">
            <div className="flex w-64 flex-col border-r border-white/5 bg-[#141414]">
              <div className="border-b border-white/5 px-4 py-4">
                <div className="text-sm font-semibold text-white">选择模型服务</div>
                <div className="mt-1 text-[11px] text-white/40">先选 provider，再选具体模型</div>
                <div className="relative mt-3">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
                  <input
                    type="text"
                    value={modelPickerProviderQuery}
                    onChange={(event) => setModelPickerProviderQuery(event.target.value)}
                    placeholder="搜索 provider..."
                    className="w-full rounded-full border border-white/10 bg-black/20 py-2 pl-8 pr-3 text-xs text-white focus:border-emerald-500/50 focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex-1 space-y-1 overflow-y-auto p-2 custom-scrollbar">
                {filteredModelPickerProviders.map((provider) => (
                  <button
                    key={provider.id}
                    onClick={() => {
                      setModelPickerProviderId(provider.id);
                      setCollapsedPickerGroups({});
                      setCollapsedPickerSeries({});
                    }}
                    className={`flex w-full cursor-pointer items-center justify-between rounded-2xl border px-3 py-3 text-left transition-all duration-150 ${
                      modelPickerProviderId === provider.id
                        ? 'border-emerald-500/25 bg-[linear-gradient(180deg,rgba(16,185,129,0.16),rgba(255,255,255,0.05))] text-white shadow-[0_12px_28px_rgba(16,185,129,0.14)]'
                        : 'border-white/5 text-white/65 hover:border-white/12 hover:bg-white/[0.08] hover:text-white hover:shadow-[0_10px_24px_rgba(0,0,0,0.22)]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{provider.name}</div>
                      <div className="text-[11px] text-white/35">
                        {provider.models.length} 个模型
                        {modelPickerProviderId === provider.id ? ' · 当前浏览' : ''}
                      </div>
                    </div>
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400/15 to-emerald-600/15">
                      <Cloud size={14} className="text-emerald-300" />
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-start justify-between gap-4 border-b border-white/5 px-6 py-5">
                <div>
                  <div className="text-lg font-semibold text-white">选择聊天模型</div>
                  <div className="mt-1 text-sm text-white/50">
                    {modelPickerProvider ? `${modelPickerProvider.name} · ${modelPickerGroups.totalCount} 个结果` : '暂无可用模型服务'}
                  </div>
                </div>
                <button
                  onClick={() => setShowModelPicker(false)}
                  className="rounded-full p-2 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex min-h-0 flex-1 flex-col px-6 py-5">
                <div className="mb-4 flex flex-col gap-3 rounded-[24px] border border-white/5 bg-black/10 p-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-sm font-medium text-white/90">按厂商与系列前缀浏览</div>
                    <div className="text-[11px] text-white/40">
                      模型过多时，先定位 provider，再按系列选择具体模型。
                    </div>
                  </div>
                  <div className="relative w-full md:max-w-xs">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                    <input
                      type="text"
                      value={modelPickerSearchQuery}
                      onChange={(event) => setModelPickerSearchQuery(event.target.value)}
                      placeholder="搜索模型名称..."
                      className="w-full rounded-full border border-white/10 bg-black/20 py-2 pl-9 pr-4 text-sm text-white focus:border-emerald-500/50 focus:outline-none"
                    />
                  </div>
                </div>

                {modelPickerProvider ? (
                  <div className="mb-4 rounded-[22px] border border-emerald-500/15 bg-[linear-gradient(180deg,rgba(16,185,129,0.14),rgba(255,255,255,0.03))] p-4 shadow-[0_16px_32px_rgba(16,185,129,0.08)]">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/65">Current Model</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/75">
                        {modelPickerProvider.name}
                      </span>
                      <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-100">
                        {config.activeModel}
                      </span>
                    </div>
                  </div>
                ) : null}

                <div className="min-h-0 flex-1 overflow-y-auto pr-1 custom-scrollbar">
                  {!modelPickerProvider ? (
                    <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-4 py-12 text-center text-sm text-white/40">
                      当前没有启用的模型服务。
                    </div>
                  ) : modelPickerGroups.groups.length === 0 ? (
                    <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-4 py-12 text-center text-sm text-white/40">
                      没有匹配的模型。
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {modelPickerGroups.groups.map((group) => {
                        const collapsed = collapsedPickerGroups[group.id] ?? false;

                        return (
                          <div key={group.id} className="rounded-2xl border border-white/5 bg-white/[0.03] p-2">
                            <button
                              onClick={() =>
                                setCollapsedPickerGroups((current) => ({
                                  ...current,
                                  [group.id]: !collapsed,
                                }))
                              }
                              className="flex w-full items-center justify-between rounded-[18px] px-3 py-2 text-left transition-colors hover:bg-white/5"
                            >
                              <div className="flex items-center gap-3">
                                <div className="flex h-8 w-8 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-400/15 to-red-500/15">
                                  {collapsed ? (
                                    <ChevronRight size={15} className="text-orange-300" />
                                  ) : (
                                    <ChevronDown size={15} className="text-orange-300" />
                                  )}
                                </div>
                                <div>
                                  <div className="text-sm font-medium text-white/90">{group.label}</div>
                                  <div className="text-[11px] text-white/40">
                                    {group.series.length} 个系列 · {group.totalCount} 个模型
                                  </div>
                                </div>
                              </div>
                              <div className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/45">
                                {group.totalCount}
                              </div>
                            </button>

                            {!collapsed ? (
                              <div className="mt-2 space-y-3 px-1 pb-1">
                                {group.series.map((series) => {
                                  const seriesCollapsed = collapsedPickerSeries[series.id] ?? false;

                                  return (
                                    <div key={series.id} className="rounded-[18px] border border-white/5 bg-black/10 p-3">
                                      <button
                                        onClick={() =>
                                          setCollapsedPickerSeries((current) => ({
                                            ...current,
                                            [series.id]: !seriesCollapsed,
                                          }))
                                        }
                                        className="flex w-full items-center justify-between gap-3 rounded-[14px] px-1 py-1 text-left transition-colors hover:bg-white/5"
                                      >
                                        <div className="flex min-w-0 items-center gap-3">
                                          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-2xl bg-white/5">
                                            {seriesCollapsed ? (
                                              <ChevronRight size={14} className="text-white/55" />
                                            ) : (
                                              <ChevronDown size={14} className="text-white/55" />
                                            )}
                                          </div>
                                          <div className="min-w-0">
                                            <div className="truncate text-sm font-medium text-white/85">
                                              {series.label}
                                            </div>
                                            <div className="text-[11px] text-white/35">系列分组</div>
                                          </div>
                                        </div>
                                        <div className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/45">
                                          {series.models.length}
                                        </div>
                                      </button>

                                      {!seriesCollapsed ? (
                                        <div className="mt-2 space-y-2">
                                          {series.models.map((model) => {
                                            const active =
                                              modelPickerProvider.id === config.activeProviderId &&
                                              model === config.activeModel;

                                            return (
                                              <button
                                                key={model}
                                                onClick={() =>
                                                  handleModelSelection(modelPickerProvider.id, model).catch(console.error)
                                                }
                                                className={`group flex w-full cursor-pointer items-center justify-between rounded-xl border p-3 text-left transition-all duration-150 ${
                                                  active
                                                    ? 'border-emerald-400/35 bg-[linear-gradient(180deg,rgba(16,185,129,0.18),rgba(255,255,255,0.04))] shadow-[0_14px_34px_rgba(16,185,129,0.16)]'
                                                    : 'border-white/5 bg-white/5 hover:border-white/12 hover:bg-white/[0.11] hover:shadow-[0_12px_28px_rgba(0,0,0,0.22)]'
                                                }`}
                                              >
                                                <div className="min-w-0">
                                                  <div className="truncate text-sm font-medium text-white/92">
                                                    {model}
                                                  </div>
                                                  <div className="mt-1 flex items-center gap-2 text-[11px] text-white/38">
                                                    <span>{modelPickerProvider.name}</span>
                                                    <span className="h-1 w-1 rounded-full bg-white/20" />
                                                    <span>{active ? '当前使用中' : '点击切换'}</span>
                                                  </div>
                                                </div>
                                                <div className="ml-4 flex flex-shrink-0 items-center">
                                                  <div
                                                    className={`h-2.5 w-2.5 rounded-full transition-all ${
                                                      active
                                                        ? 'bg-emerald-300 shadow-[0_0_18px_rgba(52,211,153,0.65)]'
                                                        : 'bg-white/18 group-hover:bg-white/38'
                                                    }`}
                                                  />
                                                </div>
                                              </button>
                                            );
                                          })}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
