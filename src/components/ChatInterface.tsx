import React, { Suspense, lazy, startTransition, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Folder,
  Globe,
  MessageSquare,
  Paperclip,
  PanelLeft,
  PanelLeftClose,
  Plus,
  Send,
  Settings,
  Sparkles,
  Sun,
  Terminal,
} from 'lucide-react';
import { AgentLaneColumn } from './chat/AgentLaneColumn';
import {
  addConversationMessages,
  addDocument,
  addLaneToConversation,
  createConversation,
  getActiveConversationId,
  getConversationWorkspace,
  listAssistants,
  listConversations,
  listGlobalMemoryDocuments,
  listPromptSnippets,
  saveAssistant,
  savePromptSnippet,
  setActiveConversationId,
  type AssistantProfile,
  type ChatMessage,
  type ChatMessageInput,
  type ConversationSummary,
  type ConversationWorkspace,
  type PromptSnippet,
  updateConversationTitle,
} from '../lib/db';
import { type AgentConfig, getAgentConfig, saveAgentConfig } from '../lib/agent/config';
import { applyThemePreferences } from '../lib/theme';

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

function formatConversationPreview(preview: string) {
  return preview.replace(/\s+/g, ' ').trim() || 'No messages yet';
}

function inferConversationTitle(input: string) {
  const normalized = input
    .replace(/[#*_`>~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > 40 ? `${normalized.slice(0, 40).trim()}...` : normalized;
}

function mergeWorkspaceMessages(
  workspace: ConversationWorkspace | null,
  messages: ChatMessage[],
): ConversationWorkspace | null {
  if (!workspace || messages.length === 0) {
    return workspace;
  }

  const nextMessagesByLane = { ...workspace.messagesByLane };
  messages.forEach((message) => {
    const existing = nextMessagesByLane[message.laneId] ?? [];
    nextMessagesByLane[message.laneId] = [...existing, message];
  });

  return {
    ...workspace,
    messagesByLane: nextMessagesByLane,
    conversation: {
      ...workspace.conversation,
      lastMessageAt: messages[messages.length - 1]!.createdAt,
      preview: messages[messages.length - 1]!.content,
      updatedAt: messages[messages.length - 1]!.createdAt,
    },
  };
}

function toConversationMessage(message: ChatMessageInput): ChatMessage {
  return {
    id: message.id ?? createLocalId('message'),
    conversationId: message.conversationId,
    laneId: message.laneId,
    role: message.role,
    authorName: message.authorName,
    content: message.content,
    createdAt: message.createdAt ?? new Date().toISOString(),
    tools: message.tools,
  };
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

export const ChatInterface: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState<ChatTab>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialCategory, setSettingsInitialCategory] =
    useState<SettingsCategory>('models');
  const [input, setInput] = useState('');
  const [workspace, setWorkspace] = useState<ConversationWorkspace | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [assistants, setAssistants] = useState<AssistantProfile[]>([]);
  const [snippets, setSnippets] = useState<PromptSnippet[]>([]);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [activeConversationId, setActiveConversationIdState] = useState<string | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [generatingLaneIds, setGeneratingLaneIds] = useState<string[]>([]);
  const [composerNotice, setComposerNotice] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshLibrary = async () => {
    const [assistantRecords, snippetRecords] = await Promise.all([
      listAssistants(),
      listPromptSnippets(),
    ]);

    startTransition(() => {
      setAssistants(assistantRecords);
      setSnippets(snippetRecords);
    });
  };

  const refreshConversations = async (preferredConversationId?: string | null) => {
    const conversationRecords = await listConversations();
    const nextConversationId =
      preferredConversationId ??
      (await getActiveConversationId()) ??
      conversationRecords[0]?.id ??
      null;

    startTransition(() => {
      setConversations(conversationRecords);
      setActiveConversationIdState(nextConversationId);
    });

    if (!nextConversationId) {
      const created = await createConversation();
      startTransition(() => {
        setWorkspace(created);
        setActiveConversationIdState(created.conversation.id);
      });
      await refreshConversations(created.conversation.id);
    }
  };

  const loadWorkspace = async (conversationId: string) => {
    setLoadingWorkspace(true);
    const nextWorkspace = await getConversationWorkspace(conversationId);
    startTransition(() => {
      setWorkspace(nextWorkspace);
      setLoadingWorkspace(false);
    });
  };

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      try {
        const currentConfig = await getAgentConfig();
        if (cancelled) {
          return;
        }

        startTransition(() => {
          setConfig(currentConfig);
        });

        await Promise.all([refreshLibrary(), refreshConversations()]);
      } catch (error) {
        console.error('Failed to initialize chat workspace:', error);
      }
    };

    setup();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!config) {
      return;
    }
    applyThemePreferences(config);
  }, [config]);

  useEffect(() => {
    if (!activeConversationId) {
      return;
    }
    setActiveConversationId(activeConversationId).catch(console.error);
    loadWorkspace(activeConversationId).catch(console.error);
  }, [activeConversationId]);

  const openSettings = (category: SettingsCategory = 'models') => {
    setSettingsInitialCategory(category);
    setShowSettings(true);
  };

  const handleConversationSelect = async (conversationId: string) => {
    setComposerNotice('');
    startTransition(() => {
      setActiveConversationIdState(conversationId);
      setActiveTab('chat');
    });
  };

  const handleCreateConversation = async () => {
    const created = await createConversation();
    startTransition(() => {
      setWorkspace(created);
      setActiveConversationIdState(created.conversation.id);
      setActiveTab('chat');
    });
    await refreshConversations(created.conversation.id);
  };

  const handleModelChange = async (value: string) => {
    if (!config) {
      return;
    }
    const [providerId, model] = value.split('::');
    const nextConfig: AgentConfig = {
      ...config,
      activeProviderId: providerId,
      activeModel: model,
    };
    setConfig(nextConfig);
    await saveAgentConfig(nextConfig);
  };

  const handleSaveAssistant = async (draft: {
    id?: string;
    name: string;
    description: string;
    systemPrompt: string;
    providerId?: string;
    model?: string;
    accentColor: string;
    isDefault?: boolean;
  }) => {
    await saveAssistant({
      id: draft.id ?? '',
      name: draft.name,
      description: draft.description,
      systemPrompt: draft.systemPrompt,
      providerId: draft.providerId,
      model: draft.model,
      accentColor: draft.accentColor,
      isDefault: draft.isDefault,
    });
    setComposerNotice(`Saved assistant "${draft.name}".`);
    await refreshLibrary();
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

  const handleAddAssistantToConversation = async (assistantId: string) => {
    if (!workspace) {
      return;
    }

    const nextWorkspace = await addLaneToConversation(workspace.conversation.id, assistantId);
    startTransition(() => {
      setWorkspace(nextWorkspace);
      setActiveTab('chat');
    });
    await refreshConversations(workspace.conversation.id);
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
    setComposerNotice(`Imported ${entries.length} document${entries.length > 1 ? 's' : ''} into the knowledge base.`);
    event.target.value = '';
  };

  const handleSend = async () => {
    if (!workspace || !config || !input.trim() || generatingLaneIds.length > 0) {
      return;
    }

    const userContent = input.trim();
    const workspaceSnapshot = workspace;
    const configSnapshot = config;
    const timestamp = new Date().toISOString();
    const userMessages = workspaceSnapshot.lanes.map<ChatMessageInput>((lane) => ({
      id: createLocalId('message'),
      conversationId: workspaceSnapshot.conversation.id,
      laneId: lane.id,
      role: 'user',
      authorName: 'You',
      content: userContent,
      createdAt: timestamp,
    }));

    const optimisticUserMessages = userMessages.map(toConversationMessage);
    setWorkspace((previous) => mergeWorkspaceMessages(previous, optimisticUserMessages));
    setInput('');
    setComposerNotice('');
    setGeneratingLaneIds(workspaceSnapshot.lanes.map((lane) => lane.id));
    await addConversationMessages(userMessages);

    if (
      configSnapshot.memory.autoTitleFromFirstMessage &&
      workspaceSnapshot.conversation.title === 'New Conversation'
    ) {
      const nextTitle = inferConversationTitle(userContent);
      if (nextTitle) {
        await updateConversationTitle(workspaceSnapshot.conversation.id, nextTitle);
        setWorkspace((previous) =>
          previous
            ? {
                ...previous,
                conversation: {
                  ...previous.conversation,
                  title: nextTitle,
                },
              }
            : previous,
        );
      }
    }

    const runLane = async (laneId: string) => {
      const lane = workspaceSnapshot.lanes.find((entry) => entry.id === laneId);
      if (!lane) {
        return;
      }

      try {
        const [{ HumanMessage, AIMessage }, { createAgentRuntime }] = await Promise.all([
          import('@langchain/core/messages'),
          import('../lib/agent/runtime'),
        ]);

        const laneHistory = [
          ...(workspaceSnapshot.messagesByLane[lane.id] ?? []),
          optimisticUserMessages.find((message) => message.laneId === lane.id)!,
        ]
          .filter((message) => message.role === 'user' || message.role === 'assistant')
          .slice(-configSnapshot.memory.historyWindow);

        const lcMessages = laneHistory.map((message) =>
          message.role === 'user' ? new HumanMessage(message.content) : new AIMessage(message.content),
        );

        const globalMemoryContext = configSnapshot.memory.includeGlobalMemory
          ? (
              await listGlobalMemoryDocuments()
            )
              .map(
                (document) =>
                  `# ${document.title}\n${document.content.trim()}`,
              )
              .filter(Boolean)
              .join('\n\n')
              .slice(0, 4000)
          : '';

        const runtime = createAgentRuntime({
          config: configSnapshot,
          providerId: lane.providerId,
          model: lane.model,
          systemPrompt: [
            configSnapshot.systemPrompt,
            globalMemoryContext ? `Global memory:\n${globalMemoryContext}` : '',
            `Lane profile:\n${lane.systemPrompt}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        });

        const result = await runtime.invoke({ messages: lcMessages });
        const finalMessages = result.messages;
        const lastAssistantMessage = [...finalMessages]
          .reverse()
          .find((message) => message?._getType?.() === 'ai') as
          | { content: unknown }
          | undefined;

        if (!lastAssistantMessage) {
          throw new Error('The model did not return a final assistant message.');
        }

        const assistantMessage: ChatMessageInput = {
          id: createLocalId('message'),
          conversationId: workspaceSnapshot.conversation.id,
          laneId: lane.id,
          role: 'assistant',
          authorName: lane.name,
          content: stringifyMessageContent(lastAssistantMessage.content),
          createdAt: new Date().toISOString(),
          tools: extractToolUsage(finalMessages, lcMessages.length),
        };

        const optimisticAssistantMessage = toConversationMessage(assistantMessage);
        setWorkspace((previous) => mergeWorkspaceMessages(previous, [optimisticAssistantMessage]));
        await addConversationMessages([assistantMessage]);
      } catch (error: any) {
        const fallbackMessage: ChatMessageInput = {
          id: createLocalId('message'),
          conversationId: workspaceSnapshot.conversation.id,
          laneId: lane.id,
          role: 'assistant',
          authorName: lane.name,
          content: `**Lane error:** ${error.message}\n\nPlease check model credentials or the runtime configuration in Settings.`,
          createdAt: new Date().toISOString(),
        };
        setWorkspace((previous) => mergeWorkspaceMessages(previous, [toConversationMessage(fallbackMessage)]));
        await addConversationMessages([fallbackMessage]);
      } finally {
        setGeneratingLaneIds((previous) => previous.filter((entry) => entry !== lane.id));
      }
    };

    if (configSnapshot.assistant.fanoutMode === 'sequential') {
      for (const lane of workspaceSnapshot.lanes) {
        // eslint-disable-next-line no-await-in-loop
        await runLane(lane.id);
      }
    } else {
      await Promise.all(workspaceSnapshot.lanes.map((lane) => runLane(lane.id)));
    }

    await refreshConversations(workspaceSnapshot.conversation.id);
  };

  const laneCount = workspace?.lanes.length ?? 0;
  const enabledProviders = config?.providers.filter((provider) => provider.enabled) ?? [];

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
          title="Prompts & Assistants"
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
          <Folder size={20} />
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
          animate={{ width: 280, opacity: 1 }}
          className="flex flex-shrink-0 flex-col border-r border-white/10 bg-[#0A0A0F]"
        >
          <div className="p-4">
            <button
              onClick={handleCreateConversation}
              className="group flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 transition-colors hover:bg-white/10"
            >
              <span className="text-sm font-medium text-white/90">New Chat</span>
              <Plus size={16} className="text-white/50 transition-colors group-hover:text-white" />
            </button>
          </div>

          <div className="flex-1 space-y-1 overflow-y-auto px-3 py-2 custom-scrollbar">
            <div className="mb-2 mt-4 px-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">
              Conversations
            </div>

            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                onClick={() => handleConversationSelect(conversation.id)}
                className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                  activeConversationId === conversation.id
                    ? 'border-white/10 bg-white/10 text-white'
                    : 'border-transparent bg-transparent text-white/60 hover:bg-white/5 hover:text-white/90'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium">{conversation.title}</span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/45">
                    {conversation.laneCount} lane{conversation.laneCount > 1 ? 's' : ''}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/40">
                  {formatConversationPreview(conversation.preview)}
                </p>
              </button>
            ))}
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
                    <div className="truncate text-sm font-semibold text-white">
                      {workspace?.conversation.title ?? 'Loading workspace...'}
                    </div>
                    <div className="text-[11px] text-white/40">
                      {laneCount} active agent lane{laneCount === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="rounded-lg border border-white/10 bg-white/5 px-2">
                  <select
                    value={
                      config ? `${config.activeProviderId}::${config.activeModel}` : ''
                    }
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
                  Assistant Library
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-hidden">
              {loadingWorkspace || !workspace ? (
                <div className="flex h-full items-center justify-center text-sm text-white/40">
                  Loading conversation workspace...
                </div>
              ) : (
                <div className="h-full overflow-x-auto custom-scrollbar">
                  <div
                    className="grid min-h-full gap-4 p-4 md:p-6"
                    style={{
                      gridTemplateColumns: `repeat(${workspace.lanes.length}, minmax(${
                        config?.ui.laneMinWidth ?? 360
                      }px, 1fr))`,
                    }}
                  >
                    {workspace.lanes.map((lane) => (
                      <AgentLaneColumn
                        key={lane.id}
                        lane={lane}
                        messages={workspace.messagesByLane[lane.id] ?? []}
                        isGenerating={generatingLaneIds.includes(lane.id)}
                        showTimestamps={config?.ui.showTimestamps ?? true}
                        showToolResults={config?.ui.showToolResults ?? true}
                        autoScroll={config?.ui.autoScroll ?? true}
                        compact={config?.ui.compactLanes ?? false}
                      />
                    ))}
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
                        handleSend();
                      }
                    }}
                    placeholder={
                      laneCount > 1
                        ? `Message ${laneCount} agent lanes at once...`
                        : 'Message FlowAgent...'
                    }
                    className="min-h-[44px] max-h-[200px] w-full resize-none bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-white/40 custom-scrollbar"
                    rows={1}
                  />
                  <div className="flex items-center justify-between px-2 pt-2">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="rounded-lg p-2 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                        title="Import files into knowledge base"
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
                        title="Add another assistant lane"
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                    <button
                      onClick={handleSend}
                      disabled={!input.trim() || generatingLaneIds.length > 0 || !workspace}
                      className="rounded-xl bg-white p-2 text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Send size={18} className="ml-0.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/35">
                  <span>
                    {config?.assistant.fanoutMode === 'parallel'
                      ? 'Parallel fan-out'
                      : 'Sequential fan-out'}{' '}
                    · {laneCount} active lane{laneCount === 1 ? '' : 's'}
                  </span>
                  <span>{composerNotice || 'FlowAgent can make mistakes. Verify important output before shipping.'}</span>
                </div>
              </div>
            </div>
          </>
        ) : activeTab === 'prompts' ? (
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center text-sm text-white/40">
                Loading assistant library...
              </div>
            }
          >
            <PromptsPanel
              assistants={assistants}
              snippets={snippets}
              providers={enabledProviders}
              currentConversationId={workspace?.conversation.id}
              onAddAssistantToConversation={handleAddAssistantToConversation}
              onSaveAssistant={handleSaveAssistant}
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

      {showSettings && config ? (
        <Suspense fallback={null}>
          <SettingsView
            config={config}
            initialCategory={settingsInitialCategory}
            onClose={() => setShowSettings(false)}
            onConfigSaved={(nextConfig) => setConfig(nextConfig)}
          />
        </Suspense>
      ) : null}
    </div>
  );
};
