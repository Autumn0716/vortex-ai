import React, { Suspense, lazy, startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  House,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Cloud,
  Globe,
  GitBranch,
  MessageSquare,
  PanelLeft,
  PanelLeftClose,
  PencilLine,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  Terminal,
  X,
} from 'lucide-react';
import { AgentLaneColumn } from './chat/AgentLaneColumn';
import { ChatComposer, type ComposerAppendRequest } from './chat/ChatComposer';
import {
  PromptInspectorDialog,
  type PromptInspectorSnapshot,
} from './chat/PromptInspectorDialog';
import {
  addDocument,
  getTokenUsageSummary,
  listPromptSnippets,
  listTopicTokenUsage,
  recordAuditLog,
  recordKnowledgeEvidenceFeedback,
  recordTokenUsage,
  savePromptSnippet,
  type PromptSnippet,
  type TokenUsageSummary,
} from '../lib/db';
import {
  addTopicMessages,
  buildTopicSessionSummary,
  compileTaskGraphFromTopic,
  createBranchTopicFromTopic,
  createQuickTopic,
  createTopic,
  deleteTopicMessage,
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
  refreshTopicSessionSummary,
  handoffBranchTopicToParent,
  saveAgent,
  saveAgentMemoryDocument,
  searchWorkspace,
  type AgentMemoryDocument,
  type AgentProfile,
  type TopicModelFeatures,
  type TopicMessage,
  type TopicMessageAttachment,
  type TopicMessageInput,
  type TopicSummary,
  type TopicWorkspace,
  type WorkspaceSearchResult,
  getDefaultTopicModelFeatures,
  updateTopicModelFeatures,
  updateTopicSessionSettings,
  updateTopicTitle,
  type TopicSessionSummaryBuilderInput,
} from '../lib/agent-workspace';
import {
  type AgentConfig,
  type ModelProvider,
  getAgentConfig,
  normalizeAgentConfig,
  saveAgentConfig,
} from '../lib/agent/config';
import { normalizeBaseUrl } from '../lib/provider-compatibility';
import { applyThemePreferences } from '../lib/theme';
import { syncProjectKnowledgeDocuments } from '../lib/project-knowledge';
import { TimeoutError, withSoftTimeout } from '../lib/async-timeout';
import { formatErrorDetails, wrapErrorWithContext } from '../lib/error-details';
import { describeChangedFields } from '../lib/audit-log-changes';
import {
  inspectOfficialModelMetadata as inspectOfficialModelMetadataViaApi,
  listStoredModelMetadata,
  registerConfiguredAgentMemoryFileStore,
  type OfficialModelMetadataResponse,
} from '../lib/agent-memory-api';
import { buildModelGroups, buildProviderGroups, getProviderProtocolMeta } from '../lib/model-groups';
import { subscribeProjectKnowledgeEvents } from '../lib/project-knowledge-api';
import { getRelevantSkillContext, syncAgentSkillDocuments } from '../lib/agent-skills';
import {
  estimateAttachmentTokens,
  estimateTextTokens,
  estimateMessageTokens,
  estimateSessionContextTokens,
  splitBudgetedRecentItems,
  stringifyMessageForTokenEstimate,
} from '../lib/session-context-budget';
import {
  WEB_RUNTIME_CAPABILITIES,
  type RuntimeCapabilityProfile,
} from '../lib/runtime-capabilities';
import { buildAgentMemoryContextRequest } from '../lib/chat-runtime-memory';
import type { KnowledgeEvidenceFeedbackValue, KnowledgeEvidenceResult } from '../lib/knowledge-evidence-feedback';

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
    attachments: message.attachments,
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

function resolveMessageHistoryTokenBudget(input?: { maxInputTokens?: number; contextWindow?: number }) {
  const sourceLimit = input?.maxInputTokens ?? input?.contextWindow;
  if (!sourceLimit || sourceLimit <= 0) {
    return undefined;
  }
  const ratio = input?.maxInputTokens ? 0.6 : 0.45;
  return Math.max(2000, Math.floor(sourceLimit * ratio));
}

function buildMessageHistoryForGeneration(
  messages: TopicMessage[],
  historyWindow: number,
  tokenBudget?: number,
) {
  const windowedMessages = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-historyWindow);
  return splitBudgetedRecentItems<TopicMessage>(windowedMessages, {
    maxItems: historyWindow,
    tokenBudget,
    estimateTokens: estimateMessageTokens,
  }).liveItems;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

function buildUserMessagePrompt(content: string, attachments: TopicMessageAttachment[]) {
  if (content.trim()) {
    return content.trim();
  }
  if (!attachments.length) {
    return '';
  }
  return `Please analyze the attached image${attachments.length > 1 ? 's' : ''}.`;
}

function estimateTokenCount(input: string) {
  return estimateTextTokens(input);
}

function extractTextFromModelPayload(payload: any) {
  if (typeof payload?.output_text === 'string') {
    return payload.output_text.trim();
  }

  const chatContent = payload?.choices?.[0]?.message?.content;
  if (typeof chatContent === 'string') {
    return chatContent.trim();
  }

  const responseOutput = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of responseOutput) {
    const content = Array.isArray(item?.content) ? item.content : [];
    const text = content
      .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
    if (text) {
      return text;
    }
  }

  return '';
}

async function invokeSessionSummaryModel(provider: ModelProvider, model: string, prompt: string) {
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  if (!provider.apiKey.trim() || !baseUrl || !model.trim()) {
    return '';
  }

  const systemPrompt =
    'Summarize earlier chat turns for a long-running agent session. Return concise markdown bullets only. Preserve decisions, constraints, TODOs, user preferences, tool failures, and open questions.';
  const endpoint =
    provider.protocol === 'openai_responses_compatible' ? `${baseUrl}/responses` : `${baseUrl}/chat/completions`;
  const body =
    provider.protocol === 'openai_responses_compatible'
      ? {
          model,
          input: `${systemPrompt}\n\n${prompt}`,
          max_output_tokens: 800,
        }
      : {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
          max_tokens: 800,
        };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `Session summary request failed: ${response.status}`);
  }

  return extractTextFromModelPayload(payload);
}

function buildSessionSummaryPrompt(input: TopicSessionSummaryBuilderInput) {
  const dialogue = input.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(0, Math.max(0, input.messages.length - input.historyWindow))
    .map((message) => `${message.authorName} (${message.role}): ${message.content.trim()}`)
    .filter(Boolean)
    .join('\n\n');

  if (!dialogue.trim()) {
    return '';
  }

  return [
    'Compress these earlier turns for future context injection.',
    'Keep only durable facts, decisions, constraints, TODOs, errors, and next steps.',
    'Avoid filler and do not summarize recent turns that are still available raw.',
    '',
    dialogue.slice(0, Math.max(4000, input.tokenBudget ? input.tokenBudget * 4 : 12000)),
  ].join('\n');
}

const stringifyMessageForEstimate = stringifyMessageForTokenEstimate;

function buildToolContextEstimate(input: {
  requestMode: 'chat' | 'responses';
  enableTools?: boolean;
  webSearchEnabled: boolean;
  responsesTools: TopicModelFeatures['responsesTools'];
  enableCustomFunctionCalling: boolean;
}) {
  if (!input.enableTools) {
    return '';
  }
  if (input.requestMode === 'responses') {
    const tools: string[] = [];
    if (input.responsesTools.webSearch) tools.push('web_search');
    if (input.responsesTools.webSearchImage) tools.push('web_search_image');
    if (input.responsesTools.webExtractor) tools.push('web_extractor');
    if (input.responsesTools.codeInterpreter) tools.push('code_interpreter');
    if (input.responsesTools.imageSearch) tools.push('image_search');
    if (input.responsesTools.mcp) tools.push('mcp');
    if (input.enableCustomFunctionCalling) {
      tools.push('function:search_knowledge_base', 'function:execute_code');
      if (input.webSearchEnabled) {
        tools.push('function:search_web');
      }
    }
    return tools.length ? `TOOLS ${tools.join(' ')}` : '';
  }

  const tools = ['search_knowledge_base', 'execute_code'];
  if (input.webSearchEnabled) {
    tools.push('search_web');
  }
  return `TOOLS ${tools.join(' ')}`;
}

function formatMetricsTimestamp(value: string) {
  const date = new Date(value);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}`;
}

function formatMetricsDuration(durationMs?: number) {
  if (!durationMs || durationMs <= 0) {
    return '0.0s';
  }
  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
}

function estimateUsageCost(input: {
  inputTokens: number;
  outputTokens: number;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
}) {
  const inputCost =
    typeof input.inputCostPerMillion === 'number'
      ? (input.inputTokens / 1_000_000) * input.inputCostPerMillion
      : 0;
  const outputCost =
    typeof input.outputCostPerMillion === 'number'
      ? (input.outputTokens / 1_000_000) * input.outputCostPerMillion
      : 0;
  const total = inputCost + outputCost;
  return total > 0 ? total : undefined;
}

function buildPromptInspectorSnapshot(input: {
  capturedAt: string;
  providerName: string;
  model: string;
  requestMode: 'chat' | 'responses';
  contextWindow?: number;
  systemPrompt: string;
  memoryContext: string;
  sessionSummary?: string;
  skillContext: string;
  runtimeSystemPrompt: string;
  toolContext: string;
  messageHistory: TopicMessage[];
  userContent: string;
  attachments: TopicMessageAttachment[];
}): PromptInspectorSnapshot {
  const historyContent = input.messageHistory.map((message) => stringifyMessageForEstimate(message)).join('\n\n');
  const attachmentContent = input.attachments
    .map(
      (attachment) =>
        `[current-image:${attachment.name || attachment.mimeType || 'attachment'} ~${estimateAttachmentTokens(
          attachment,
        )} tokens]`,
    )
    .join('\n');
  const sections = [
    {
      key: 'base_system',
      label: 'Base System Prompt',
      content: input.systemPrompt,
      tokens: estimateTokenCount(input.systemPrompt),
    },
    {
      key: 'memory',
      label: 'Memory Context',
      content: input.memoryContext,
      tokens: estimateTokenCount(input.memoryContext),
    },
    {
      key: 'summary',
      label: 'Session Summary',
      content: input.sessionSummary ?? '',
      tokens: estimateTokenCount(input.sessionSummary ?? ''),
    },
    {
      key: 'skills',
      label: 'Skill Context',
      content: input.skillContext,
      tokens: estimateTokenCount(input.skillContext),
    },
    {
      key: 'runtime',
      label: 'Session Identity',
      content: input.runtimeSystemPrompt,
      tokens: estimateTokenCount(input.runtimeSystemPrompt),
    },
    {
      key: 'tools',
      label: 'Tool Context',
      content: input.toolContext,
      tokens: estimateTokenCount(input.toolContext),
    },
    {
      key: 'history',
      label: 'Live Message History',
      content: historyContent,
      tokens: input.messageHistory.reduce((total, message) => total + estimateMessageTokens(message), 0),
    },
    {
      key: 'user_input',
      label: 'Current User Input',
      content: input.userContent,
      tokens: estimateTokenCount(input.userContent),
    },
    {
      key: 'attachments',
      label: 'Current Attachments',
      content: attachmentContent,
      tokens: input.attachments.reduce((total, attachment) => total + estimateAttachmentTokens(attachment), 0),
    },
  ];
  const totalTokens = sections.reduce((total, section) => total + section.tokens, 0);

  return {
    capturedAt: input.capturedAt,
    providerName: input.providerName,
    model: input.model,
    requestMode: input.requestMode,
    totalTokens,
    contextWindow: input.contextWindow,
    usagePercentage:
      input.contextWindow && input.contextWindow > 0 ? Math.min(100, (totalTokens / input.contextWindow) * 100) : null,
    sections,
  };
}

interface OfficialModelResourceLink {
  label: string;
  href: string;
}

function getOfficialModelResourceLinks(providerName: string, model: string): OfficialModelResourceLink[] {
  const normalizedProvider = providerName.toLowerCase();
  const normalizedModel = model.toLowerCase();

  if (normalizedProvider.includes('openai') || normalizedModel.startsWith('gpt') || normalizedModel.startsWith('o1') || normalizedModel.startsWith('o3') || normalizedModel.startsWith('o4')) {
    return [
      { label: '官方模型页', href: 'https://platform.openai.com/docs/models' },
      { label: '官方价格页', href: 'https://platform.openai.com/docs/pricing/' },
      { label: '模型对比页', href: 'https://platform.openai.com/docs/models/compare' },
    ];
  }

  if (normalizedProvider.includes('anthropic') || normalizedModel.startsWith('claude')) {
    return [
      { label: '官方模型页', href: 'https://docs.anthropic.com/en/docs/about-claude/models' },
      { label: 'Token 统计说明', href: 'https://docs.anthropic.com/en/docs/build-with-claude/token-counting' },
    ];
  }

  if (normalizedProvider.includes('qwen') || normalizedProvider.includes('dashscope') || normalizedModel.startsWith('qwen')) {
    return [
      { label: '官方模型页', href: 'https://help.aliyun.com/zh/model-studio/models' },
      { label: 'Responses 兼容说明', href: 'https://www.alibabacloud.com/help/en/model-studio/compatibility-with-openai-responses-api' },
    ];
  }

  return [];
}

function buildLangChainMessageContent(message: TopicMessage) {
  if (message.role !== 'user' || !message.attachments?.length) {
    return message.content;
  }

  const blocks: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
  if (message.content.trim()) {
    blocks.push({
      type: 'text',
      text: message.content,
    });
  }
  message.attachments.forEach((attachment) => {
    blocks.push({
      type: 'image_url',
      image_url: {
        url: attachment.dataUrl,
      },
    });
  });
  return blocks;
}

function isAbortError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { name?: unknown; message?: unknown };
  return candidate.name === 'AbortError' || String(candidate.message ?? '').toLowerCase().includes('abort');
}

interface TopicRunState {
  isGenerating: boolean;
  composerNotice: string;
  draftAssistantMessage?: TopicMessage;
  reasoningPreview?: string;
  reasoningContent?: string;
  turnStartedAt?: number;
  reasoningStartedAt?: number;
  currentInputTokens?: number;
}

interface MessageRunMetrics {
  completedAt: string;
  streamDurationMs: number;
  reasoningDurationMs?: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost?: number;
  usageSource: 'provider' | 'estimate';
}

interface ModelInvocationStats {
  successCount: number;
  failureCount: number;
  totalLatencyMs: number;
  lastLatencyMs?: number;
  lastError?: string;
}

interface SessionSettingsDraft {
  displayName: string;
  systemPromptOverride: string;
  providerIdOverride: string;
  modelOverride: string;
  enableMemory: boolean;
  enableSkills: boolean;
  enableTools: boolean;
  enableAgentSharedShortTerm: boolean;
}

interface QuickTopicDraft {
  title: string;
  displayName: string;
  systemPromptOverride: string;
  providerIdOverride: string;
  modelOverride: string;
}

interface BranchTopicDraft {
  title: string;
  goal: string;
  mode: BranchTopicMode;
}

interface BranchHandoffDraft {
  note: string;
}

interface ModelFeaturesDraft extends TopicModelFeatures {}

type BranchTopicMode = 'single' | 'workflow';
type ModelPickerTarget = 'global' | 'topic' | 'quick';
type TopicModeFilter = 'all' | 'agent' | 'quick';

const WORKSPACE_BOOT_SOFT_TIMEOUT_MS = 8000;
const WORKSPACE_BOOT_HARD_TIMEOUT_MS = 45000;

export const ChatInterface: React.FC<{
  onBack: () => void;
  runtimeCapabilities?: RuntimeCapabilityProfile;
}> = ({ onBack, runtimeCapabilities = WEB_RUNTIME_CAPABILITIES }) => {
  const [activeTab, setActiveTab] = useState<ChatTab>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showSessionSettings, setShowSessionSettings] = useState(false);
  const [showQuickTopicDialog, setShowQuickTopicDialog] = useState(false);
  const [showBranchTopicDialog, setShowBranchTopicDialog] = useState(false);
  const [showBranchHandoffDialog, setShowBranchHandoffDialog] = useState(false);
  const [showModelFeaturesDialog, setShowModelFeaturesDialog] = useState(false);
  const [showPromptInspector, setShowPromptInspector] = useState(false);
  const [sessionSettingsDraft, setSessionSettingsDraft] = useState<SessionSettingsDraft | null>(null);
  const [quickTopicDraft, setQuickTopicDraft] = useState<QuickTopicDraft | null>(null);
  const [branchTopicDraft, setBranchTopicDraft] = useState<BranchTopicDraft | null>(null);
  const [branchHandoffDraft, setBranchHandoffDraft] = useState<BranchHandoffDraft | null>(null);
  const [modelFeaturesDraft, setModelFeaturesDraft] = useState<ModelFeaturesDraft | null>(null);
  const [sessionSettingsSaving, setSessionSettingsSaving] = useState(false);
  const [quickTopicSaving, setQuickTopicSaving] = useState(false);
  const [branchTopicSaving, setBranchTopicSaving] = useState(false);
  const [branchHandoffSaving, setBranchHandoffSaving] = useState(false);
  const [modelFeaturesSaving, setModelFeaturesSaving] = useState(false);
  const [modelInspectorLoading, setModelInspectorLoading] = useState(false);
  const [modelInspectorError, setModelInspectorError] = useState('');
  const [modelMetadataCache, setModelMetadataCache] = useState<Record<string, OfficialModelMetadataResponse>>({});
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelPickerTarget, setModelPickerTarget] = useState<ModelPickerTarget>('global');
  const [settingsInitialCategory, setSettingsInitialCategory] =
    useState<SettingsCategory>('models');
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
  const [topicModeFilter, setTopicModeFilter] = useState<TopicModeFilter>('all');
  const [modelPickerProviderId, setModelPickerProviderId] = useState<string>('');
  const [modelPickerProviderQuery, setModelPickerProviderQuery] = useState('');
  const [modelPickerSearchQuery, setModelPickerSearchQuery] = useState('');
  const [collapsedPickerProviderGroups, setCollapsedPickerProviderGroups] = useState<Record<string, boolean>>({});
  const [collapsedPickerGroups, setCollapsedPickerGroups] = useState<Record<string, boolean>>({});
  const [collapsedPickerSeries, setCollapsedPickerSeries] = useState<Record<string, boolean>>({});
  const [topicRunStates, setTopicRunStates] = useState<Record<string, TopicRunState>>({});
  const [messageMetricsById, setMessageMetricsById] = useState<Record<string, MessageRunMetrics>>({});
  const [messageReasoningById, setMessageReasoningById] = useState<Record<string, string>>({});
  const [modelInvocationStats, setModelInvocationStats] = useState<ModelInvocationStats>({
    successCount: 0,
    failureCount: 0,
    totalLatencyMs: 0,
  });
  const [promptInspectorByTopicId, setPromptInspectorByTopicId] = useState<Record<string, PromptInspectorSnapshot>>({});
  const [tokenUsageSummary, setTokenUsageSummary] = useState<TokenUsageSummary | null>(null);
  const [knowledgeEvidenceFeedbackByKey, setKnowledgeEvidenceFeedbackByKey] = useState<
    Record<string, KnowledgeEvidenceFeedbackValue>
  >({});
  const [composerWebSearchEnabled, setComposerWebSearchEnabled] = useState(false);
  const [composerSearchProviderId, setComposerSearchProviderId] = useState('');
  const [composerImageAttachments, setComposerImageAttachments] = useState<TopicMessageAttachment[]>([]);
  const [composerAppendRequest, setComposerAppendRequest] = useState<ComposerAppendRequest | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const projectKnowledgeVersionRef = useRef('');
  const topicAbortControllersRef = useRef<Record<string, AbortController>>({});

  const selectedAgent =
    workspace?.agent ?? agents.find((entry) => entry.id === activeAgentId) ?? null;
  const activeRunState = activeTopicId ? topicRunStates[activeTopicId] : undefined;
  const isGenerating = activeRunState?.isGenerating ?? false;
  const composerNotice = activeRunState?.composerNotice ?? shellNotice;
  const backgroundGeneratingCount = useMemo(
    () =>
      Object.entries(topicRunStates).filter(
        ([topicId, runState]) => topicId !== activeTopicId && runState.isGenerating,
      ).length,
    [activeTopicId, topicRunStates],
  );
  const activeDisplayName =
    workspace?.runtime.displayName ?? workspace?.agent.name ?? selectedAgent?.name ?? 'FlowAgent';
  const activeProviderId =
    workspace?.runtime.providerId ?? workspace?.agent.providerId ?? config.activeProviderId;
  const activeProvider =
    config.providers.find((provider) => provider.id === activeProviderId) ?? null;
  const activeProviderName =
    activeProvider?.name ?? 'Model';
  const activeProviderProtocolLabel =
    activeProvider?.protocol === 'openai_responses_compatible'
      ? 'Responses'
      : activeProvider?.protocol === 'anthropic_native'
        ? 'Anthropic'
        : 'Chat';
  const activeModel = workspace?.runtime.model ?? workspace?.agent.model ?? config.activeModel;
  const activeModelFeatures = workspace?.runtime.modelFeatures ?? getDefaultTopicModelFeatures();
  const isResponsesProvider = activeProvider?.protocol === 'openai_responses_compatible';
  const isQwenCompatible =
    Boolean(activeProvider?.baseUrl?.toLowerCase().includes('dashscope')) ||
    activeProvider?.name.toLowerCase().includes('qwen') ||
    activeModel.toLowerCase().includes('qwen');
  const refreshSessionSummary = (
    topicId: string,
    configSnapshot: AgentConfig,
    tokenBudget?: number,
    provider: ModelProvider | null = activeProvider,
    model: string = activeModel,
  ) => {
    const buildSummary =
      configSnapshot.memory.sessionSummaryMode === 'llm' && provider
        ? async (input: TopicSessionSummaryBuilderInput) => {
            if (!input.deterministicSummary) {
              return null;
            }
            const prompt = buildSessionSummaryPrompt(input);
            if (!prompt) {
              return null;
            }
            try {
              return await invokeSessionSummaryModel(provider, model, prompt);
            } catch (error) {
              console.warn('LLM session summary failed; falling back to deterministic summary:', error);
              return null;
            }
          }
        : undefined;

    return refreshTopicSessionSummary(topicId, configSnapshot.memory.historyWindow, tokenBudget, {
      buildSummary,
    });
  };
  const activeMemoryEnabled = workspace?.runtime.enableMemory ?? config.memory.enableAgentLongTerm;
  const activeLane = useMemo(
    () =>
      workspace
        ? {
            id: workspace.agent.id,
            name: activeDisplayName,
            description: workspace.agent.description,
            model: activeModel,
            accentColor: workspace.agent.accentColor,
            position: 0,
          }
        : null,
    [workspace, activeDisplayName, activeModel],
  );
  const latestAssistantMessageId = useMemo(
    () =>
      [...(workspace?.messages ?? [])]
        .reverse()
        .find((message) => message.role === 'assistant')?.id,
    [workspace?.messages],
  );
  const latestAssistantMetrics = latestAssistantMessageId
    ? messageMetricsById[latestAssistantMessageId]
    : undefined;
  const activeModelMetadataKey = `${activeProviderId}::${activeModel}`.toLowerCase();
  const activeModelMetadata = modelMetadataCache[activeModelMetadataKey] ?? null;
  const currentContextBreakdown = useMemo(() => {
    if (!workspace) {
      return null;
    }

    const requestMode = activeProvider?.protocol === 'openai_responses_compatible' ? 'responses' : 'chat';
    const toolContextEstimate = buildToolContextEstimate({
      requestMode,
      enableTools: workspace.runtime.enableTools,
      webSearchEnabled: composerWebSearchEnabled,
      responsesTools: activeModelFeatures.responsesTools,
      enableCustomFunctionCalling: activeModelFeatures.enableCustomFunctionCalling,
    });
    const sessionMessages = buildMessageHistoryForGeneration(
      workspace.messages,
      config.memory.historyWindow,
      resolveMessageHistoryTokenBudget({
        maxInputTokens: activeModelMetadata?.maxInputTokens,
        contextWindow: activeModelMetadata?.contextWindow,
      }),
    );

    return estimateSessionContextTokens({
      systemPrompt: config.systemPrompt,
      sessionSummary: workspace.sessionSummary?.content,
      runtimeSystemPrompt: workspace.runtime.systemPrompt,
      toolContext: toolContextEstimate,
      messages: sessionMessages,
    });
  }, [
    activeModelFeatures.enableCustomFunctionCalling,
    activeModelFeatures.responsesTools,
    activeModelMetadata?.contextWindow,
    activeModelMetadata?.maxInputTokens,
    activeProvider?.protocol,
    composerWebSearchEnabled,
    config.memory.historyWindow,
    config.systemPrompt,
    workspace,
  ]);
  const currentContextTokens = useMemo(() => {
    if (activeRunState?.isGenerating) {
      const streamedOutputTokens = estimateTokenCount(activeRunState.draftAssistantMessage?.content ?? '');
      return (activeRunState.currentInputTokens ?? 0) + streamedOutputTokens;
    }

    if (!workspace) {
      return undefined;
    }
    return currentContextBreakdown?.totalTokens;
  }, [
    activeRunState?.currentInputTokens,
    activeRunState?.draftAssistantMessage?.content,
    activeRunState?.isGenerating,
    currentContextBreakdown,
    workspace,
  ]);
  const currentContextWindow = activeModelMetadata?.contextWindow;
  const currentContextUsagePercentage =
    currentContextTokens && currentContextWindow
      ? Math.min(100, (currentContextTokens / currentContextWindow) * 100)
      : null;
  const latestModelInvocation = latestAssistantMetrics
    ? {
        providerName: activeProviderName,
        model: activeModel,
        completedAt: latestAssistantMetrics.completedAt,
        streamDurationMs: latestAssistantMetrics.streamDurationMs,
        reasoningDurationMs: latestAssistantMetrics.reasoningDurationMs,
        inputTokens: latestAssistantMetrics.inputTokens,
        outputTokens: latestAssistantMetrics.outputTokens,
        totalTokens: latestAssistantMetrics.totalTokens,
        estimatedCost: latestAssistantMetrics.estimatedCost,
        usageSource: latestAssistantMetrics.usageSource,
      }
    : null;
  const branchTopicMode = branchTopicDraft?.mode ?? 'single';
  const branchTopicIsWorkflow = branchTopicMode === 'workflow';
  const officialModelResourceLinks = useMemo(
    () => getOfficialModelResourceLinks(activeProviderName, activeModel),
    [activeModel, activeProviderName],
  );
  const enabledSearchProviders = useMemo(
    () => config.search.providers.filter((provider) => provider.enabled),
    [config.search.providers],
  );
  const composerSearchProvider =
    enabledSearchProviders.find((provider) => provider.id === composerSearchProviderId) ??
    enabledSearchProviders.find((provider) => provider.id === config.search.defaultProviderId) ??
    enabledSearchProviders[0] ??
    null;
  const composerWebSearchReady = Boolean(
    composerSearchProvider &&
      (composerSearchProvider.category === 'local' || composerSearchProvider.apiKey.trim()),
  );
  const pickerEffectiveProviderId =
    modelPickerTarget === 'topic'
      ? sessionSettingsDraft?.providerIdOverride.trim() ||
        workspace?.runtime.providerId ||
        workspace?.agent.providerId ||
        config.activeProviderId
      : modelPickerTarget === 'quick'
        ? quickTopicDraft?.providerIdOverride.trim() || config.activeProviderId
        : config.activeProviderId;
  const pickerEffectiveModel =
    modelPickerTarget === 'topic'
      ? sessionSettingsDraft?.modelOverride.trim() ||
        workspace?.runtime.model ||
        workspace?.agent.model ||
        config.activeModel
      : modelPickerTarget === 'quick'
        ? quickTopicDraft?.modelOverride.trim() || config.activeModel
        : config.activeModel;
  const pickerCurrentProviderName =
    config.providers.find((provider) => provider.id === pickerEffectiveProviderId)?.name ?? 'Model';
  const activeParentTopic = workspace?.topic.parentTopicId
    ? topics.find((topic) => topic.id === workspace.topic.parentTopicId) ?? null
    : null;
  const activeChildBranches = useMemo(
    () =>
      workspace
        ? topics.filter((topic) => topic.parentTopicId === workspace.topic.id)
        : [],
    [topics, workspace],
  );
  const activeSiblingBranches = useMemo(() => {
    if (!workspace?.topic.parentTopicId) {
      return [];
    }
    return topics.filter(
      (topic) =>
        topic.parentTopicId === workspace.topic.parentTopicId && topic.id !== workspace.topic.id,
    );
  }, [topics, workspace]);
  const topicCounts = useMemo(
    () => ({
      all: topics.length,
      agent: topics.filter((topic) => topic.sessionMode !== 'quick').length,
      quick: topics.filter((topic) => topic.sessionMode === 'quick').length,
    }),
    [topics],
  );
  const visibleTopics = useMemo(() => {
    if (topicModeFilter === 'all') {
      return topics;
    }
    return topics.filter((topic) =>
      topicModeFilter === 'quick' ? topic.sessionMode === 'quick' : topic.sessionMode !== 'quick',
    );
  }, [topicModeFilter, topics]);
  const fallbackPromptInspectorSnapshot = useMemo(() => {
    if (!workspace) {
      return null;
    }

    const requestMode = activeProvider?.protocol === 'openai_responses_compatible' ? 'responses' : 'chat';
    return buildPromptInspectorSnapshot({
      capturedAt: new Date().toISOString(),
      providerName: activeProviderName,
      model: activeModel,
      requestMode,
      contextWindow: activeModelMetadata?.contextWindow,
      systemPrompt: config.systemPrompt,
      memoryContext: '',
      sessionSummary: workspace.sessionSummary?.content,
      skillContext: '',
      runtimeSystemPrompt: workspace.runtime.systemPrompt,
      toolContext: buildToolContextEstimate({
        requestMode,
        enableTools: workspace.runtime.enableTools,
        webSearchEnabled: composerWebSearchEnabled,
        responsesTools: activeModelFeatures.responsesTools,
        enableCustomFunctionCalling: activeModelFeatures.enableCustomFunctionCalling,
      }),
      messageHistory: buildMessageHistoryForGeneration(
        workspace.messages,
        config.memory.historyWindow,
        resolveMessageHistoryTokenBudget({
          maxInputTokens: activeModelMetadata?.maxInputTokens,
          contextWindow: activeModelMetadata?.contextWindow,
        }),
      ),
      userContent: '',
      attachments: [],
    });
  }, [
    activeModel,
    activeModelFeatures.enableCustomFunctionCalling,
    activeModelFeatures.responsesTools,
    activeModelMetadata?.contextWindow,
    activeModelMetadata?.maxInputTokens,
    activeProvider?.protocol,
    activeProviderName,
    composerWebSearchEnabled,
    config.memory.historyWindow,
    config.systemPrompt,
    workspace,
  ]);
  const activePromptInspectorSnapshot =
    (activeTopicId ? promptInspectorByTopicId[activeTopicId] ?? null : null) ?? fallbackPromptInspectorSnapshot;

  const setTopicRunState = (topicId: string, updater: (previous: TopicRunState | undefined) => TopicRunState) => {
    setTopicRunStates((previous) => ({
      ...previous,
      [topicId]: updater(previous[topicId]),
    }));
  };

  const finalizeTopicRunState = (
    topicId: string,
    next: Partial<TopicRunState> = {},
  ) => {
    setTopicRunStates((previous) => {
      const prior = previous[topicId];
      if (!prior && !next.composerNotice && !next.draftAssistantMessage && !next.isGenerating) {
        return previous;
      }

      const merged: TopicRunState = {
        isGenerating: next.isGenerating ?? false,
        composerNotice: next.composerNotice ?? '',
        draftAssistantMessage: next.draftAssistantMessage,
        reasoningPreview: next.reasoningPreview ?? '',
        reasoningContent: next.reasoningContent ?? '',
        turnStartedAt: next.turnStartedAt,
        reasoningStartedAt: next.reasoningStartedAt,
        currentInputTokens: next.currentInputTokens,
      };

      if (
        !merged.isGenerating &&
        !merged.composerNotice &&
        !merged.draftAssistantMessage &&
        !merged.reasoningPreview &&
        !merged.reasoningContent &&
        !merged.turnStartedAt &&
        !merged.reasoningStartedAt &&
        !merged.currentInputTokens
      ) {
        if (!(topicId in previous)) {
          return previous;
        }
        const cleaned = { ...previous };
        delete cleaned[topicId];
        return cleaned;
      }

      return {
        ...previous,
        [topicId]: merged,
      };
    });
  };

  const refreshTokenUsageSummary = async () => {
    const summary = await getTokenUsageSummary();
    startTransition(() => {
      setTokenUsageSummary(summary);
    });
  };

  const stopTopicGeneration = (topicId: string) => {
    const controller = topicAbortControllersRef.current[topicId];
    if (!controller) {
      return;
    }
    controller.abort();
    finalizeTopicRunState(topicId, {
      composerNotice: 'Stopping generation…',
    });
  };

  const openGlobalModelPicker = () => {
    setModelPickerTarget('global');
    setModelPickerProviderId(config.activeProviderId);
    setShowModelPicker(true);
  };

  const openTopicModelPicker = () => {
    if (!workspace || !sessionSettingsDraft) {
      return;
    }

    setModelPickerTarget('topic');
    setModelPickerProviderId(
      sessionSettingsDraft.providerIdOverride.trim() || workspace.runtime.providerId || config.activeProviderId,
    );
    setShowModelPicker(true);
  };

  const openQuickModelPicker = () => {
    if (!quickTopicDraft) {
      return;
    }

    setModelPickerTarget('quick');
    setModelPickerProviderId(quickTopicDraft.providerIdOverride.trim() || config.activeProviderId);
    setShowModelPicker(true);
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
    const shouldBlock = !workspace;
    if (shouldBlock) {
      setLoadingWorkspace(true);
    }
    const nextWorkspace = await getTopicWorkspace(topicId);
    if (!nextWorkspace) {
      startTransition(() => {
        setWorkspace(null);
        if (shouldBlock) {
          setLoadingWorkspace(false);
        }
      });
      return;
    }

    const shouldRefreshMemory = activeAgentId !== nextWorkspace.agent.id || memoryDocuments.length === 0;
    const [topicRecords, memoryRecords, topicUsageRecords] = await Promise.all([
      listTopics(nextWorkspace.agent.id),
      shouldRefreshMemory
        ? listAgentMemoryDocuments(nextWorkspace.agent.id)
        : Promise.resolve(memoryDocuments),
      listTopicTokenUsage(topicId),
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
      setMessageMetricsById((previous) => ({
        ...previous,
        ...Object.fromEntries(
          topicUsageRecords.map((record) => [
            record.messageId,
            {
              completedAt: record.createdAt,
              streamDurationMs: record.streamDurationMs ?? 0,
              reasoningDurationMs: record.reasoningDurationMs,
              inputTokens: record.inputTokens,
              outputTokens: record.outputTokens,
              totalTokens: record.totalTokens,
              estimatedCost: record.estimatedCost,
              usageSource: record.usageSource,
            },
          ]),
        ),
      }));
      setActiveAgentIdState(nextWorkspace.agent.id);
      setActiveTopicIdState(nextWorkspace.topic.id);
      if (shouldBlock) {
        setLoadingWorkspace(false);
      }
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
        await refreshLibrary();
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

  const handleOpenQuickTopicDialog = () => {
    setQuickTopicDraft({
      title: 'Quick Chat',
      displayName: 'Quick Assistant',
      systemPromptOverride: 'You are a concise, helpful assistant.',
      providerIdOverride: config.activeProviderId,
      modelOverride: config.activeModel,
    });
    setShowQuickTopicDialog(true);
  };

  const handleCreateQuickTopic = async () => {
    const targetAgentId = activeAgentId ?? agents[0]?.id;
    if (!targetAgentId || !quickTopicDraft) {
      return;
    }

    setQuickTopicSaving(true);
    try {
      const created = await createQuickTopic({
        agentId: targetAgentId,
        title: quickTopicDraft.title.trim() || 'Quick Chat',
        displayName: quickTopicDraft.displayName.trim() || 'Quick Assistant',
        systemPromptOverride:
          quickTopicDraft.systemPromptOverride.trim() || 'You are a concise, helpful assistant.',
        providerIdOverride: quickTopicDraft.providerIdOverride.trim() || config.activeProviderId,
        modelOverride: quickTopicDraft.modelOverride.trim() || config.activeModel,
      });
      await activateTopic(created.id);
      setShowQuickTopicDialog(false);
      setQuickTopicDraft(null);
      setShellNotice(`Created quick session "${created.title}".`);
    } finally {
      setQuickTopicSaving(false);
    }
  };

  const handleOpenBranchTopicDialog = () => {
    if (!workspace) {
      return;
    }

    setBranchTopicDraft({
      title: `${workspace.topic.title} · Branch`,
      goal: '',
      mode: 'single',
    });
    setShowBranchTopicDialog(true);
  };

  const handleCreateBranchTopic = async () => {
    if (!workspace || !branchTopicDraft) {
      return;
    }

    setBranchTopicSaving(true);
    try {
      const title = branchTopicDraft.title.trim() || `${workspace.topic.title} · Branch`;
      const goal = branchTopicDraft.goal.trim();

      if (branchTopicDraft.mode === 'workflow') {
        const result = await compileTaskGraphFromTopic({
          sourceTopicId: workspace.topic.id,
          title,
          goal,
        });
        await activateTopic(workspace.topic.id);
        setShellNotice(
          `Compiled task graph and created ${result.branchTopics?.length ?? 0} worker branches.`,
        );
      } else {
        const branchTopic = await createBranchTopicFromTopic({
          sourceTopicId: workspace.topic.id,
          title,
          branchGoal: goal,
        });
        await activateTopic(branchTopic.id);
        setShellNotice(`Created branch topic "${branchTopic.title}".`);
      }

      setShowBranchTopicDialog(false);
      setBranchTopicDraft(null);
    } finally {
      setBranchTopicSaving(false);
    }
  };

  const handleOpenBranchHandoffDialog = () => {
    if (!workspace?.topic.parentTopicId) {
      return;
    }
    setBranchHandoffDraft({ note: '' });
    setShowBranchHandoffDialog(true);
  };

  const handleBranchHandoff = async () => {
    if (!workspace?.topic.parentTopicId) {
      return;
    }
    const messageHistoryTokenBudget = resolveMessageHistoryTokenBudget({
      maxInputTokens: activeModelMetadata?.maxInputTokens,
      contextWindow: activeModelMetadata?.contextWindow,
    });

    setBranchHandoffSaving(true);
    try {
      const result = await handoffBranchTopicToParent({
        branchTopicId: workspace.topic.id,
        note: branchHandoffDraft?.note?.trim(),
      });
      await Promise.all([
        refreshSessionSummary(workspace.topic.id, config, messageHistoryTokenBudget).catch((error) => {
          console.warn('Failed to refresh branch session summary after handoff:', error);
          return null;
        }),
        refreshSessionSummary(result.parentTopic.id, config, messageHistoryTokenBudget).catch((error) => {
          console.warn('Failed to refresh parent session summary after handoff:', error);
          return null;
        }),
      ]);
      setShowBranchHandoffDialog(false);
      setBranchHandoffDraft(null);
      await activateTopic(result.parentTopic.id);
      setShellNotice(`Sent branch handoff to "${result.parentTopic.title}".`);
    } finally {
      setBranchHandoffSaving(false);
    }
  };

  const handleOpenSessionSettings = () => {
    if (!workspace) {
      return;
    }

    setSessionSettingsDraft({
      displayName: workspace.topic.displayName ?? '',
      systemPromptOverride: workspace.topic.systemPromptOverride ?? '',
      providerIdOverride: workspace.topic.providerIdOverride ?? '',
      modelOverride: workspace.topic.modelOverride ?? '',
      enableMemory: workspace.topic.enableMemory,
      enableSkills: workspace.topic.enableSkills,
      enableTools: workspace.topic.enableTools,
      enableAgentSharedShortTerm: workspace.topic.enableAgentSharedShortTerm,
    });
    setShowSessionSettings(true);
  };

  const handleSaveSessionSettings = async () => {
    if (!workspace || !sessionSettingsDraft) {
      return;
    }

    setSessionSettingsSaving(true);
    try {
      const previousSettings = {
        displayName: workspace.topic.displayName ?? '',
        systemPromptOverride: workspace.topic.systemPromptOverride ?? '',
        providerIdOverride: workspace.topic.providerIdOverride ?? '',
        modelOverride: workspace.topic.modelOverride ?? '',
        enableMemory: workspace.topic.enableMemory,
        enableSkills: workspace.topic.enableSkills,
        enableTools: workspace.topic.enableTools,
        enableAgentSharedShortTerm: workspace.topic.enableAgentSharedShortTerm,
      };
      const diff = describeChangedFields(previousSettings, sessionSettingsDraft as unknown as Record<string, unknown>);
      await updateTopicSessionSettings(workspace.topic.id, sessionSettingsDraft);
      void recordAuditLog({
        category: 'config',
        action: 'topic_session_settings_updated',
        topicId: workspace.topic.id,
        topicTitle: workspace.topic.title,
        agentId: workspace.agent.id,
        target: workspace.topic.id,
        status: 'success',
        summary: `Updated session settings: ${diff.changedKeys.slice(0, 6).join(', ') || 'no visible changes'}.`,
        metadata: diff,
        createdAt: new Date().toISOString(),
      }).catch((error) => {
        console.warn('Failed to record session settings audit log:', error);
      });
      await hydrateTopic(workspace.topic.id);
      setShellNotice(`Updated session settings for "${workspace.topic.title}".`);
      setShowSessionSettings(false);
      setSessionSettingsDraft(null);
    } finally {
      setSessionSettingsSaving(false);
    }
  };

  const handleOpenModelFeaturesDialog = () => {
    if (!workspace) {
      return;
    }

    setModelFeaturesDraft({
      ...workspace.runtime.modelFeatures,
      responsesTools: {
        ...workspace.runtime.modelFeatures.responsesTools,
      },
      structuredOutput: {
        ...workspace.runtime.modelFeatures.structuredOutput,
      },
    });
    setShowModelFeaturesDialog(true);
    void loadCurrentModelMetadata().catch(() => {
      // Surface errors inside the model features panel.
    });
  };

  const loadCurrentModelMetadata = async (force = false) => {
    setModelInspectorLoading(true);
    setModelInspectorError('');
    try {
      if (!config.apiServer.enabled) {
        throw new Error('需要先启用本地 API Server，才能抓取官方模型信息。');
      }
      const cacheKey = `${activeProviderId}::${activeModel}`.toLowerCase();
      if (!force && modelMetadataCache[cacheKey]) {
        return modelMetadataCache[cacheKey]!;
      }
      const result = await inspectOfficialModelMetadataViaApi(
        config.apiServer,
        activeProviderId,
        activeProviderName,
        activeModel,
        { refresh: force },
      );
      if (
        !result ||
        !(
          result.contextWindow ||
          result.maxInputTokens ||
          result.longestReasoningTokens ||
          result.maxOutputTokens ||
          result.inputCostPerMillion != null ||
          result.outputCostPerMillion != null
        )
      ) {
        throw new Error('没有从官方页面识别到可用的模型规格信息，请检查该厂商页面结构或稍后重试。');
      }
      setModelMetadataCache((current) => ({
        ...current,
        [`${result.providerId ?? activeProviderId}::${result.model}`.toLowerCase()]: result,
      }));
      return result;
    } catch (error) {
      setModelInspectorError(error instanceof Error ? error.message : '模型检测失败。');
      throw error;
    } finally {
      setModelInspectorLoading(false);
    }
  };

  const handleSaveModelFeatures = async () => {
    if (!workspace || !modelFeaturesDraft) {
      return;
    }

    setModelFeaturesSaving(true);
    try {
      const diff = describeChangedFields(
        workspace.runtime.modelFeatures as unknown as Record<string, unknown>,
        modelFeaturesDraft as unknown as Record<string, unknown>,
      );
      await updateTopicModelFeatures(workspace.topic.id, modelFeaturesDraft);
      void recordAuditLog({
        category: 'config',
        action: 'topic_model_features_updated',
        topicId: workspace.topic.id,
        topicTitle: workspace.topic.title,
        agentId: workspace.agent.id,
        target: workspace.runtime.model,
        status: 'success',
        summary: `Updated model features: ${diff.changedKeys.slice(0, 6).join(', ') || 'no visible changes'}.`,
        metadata: diff,
        createdAt: new Date().toISOString(),
      }).catch((error) => {
        console.warn('Failed to record model features audit log:', error);
      });
      await hydrateTopic(workspace.topic.id);
      setShellNotice(`Updated model features for "${workspace.topic.title}".`);
      setShowModelFeaturesDialog(false);
      setModelFeaturesDraft(null);
    } finally {
      setModelFeaturesSaving(false);
    }
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
      void recordAuditLog({
        category: 'config',
        action: 'active_model_changed',
        target: `${providerId}::${model}`,
        status: 'success',
        summary: `Changed active model to ${model}.`,
        metadata: describeChangedFields(
          {
            activeProviderId: config.activeProviderId,
            activeModel: config.activeModel,
          },
          {
            activeProviderId: providerId,
            activeModel: model,
          },
        ),
        createdAt: new Date().toISOString(),
      }).catch((error) => {
        console.warn('Failed to record active model audit log:', error);
      });
    } catch (error) {
      setShellNotice(error instanceof Error ? error.message : '配置未能写入 config.json。');
    }
  };

  const handleModelSelection = async (providerId: string, model: string) => {
    if (modelPickerTarget === 'topic' && sessionSettingsDraft) {
      setSessionSettingsDraft((current) =>
        current
          ? {
              ...current,
              providerIdOverride: providerId,
              modelOverride: model,
            }
          : current,
      );
      setShowModelPicker(false);
      return;
    }

    if (modelPickerTarget === 'quick' && quickTopicDraft) {
      setQuickTopicDraft((current) =>
        current
          ? {
              ...current,
              providerIdOverride: providerId,
              modelOverride: model,
            }
          : current,
      );
      setShowModelPicker(false);
      return;
    }

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
    void recordAuditLog({
      category: 'memory',
      action: draft.id ? 'memory_document_updated' : 'memory_document_created',
      agentId: activeAgentId,
      target: draft.title,
      status: 'success',
      summary: `${draft.id ? 'Updated' : 'Created'} memory document "${draft.title}".`,
      metadata: {
        title: draft.title,
        size: draft.content.length,
      },
      createdAt: new Date().toISOString(),
    }).catch((error) => {
      console.warn('Failed to record memory document audit log:', error);
    });
    setShellNotice(`Updated memory for ${selectedAgent?.name ?? 'the current agent'}.`);
    await refreshMemory(activeAgentId);
  };

  const handleDeleteMemoryDocument = async (memoryId: string) => {
    if (!activeAgentId) {
      return;
    }

    await deleteAgentMemoryDocument(memoryId);
    void recordAuditLog({
      category: 'memory',
      action: 'memory_document_deleted',
      agentId: activeAgentId,
      target: memoryId,
      status: 'success',
      summary: `Deleted memory document ${memoryId}.`,
      createdAt: new Date().toISOString(),
    }).catch((error) => {
      console.warn('Failed to record memory delete audit log:', error);
    });
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
    setComposerAppendRequest({
      id: Date.now(),
      content,
    });
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

  const handleImageAttachmentImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) {
      return;
    }

    try {
      const attachments = await Promise.all(
        files.map(async (file) => ({
          id: createLocalId('attachment'),
          kind: 'image' as const,
          name: file.name,
          mimeType: file.type || 'image/png',
          dataUrl: await readFileAsDataUrl(file),
          sizeBytes: file.size,
        })),
      );
      setComposerImageAttachments((previous) => [...previous, ...attachments].slice(0, 4));
      setShellNotice(`Added ${attachments.length} image attachment${attachments.length > 1 ? 's' : ''}.`);
    } catch (error: any) {
      setShellNotice(error?.message || 'Failed to attach images.');
    } finally {
      event.target.value = '';
    }
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

  const handleSend = async (content: string) => {
    const messageText = content.trim();
    const attachmentsSnapshot = composerImageAttachments;
    const webSearchEnabledSnapshot = composerWebSearchEnabled;
    const searchProviderIdSnapshot = composerSearchProvider?.id;

    if (!workspace || isGenerating || (!messageText && attachmentsSnapshot.length === 0)) {
      return;
    }

    const userContent = buildUserMessagePrompt(content, attachmentsSnapshot);
    const workspaceSnapshot = workspace;
    const configSnapshot = config;
    const messageHistoryTokenBudget = resolveMessageHistoryTokenBudget({
      maxInputTokens: activeModelMetadata?.maxInputTokens,
      contextWindow: activeModelMetadata?.contextWindow,
    });
    const timestamp = new Date().toISOString();
    const userMessage: TopicMessageInput = {
      id: createLocalId('message'),
      topicId: workspaceSnapshot.topic.id,
      agentId: workspaceSnapshot.agent.id,
      role: 'user',
      authorName: 'You',
      content: userContent,
      createdAt: timestamp,
      attachments: attachmentsSnapshot,
    };

    const optimisticUserMessage = toTopicMessage(userMessage);
    setWorkspace((previous) => mergeWorkspaceMessages(previous, [optimisticUserMessage]));
    setComposerImageAttachments([]);
    setTopicRunState(workspaceSnapshot.topic.id, () => ({
      isGenerating: true,
      composerNotice: '',
      reasoningPreview: '',
      reasoningContent: '',
      turnStartedAt: Date.now(),
      reasoningStartedAt: undefined,
      currentInputTokens: undefined,
    }));
    await addTopicMessages([userMessage]);
    await maybeAutoTitleTopic(workspaceSnapshot.topic.id, userContent);
    const sessionSummary =
      await refreshSessionSummary(workspaceSnapshot.topic.id, configSnapshot, messageHistoryTokenBudget).catch(
        (error) => {
          console.warn('Failed to refresh topic session summary before send:', error);
          return null;
        },
      );
    await executeAssistantTurn({
      workspaceSnapshot,
      configSnapshot,
      userContent,
      messageHistory: buildMessageHistoryForGeneration(
        [...workspaceSnapshot.messages, optimisticUserMessage],
        configSnapshot.memory.historyWindow,
        messageHistoryTokenBudget,
      ),
      sessionSummary: sessionSummary?.content,
      messageHistoryTokenBudget,
      attachments: attachmentsSnapshot,
      webSearchEnabled: webSearchEnabledSnapshot,
      searchProviderId: searchProviderIdSnapshot,
    });
  };

  const executeAssistantTurn = async ({
    workspaceSnapshot,
    configSnapshot,
    userContent,
    messageHistory,
    sessionSummary,
    messageHistoryTokenBudget,
    attachments,
    webSearchEnabled,
    searchProviderId,
  }: {
    workspaceSnapshot: TopicWorkspace;
    configSnapshot: AgentConfig;
    userContent: string;
    messageHistory: TopicMessage[];
    sessionSummary?: string;
    messageHistoryTokenBudget?: number;
    attachments: TopicMessageAttachment[];
    webSearchEnabled: boolean;
    searchProviderId?: string;
  }) => {
    const abortController = new AbortController();
    topicAbortControllersRef.current[workspaceSnapshot.topic.id] = abortController;
    let lcMessages: any[] = [];
    let assistantDraftId = createLocalId('message');
    let streamedAssistantContent = '';
    let streamedReasoningContent = '';
    let finalAssistantContent = '';
    let finalAssistantMessageId = assistantDraftId;
    let finalAssistantTools: { name: string; status: 'completed'; result: string }[] = [];
    let finalUsage:
      | {
          inputTokens?: number;
          outputTokens?: number;
          totalTokens?: number;
        }
      | undefined;
    const turnStartedAt = Date.now();
    let reasoningStartedAt: number | null = null;
    let firstAssistantDeltaAt: number | null = null;
    let aggregatedInputText = '';
    const runtimeProviderId =
      workspaceSnapshot.runtime.providerId ?? workspaceSnapshot.agent.providerId ?? configSnapshot.activeProviderId;
    const runtimeModel = workspaceSnapshot.runtime.model ?? workspaceSnapshot.agent.model ?? configSnapshot.activeModel;
    const runtimeProvider =
      configSnapshot.providers.find((provider) => provider.id === runtimeProviderId) ?? null;
    const runtimeRequestMode = runtimeProvider?.protocol === 'openai_responses_compatible' ? 'responses' : 'chat';
    const runtimeModelMetadata =
      modelMetadataCache[`${runtimeProviderId}::${runtimeModel}`.toLowerCase()] ??
      (runtimeProviderId === activeProviderId && runtimeModel === activeModel ? activeModelMetadata : null);

    try {
      const [{ HumanMessage, AIMessage }, { createAgentRuntime }] = await Promise.all([
        import('@langchain/core/messages'),
        import('../lib/agent/runtime'),
      ]);

      lcMessages = messageHistory.map((message) =>
        message.role === 'user'
          ? new HumanMessage(buildLangChainMessageContent(message))
          : new AIMessage(message.content),
      );

      const memoryContextRequest = buildAgentMemoryContextRequest(workspaceSnapshot, configSnapshot, userContent);
      const memoryContext = memoryContextRequest
        ? (await getAgentMemoryContext(memoryContextRequest.agentId, memoryContextRequest.options)).slice(0, 4000)
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
      const runtimeIsQwenCompatible =
        Boolean(runtimeProvider?.baseUrl?.toLowerCase().includes('dashscope')) ||
        runtimeProvider?.name.toLowerCase().includes('qwen') ||
        runtimeModel.toLowerCase().includes('qwen');
      const modelFeatures = workspaceSnapshot.runtime.modelFeatures ?? getDefaultTopicModelFeatures();
      const effectiveStructuredOutput =
        runtimeRequestMode === 'chat' && runtimeIsQwenCompatible
          ? modelFeatures.structuredOutput
          : { mode: 'text' as const, schema: modelFeatures.structuredOutput.schema };
      const effectiveThinking =
        runtimeIsQwenCompatible && effectiveStructuredOutput.mode === 'text'
          ? modelFeatures.enableThinking
          : false;

      const runtime = createAgentRuntime({
        config: configSnapshot,
        providerId: workspaceSnapshot.runtime.providerId,
        model: workspaceSnapshot.runtime.model,
        enableTools: workspaceSnapshot.runtime.enableTools,
        enableWebSearch: webSearchEnabled,
        searchProviderId,
        enableThinking: effectiveThinking,
        responsesTools: {
          webSearch: modelFeatures.responsesTools.webSearch,
          webSearchImage: modelFeatures.responsesTools.webSearchImage,
          webExtractor: modelFeatures.responsesTools.webExtractor,
          codeInterpreter: modelFeatures.responsesTools.codeInterpreter,
          imageSearch: modelFeatures.responsesTools.imageSearch,
          mcp: modelFeatures.responsesTools.mcp,
          customFunctionCalling: modelFeatures.enableCustomFunctionCalling,
        },
        structuredOutput:
          effectiveStructuredOutput.mode === 'text'
            ? { mode: 'text' }
            : {
                mode: effectiveStructuredOutput.mode,
                schema:
                  effectiveStructuredOutput.mode === 'json_schema'
                    ? effectiveStructuredOutput.schema
                    : undefined,
              },
        systemPrompt: [
          configSnapshot.systemPrompt,
          memoryContext ? `Agent memory:\n${memoryContext}` : '',
          sessionSummary ? `Session summary:\n${sessionSummary}` : '',
          skillContext ? skillContext : '',
          effectiveStructuredOutput.mode === 'json_object'
            ? 'Please output valid JSON only.'
            : effectiveStructuredOutput.mode === 'json_schema'
              ? 'Please output valid JSON that matches the requested schema exactly.'
              : '',
          `Session identity:\n${workspaceSnapshot.runtime.systemPrompt}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      });
      const toolContextEstimate = buildToolContextEstimate({
        requestMode: runtimeRequestMode,
        enableTools: workspaceSnapshot.runtime.enableTools,
        webSearchEnabled,
        responsesTools: modelFeatures.responsesTools,
        enableCustomFunctionCalling: modelFeatures.enableCustomFunctionCalling,
      });
      aggregatedInputText = [
        configSnapshot.systemPrompt,
        memoryContext,
        sessionSummary,
        skillContext,
        workspaceSnapshot.runtime.systemPrompt,
        toolContextEstimate,
        ...messageHistory.map((message) => stringifyMessageForEstimate(message)),
        userContent,
        ...attachments.map(
          (attachment) =>
            `[current-image:${attachment.name || attachment.mimeType || 'attachment'} ~${estimateAttachmentTokens(
              attachment,
            )} tokens]`,
        ),
      ]
        .filter(Boolean)
        .join('\n');
      const estimatedCurrentInputTokens = estimateTokenCount(aggregatedInputText);
      setPromptInspectorByTopicId((previous) => ({
        ...previous,
        [workspaceSnapshot.topic.id]: buildPromptInspectorSnapshot({
          capturedAt: new Date().toISOString(),
          providerName: runtimeProvider?.name ?? activeProviderName,
          model: runtimeModel,
          requestMode: runtimeRequestMode,
          contextWindow: runtimeModelMetadata?.contextWindow,
          systemPrompt: configSnapshot.systemPrompt,
          memoryContext,
          sessionSummary,
          skillContext,
          runtimeSystemPrompt: workspaceSnapshot.runtime.systemPrompt,
          toolContext: toolContextEstimate,
          messageHistory,
          userContent,
          attachments,
        }),
      }));
      setTopicRunState(workspaceSnapshot.topic.id, (previous) => ({
        isGenerating: true,
        composerNotice: previous?.composerNotice ?? '',
        draftAssistantMessage: previous?.draftAssistantMessage,
        reasoningPreview: previous?.reasoningPreview ?? '',
        reasoningContent: previous?.reasoningContent ?? '',
        turnStartedAt: previous?.turnStartedAt ?? turnStartedAt,
        reasoningStartedAt: previous?.reasoningStartedAt,
        currentInputTokens: estimatedCurrentInputTokens,
      }));

      const stream = await runtime.stream(
        { messages: lcMessages },
        { signal: abortController.signal },
      );

      for await (const event of stream) {
        if (event.type === 'reasoning_delta') {
          const nextReasoningStartedAt = reasoningStartedAt ?? Date.now();
          reasoningStartedAt = nextReasoningStartedAt;
          streamedReasoningContent += event.delta;
          setTopicRunState(workspaceSnapshot.topic.id, (previous) => ({
            isGenerating: true,
            composerNotice: previous?.composerNotice ?? '',
            draftAssistantMessage: previous?.draftAssistantMessage,
            reasoningPreview: `${previous?.reasoningPreview ?? ''}${event.delta}`.slice(-280),
            reasoningContent: `${previous?.reasoningContent ?? ''}${event.delta}`,
            turnStartedAt: previous?.turnStartedAt ?? turnStartedAt,
            reasoningStartedAt: previous?.reasoningStartedAt ?? nextReasoningStartedAt,
            currentInputTokens: previous?.currentInputTokens ?? estimatedCurrentInputTokens,
          }));
          continue;
        }

        if (event.type === 'tool_event') {
          finalAssistantTools = [...finalAssistantTools, event.tool];
          void recordAuditLog({
            category: 'tool',
            action: 'tool_call',
            topicId: workspaceSnapshot.topic.id,
            topicTitle: workspaceSnapshot.topic.title,
            agentId: workspaceSnapshot.agent.id,
            messageId: assistantDraftId,
            target: event.tool.name,
            status: /failed|error/i.test(`${event.tool.status} ${event.tool.result ?? ''}`) ? 'error' : 'success',
            summary: `Tool ${event.tool.name} ${event.tool.status}.`,
            details: event.tool.result?.slice(0, 400),
            metadata: {
              toolName: event.tool.name,
              toolStatus: event.tool.status,
              requestMode: runtimeRequestMode,
              model: runtimeModel,
            },
            createdAt: new Date().toISOString(),
          }).catch((auditError) => {
            console.warn('Failed to record tool audit log:', auditError);
          });
          continue;
        }

        if (event.type === 'assistant_message') {
          finalAssistantContent = event.content;
          finalAssistantMessageId = event.messageId || assistantDraftId;
          finalAssistantTools = event.tools;
          finalUsage = event.usage;
          continue;
        }

        if (event.type !== 'assistant_delta') {
          continue;
        }

        assistantDraftId = event.messageId || assistantDraftId;
        if (firstAssistantDeltaAt === null) {
          firstAssistantDeltaAt = Date.now();
        }
        streamedAssistantContent += event.delta;

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
          reasoningPreview: previous?.reasoningPreview ?? '',
          reasoningContent: previous?.reasoningContent ?? '',
          turnStartedAt: previous?.turnStartedAt ?? turnStartedAt,
          reasoningStartedAt: previous?.reasoningStartedAt,
          currentInputTokens: previous?.currentInputTokens ?? estimatedCurrentInputTokens,
        }));
        setWorkspace((previous) =>
          previous?.topic.id === workspaceSnapshot.topic.id
            ? upsertWorkspaceMessage(previous, optimisticAssistantMessage)
            : previous,
        );
      }

      if (!(finalAssistantContent || streamedAssistantContent)) {
        throw new Error('The model did not return a final assistant message.');
      }

      const assistantMessage: TopicMessageInput = {
        id: finalAssistantMessageId,
        topicId: workspaceSnapshot.topic.id,
        agentId: workspaceSnapshot.agent.id,
        role: 'assistant',
        authorName: workspaceSnapshot.runtime.displayName,
        content: finalAssistantContent || streamedAssistantContent,
        createdAt: new Date().toISOString(),
        tools: finalAssistantTools,
      };

      setWorkspace((previous) => upsertWorkspaceMessage(previous, toTopicMessage(assistantMessage)));
      await addTopicMessages([assistantMessage]);
      void refreshSessionSummary(workspaceSnapshot.topic.id, configSnapshot, messageHistoryTokenBudget).catch(
        (error) => {
          console.warn('Failed to refresh topic session summary after assistant reply:', error);
        },
      );
      const completedAt = new Date().toISOString();
      const estimatedInputTokens = estimateTokenCount(aggregatedInputText);
      const estimatedOutputTokens = estimateTokenCount(finalAssistantContent || streamedAssistantContent);
      const inputTokens = finalUsage?.inputTokens ?? estimatedInputTokens;
      const outputTokens = finalUsage?.outputTokens ?? estimatedOutputTokens;
      const totalTokens = finalUsage?.totalTokens ?? inputTokens + outputTokens;
      const streamDurationMs = Math.max(0, Date.now() - turnStartedAt);
      const reasoningDurationMs =
        reasoningStartedAt !== null
          ? Math.max(0, (firstAssistantDeltaAt ?? Date.now()) - reasoningStartedAt)
          : undefined;
      const estimatedCost = estimateUsageCost({
        inputTokens,
        outputTokens,
        inputCostPerMillion: runtimeModelMetadata?.inputCostPerMillion,
        outputCostPerMillion: runtimeModelMetadata?.outputCostPerMillion,
      });
      setMessageMetricsById((previous) => ({
        ...previous,
        [assistantMessage.id ?? finalAssistantMessageId]: {
          completedAt,
          streamDurationMs,
          reasoningDurationMs,
          inputTokens,
          outputTokens,
          totalTokens,
          estimatedCost,
          usageSource: finalUsage ? 'provider' : 'estimate',
        },
      }));
      try {
        await recordTokenUsage({
          topicId: workspaceSnapshot.topic.id,
          topicTitle: workspaceSnapshot.topic.title,
          agentId: workspaceSnapshot.agent.id,
          providerId: runtimeProviderId,
          model: runtimeModel,
          sessionMode: workspaceSnapshot.topic.sessionMode,
          messageId: assistantMessage.id ?? finalAssistantMessageId,
          inputTokens,
          outputTokens,
          totalTokens,
          estimatedCost,
          usageSource: finalUsage ? 'provider' : 'estimate',
          streamDurationMs,
          reasoningDurationMs,
          createdAt: completedAt,
        });
      } catch (error) {
        console.warn('Failed to record token usage for assistant reply:', error);
      }
      void refreshTokenUsageSummary().catch((error) => {
        console.warn('Failed to refresh token usage summary after assistant reply:', error);
      });
      setModelInvocationStats((previous) => ({
        successCount: previous.successCount + 1,
        failureCount: previous.failureCount,
        totalLatencyMs: previous.totalLatencyMs + streamDurationMs,
        lastLatencyMs: streamDurationMs,
        lastError: undefined,
      }));
      if (streamedReasoningContent.trim()) {
        setMessageReasoningById((previous) => ({
          ...previous,
          [assistantMessage.id ?? finalAssistantMessageId]: streamedReasoningContent,
        }));
      }
      finalizeTopicRunState(workspaceSnapshot.topic.id);
    } catch (error: any) {
      if (isAbortError(error)) {
        delete topicAbortControllersRef.current[workspaceSnapshot.topic.id];
        const partialContent = streamedAssistantContent.trim();
        if (partialContent) {
          const partialMessage: TopicMessageInput = {
            id: assistantDraftId,
            topicId: workspaceSnapshot.topic.id,
            agentId: workspaceSnapshot.agent.id,
            role: 'assistant',
            authorName: workspaceSnapshot.runtime.displayName,
            content: partialContent,
            createdAt: new Date().toISOString(),
            tools: finalAssistantTools,
          };
          setWorkspace((previous) => upsertWorkspaceMessage(previous, toTopicMessage(partialMessage)));
          await addTopicMessages([partialMessage]);
          void refreshSessionSummary(workspaceSnapshot.topic.id, configSnapshot, messageHistoryTokenBudget).catch(
            (error) => {
              console.warn('Failed to refresh topic session summary after partial reply:', error);
            },
          );
          const completedAt = new Date().toISOString();
          const estimatedInputTokens = estimateTokenCount(aggregatedInputText);
          const estimatedOutputTokens = estimateTokenCount(partialContent);
          const estimatedCost = estimateUsageCost({
            inputTokens: estimatedInputTokens,
            outputTokens: estimatedOutputTokens,
            inputCostPerMillion: runtimeModelMetadata?.inputCostPerMillion,
            outputCostPerMillion: runtimeModelMetadata?.outputCostPerMillion,
          });
          setMessageMetricsById((previous) => ({
            ...previous,
            [partialMessage.id ?? assistantDraftId]: {
              completedAt,
              streamDurationMs: Math.max(0, Date.now() - turnStartedAt),
              reasoningDurationMs:
                reasoningStartedAt !== null
                  ? Math.max(0, Date.now() - reasoningStartedAt)
                  : undefined,
              inputTokens: estimatedInputTokens,
              outputTokens: estimatedOutputTokens,
              totalTokens: estimatedInputTokens + estimatedOutputTokens,
              estimatedCost,
              usageSource: 'estimate',
            },
          }));
          try {
            await recordTokenUsage({
              topicId: workspaceSnapshot.topic.id,
              topicTitle: workspaceSnapshot.topic.title,
              agentId: workspaceSnapshot.agent.id,
              providerId: runtimeProviderId,
              model: runtimeModel,
              sessionMode: workspaceSnapshot.topic.sessionMode,
              messageId: partialMessage.id ?? assistantDraftId,
              inputTokens: estimatedInputTokens,
              outputTokens: estimatedOutputTokens,
              totalTokens: estimatedInputTokens + estimatedOutputTokens,
              estimatedCost,
              usageSource: 'estimate',
              streamDurationMs: Math.max(0, Date.now() - turnStartedAt),
              reasoningDurationMs:
                reasoningStartedAt !== null ? Math.max(0, Date.now() - reasoningStartedAt) : undefined,
              createdAt: completedAt,
            });
          } catch (error) {
            console.warn('Failed to record token usage for partial reply:', error);
          }
          void refreshTokenUsageSummary().catch((error) => {
            console.warn('Failed to refresh token usage summary after partial reply:', error);
          });
          if (streamedReasoningContent.trim()) {
            setMessageReasoningById((previous) => ({
              ...previous,
              [partialMessage.id ?? assistantDraftId]: streamedReasoningContent,
            }));
          }
        }
        finalizeTopicRunState(workspaceSnapshot.topic.id, {
          composerNotice: partialContent ? 'Generation stopped. Partial response kept.' : 'Generation stopped.',
        });
        return;
      }

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
      setModelInvocationStats((previous) => ({
        successCount: previous.successCount,
        failureCount: previous.failureCount + 1,
        totalLatencyMs: previous.totalLatencyMs,
        lastLatencyMs: Math.max(0, Date.now() - turnStartedAt),
        lastError: error.message,
      }));
      void refreshSessionSummary(workspaceSnapshot.topic.id, configSnapshot, messageHistoryTokenBudget).catch(
        (error) => {
          console.warn('Failed to refresh topic session summary after fallback reply:', error);
        },
      );
      finalizeTopicRunState(workspaceSnapshot.topic.id, {
        composerNotice: 'Generation failed. Check model credentials or session settings.',
      });
    } finally {
      delete topicAbortControllersRef.current[workspaceSnapshot.topic.id];
      void refreshTopicList(workspaceSnapshot.agent.id).catch(console.error);
    }
  };

  const handleRegenerateAssistantMessage = async (message: TopicMessage) => {
    if (!workspace || isGenerating || message.role !== 'assistant') {
      return;
    }

    const targetIndex = workspace.messages.findIndex((entry) => entry.id === message.id);
    if (targetIndex < 0) {
      return;
    }

    const anchorUserIndex = [...workspace.messages.slice(0, targetIndex)]
      .map((entry, index) => ({ entry, index }))
      .reverse()
      .find(({ entry }) => entry.role === 'user')?.index;
    if (anchorUserIndex === undefined) {
      return;
    }

    const anchorUserMessage = workspace.messages[anchorUserIndex];
    if (!anchorUserMessage) {
      return;
    }

    const workspaceSnapshot = workspace;
    const configSnapshot = config;
    const messageHistoryTokenBudget = resolveMessageHistoryTokenBudget({
      maxInputTokens: activeModelMetadata?.maxInputTokens,
      contextWindow: activeModelMetadata?.contextWindow,
    });
    setTopicRunState(workspaceSnapshot.topic.id, () => ({
      isGenerating: true,
      composerNotice: 'Regenerating response…',
      reasoningPreview: '',
      reasoningContent: '',
      turnStartedAt: Date.now(),
      reasoningStartedAt: undefined,
      currentInputTokens: undefined,
    }));

    await executeAssistantTurn({
      workspaceSnapshot,
      configSnapshot,
      userContent: anchorUserMessage.content,
      messageHistory: buildMessageHistoryForGeneration(
        workspaceSnapshot.messages.slice(0, anchorUserIndex + 1),
        configSnapshot.memory.historyWindow,
        messageHistoryTokenBudget,
      ),
      sessionSummary: buildTopicSessionSummary(
        workspaceSnapshot.messages.slice(0, anchorUserIndex + 1),
        configSnapshot.memory.historyWindow,
        messageHistoryTokenBudget,
      )?.content,
      messageHistoryTokenBudget,
      attachments: anchorUserMessage.attachments ?? [],
      webSearchEnabled: composerWebSearchEnabled,
      searchProviderId: composerSearchProvider?.id,
    });
  };

  const handleCopyMessage = async (message: TopicMessage) => {
    try {
      await navigator.clipboard.writeText(message.content);
      if (activeTopicId) {
        finalizeTopicRunState(activeTopicId, {
          isGenerating: topicRunStates[activeTopicId]?.isGenerating ?? false,
          draftAssistantMessage: topicRunStates[activeTopicId]?.draftAssistantMessage,
          composerNotice: `${message.role === 'user' ? 'User' : 'Assistant'} message copied.`,
        });
      } else {
        setShellNotice(`${message.role === 'user' ? 'User' : 'Assistant'} message copied.`);
      }
    } catch (error) {
      console.error('Failed to copy message:', error);
      if (activeTopicId) {
        finalizeTopicRunState(activeTopicId, {
          isGenerating: topicRunStates[activeTopicId]?.isGenerating ?? false,
          draftAssistantMessage: topicRunStates[activeTopicId]?.draftAssistantMessage,
          composerNotice: 'Copy failed. Clipboard access may be blocked.',
        });
      } else {
        setShellNotice('Copy failed. Clipboard access may be blocked.');
      }
    }
  };

  const handleKnowledgeEvidenceFeedback = async ({
    messageId,
    result,
    value,
  }: {
    messageId: string;
    result: KnowledgeEvidenceResult;
    value: KnowledgeEvidenceFeedbackValue;
  }) => {
    const feedbackKey = `${messageId}:${result.id}`;
    setKnowledgeEvidenceFeedbackByKey((previous) => ({
      ...previous,
      [feedbackKey]: value,
    }));

    try {
      await recordKnowledgeEvidenceFeedback({
        messageId,
        documentId: result.id,
        value,
        sourceType: result.sourceType,
        supportLabel: result.supportLabel,
        matchedTerms: result.matchedTerms,
      });
    } catch (error) {
      console.error('Failed to save knowledge evidence feedback:', error);
      if (activeTopicId) {
        finalizeTopicRunState(activeTopicId, {
          isGenerating: topicRunStates[activeTopicId]?.isGenerating ?? false,
          draftAssistantMessage: topicRunStates[activeTopicId]?.draftAssistantMessage,
          composerNotice: 'Evidence feedback was not saved.',
        });
      }
    }
  };

  const handleDeleteAssistantMessage = async (message: TopicMessage) => {
    if (!workspace || message.role !== 'assistant') {
      return;
    }

    setWorkspace((previous) => {
      if (!previous || previous.topic.id !== workspace.topic.id) {
        return previous;
      }

      const nextMessages = previous.messages.filter((entry) => entry.id !== message.id);
      const lastMessage = nextMessages[nextMessages.length - 1];
      return {
        ...previous,
        messages: nextMessages,
        topic: {
          ...previous.topic,
          preview:
            lastMessage?.content.replace(/\s+/g, ' ').trim() || previous.topic.preview,
          updatedAt: new Date().toISOString(),
          lastMessageAt: lastMessage?.createdAt ?? previous.topic.lastMessageAt,
          messageCount: nextMessages.length,
        },
      };
    });
    setMessageMetricsById((previous) => {
      if (!(message.id in previous)) {
        return previous;
      }
      const next = { ...previous };
      delete next[message.id];
      return next;
    });
    setMessageReasoningById((previous) => {
      if (!(message.id in previous)) {
        return previous;
      }
      const next = { ...previous };
      delete next[message.id];
      return next;
    });

    try {
      await deleteTopicMessage(message.id);
      await refreshSessionSummary(
        workspace.topic.id,
        config,
        resolveMessageHistoryTokenBudget({
          maxInputTokens: activeModelMetadata?.maxInputTokens,
          contextWindow: activeModelMetadata?.contextWindow,
        }),
      ).catch((error) => {
        console.warn('Failed to refresh topic session summary after delete:', error);
        return null;
      });
      await hydrateTopic(workspace.topic.id);
      setShellNotice('Assistant message deleted.');
    } catch (error) {
      console.error('Failed to delete assistant message:', error);
      await hydrateTopic(workspace.topic.id);
      setShellNotice('Delete failed. Restored current topic state.');
    }
  };

  const enabledProviders = config.providers.filter((provider) => provider.enabled);
  const filteredModelPickerProviders = useMemo(
    () => buildProviderGroups(enabledProviders, modelPickerProviderQuery),
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
      enabledProviders.some((provider) => provider.id === current) ? current : pickerEffectiveProviderId || enabledProviders[0]!.id,
    );
  }, [enabledProviders, pickerEffectiveProviderId]);

  useEffect(() => {
    if (!showModelPicker) {
      setModelPickerProviderQuery('');
      setModelPickerSearchQuery('');
      setCollapsedPickerProviderGroups({});
      setCollapsedPickerGroups({});
      setCollapsedPickerSeries({});
    }
  }, [showModelPicker]);

  useEffect(() => {
    setComposerWebSearchEnabled(config.search.enableWebSearch);
  }, [config.search.enableWebSearch]);

  useEffect(() => {
    setComposerSearchProviderId((current) => {
      if (enabledSearchProviders.some((provider) => provider.id === current)) {
        return current;
      }
      return config.search.defaultProviderId;
    });
  }, [config.search.defaultProviderId, enabledSearchProviders]);

  useEffect(() => {
    if (!config.apiServer.enabled || !activeProviderId || !activeModel) {
      return;
    }

    let cancelled = false;
    void listStoredModelMetadata(config.apiServer, activeProviderId)
      .then((entries) => {
        if (cancelled || !entries || Object.keys(entries).length === 0) {
          return;
        }
        setModelMetadataCache((current) => ({
          ...current,
          ...Object.fromEntries(
            Object.values(entries).map((entry) => [
              `${entry.providerId ?? activeProviderId}::${entry.model}`.toLowerCase(),
              entry,
            ]),
          ),
        }));
      })
      .catch(() => {
        // Keep footer silent; explicit actions surface errors.
      });

    return () => {
      cancelled = true;
    };
  }, [activeModel, activeProviderId, config.apiServer]);

  useEffect(() => {
    if (!showSettings) {
      return;
    }

    void refreshTokenUsageSummary().catch((error) => {
      console.warn('Failed to refresh token usage summary:', error);
    });
  }, [showSettings]);

  return (
    <div className="app-shell relative z-10 flex h-screen w-full overflow-hidden font-sans text-white">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileImport}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleImageAttachmentImport}
      />

      <div className="z-30 flex w-14 flex-shrink-0 flex-col items-center gap-3 border-r border-white/5 bg-[#0A0A0F] py-3">
        <button
          onClick={onBack}
          className="group flex h-9 w-9 items-center justify-center rounded-full bg-gradient-brand text-white shadow-lg transition-transform hover:scale-[1.03]"
          title="返回主页"
        >
          <House size={15} className="transition-transform group-hover:-translate-y-[1px]" />
        </button>

        <button
          onClick={() => setActiveTab('chat')}
          className={`rounded-xl p-2 transition-all ${
            activeTab === 'chat'
              ? 'bg-white/10 text-white shadow-sm'
              : 'text-white/40 hover:bg-white/5 hover:text-white/80'
          }`}
          title="Chat"
        >
          <MessageSquare size={18} />
        </button>
        <button
          onClick={() => setActiveTab('prompts')}
          className={`rounded-xl p-2 transition-all ${
            activeTab === 'prompts'
              ? 'bg-white/10 text-white shadow-sm'
              : 'text-white/40 hover:bg-white/5 hover:text-white/80'
          }`}
          title="Agents & Prompts"
        >
          <Sparkles size={18} />
        </button>
        <button
          onClick={() => setActiveTab('knowledge')}
          className={`rounded-xl p-2 transition-all ${
            activeTab === 'knowledge'
              ? 'bg-white/10 text-white shadow-sm'
              : 'text-white/40 hover:bg-white/5 hover:text-white/80'
          }`}
          title="Knowledge Base"
        >
          <Globe size={18} />
        </button>
        <button
          onClick={() => setActiveTab('sandbox')}
          disabled={!runtimeCapabilities.sandbox.webContainer}
          className={`rounded-xl p-2 transition-all ${
            activeTab === 'sandbox'
              ? 'bg-white/10 text-white shadow-sm'
              : runtimeCapabilities.sandbox.webContainer
                ? 'text-white/40 hover:bg-white/5 hover:text-white/80'
                : 'cursor-not-allowed text-white/15'
          }`}
          title={
            runtimeCapabilities.sandbox.webContainer
              ? 'WebContainer Sandbox'
              : 'Sandbox is unavailable in this runtime'
          }
        >
          <Terminal size={18} />
        </button>

        <div className="flex-1" />

        <button
          className="rounded-xl p-2 text-white/40 transition-all hover:bg-white/5 hover:text-white/80"
          title="Theme"
        >
          <Sun size={18} />
        </button>
        <button
          onClick={() => openSettings('models')}
          className={`rounded-xl p-2 transition-all ${
            showSettings
              ? 'bg-white/10 text-white shadow-sm'
              : 'text-white/40 hover:bg-white/5 hover:text-white/80'
          }`}
          title="Settings"
        >
          <Settings size={18} />
        </button>
      </div>

      {activeTab === 'chat' && sidebarOpen ? (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 248, opacity: 1 }}
          className="flex flex-shrink-0 flex-col border-r border-white/10 bg-[#0A0A0F]"
        >
          <div className="space-y-2.5 p-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-2.5">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/35">
                Active Agent
              </div>
              <select
                value={activeAgentId ?? ''}
                onChange={(event) => activateAgent(event.target.value).catch(console.error)}
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[13px] text-white outline-none"
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
                className="group flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 transition-colors hover:bg-white/10"
              >
                <span className="text-[13px] font-medium text-white/90">New Agent Topic</span>
                <Plus size={16} className="text-white/50 transition-colors group-hover:text-white" />
              </button>
              <button
                onClick={handleOpenQuickTopicDialog}
                className="group flex w-full items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3.5 py-2.5 transition-colors hover:bg-white/10"
              >
                <span className="text-[13px] font-medium text-white/80">Quick Topic</span>
                <Sparkles size={16} className="text-white/45 transition-colors group-hover:text-white" />
              </button>
            </div>

            {!searchQuery.trim() ? (
              <div className="grid grid-cols-3 gap-1.5 rounded-2xl border border-white/10 bg-black/20 p-1">
                {[
                  { key: 'all', label: 'All', count: topicCounts.all },
                  { key: 'agent', label: 'Agent', count: topicCounts.agent },
                  { key: 'quick', label: 'Quick', count: topicCounts.quick },
                ].map((entry) => (
                  <button
                    key={entry.key}
                    onClick={() => setTopicModeFilter(entry.key as TopicModeFilter)}
                    className={`rounded-[13px] px-2.5 py-1.5 text-left transition-all ${
                      topicModeFilter === entry.key
                        ? 'bg-white/10 text-white shadow-[0_10px_24px_rgba(0,0,0,0.18)]'
                        : 'text-white/45 hover:bg-white/5 hover:text-white/85'
                    }`}
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em]">{entry.label}</div>
                    <div className="mt-0.5 text-[11px] text-white/45">{entry.count}</div>
                  </button>
                ))}
              </div>
            ) : null}

            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-2.5 py-2">
              <Search size={14} className="text-white/35" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search topic titles and message content"
                className="w-full bg-transparent text-[13px] text-white outline-none placeholder:text-white/35"
              />
            </label>

            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-white/35">
              <span>{searchQuery.trim() ? 'Search Results' : 'Topics'}</span>
              <span>{fts5Enabled ? 'FTS5 ready' : 'Fallback search'}</span>
            </div>
          </div>

          <div className="flex-1 space-y-1 overflow-y-auto px-2.5 py-2 custom-scrollbar">
            {searchQuery.trim() ? (
              searchResults.length > 0 ? (
                searchResults.map((result) => (
                  <button
                    key={`${result.type}_${result.topicId}_${result.preview}`}
                    onClick={() => {
                      setSearchQuery('');
                      activateTopic(result.topicId).catch(console.error);
                    }}
                    className="w-full rounded-xl border border-transparent px-2.5 py-2.5 text-left text-white/70 transition-colors hover:border-white/10 hover:bg-white/5 hover:text-white"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium">{result.topicTitle}</span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/45">
                        {result.type}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-white/40">{result.agentName}</p>
                    <p className="mt-1.5 line-clamp-2 text-[11px] leading-5 text-white/45">
                      {result.preview}
                    </p>
                  </button>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-white/10 px-3 py-8 text-center text-sm text-white/35">
                  No matching topics or messages found.
                </div>
              )
            ) : visibleTopics.length > 0 ? (
              visibleTopics.map((topic) => (
                <button
                  key={topic.id}
                  onClick={() => activateTopic(topic.id).catch(console.error)}
                  className={`w-full rounded-xl border px-2.5 py-2.5 text-left transition-colors ${
                    activeTopicId === topic.id
                      ? 'border-white/10 bg-white/10 text-white'
                      : 'border-transparent bg-transparent text-white/60 hover:bg-white/5 hover:text-white/90'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[13px] font-medium">{topic.title}</span>
                      {topic.sessionMode === 'quick' ? (
                        <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-1.5 py-0.5 text-[9px] text-amber-200/80">
                          Quick
                        </span>
                      ) : null}
                      {topic.parentTopicId ? (
                        <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-1.5 py-0.5 text-[9px] text-sky-200/80">
                          Branch
                        </span>
                      ) : null}
                      {topicRunStates[topic.id]?.isGenerating ? (
                        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] text-emerald-200/80">
                          Live
                        </span>
                      ) : null}
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/45">
                      {topic.messageCount}
                    </span>
                  </div>
                  {topic.parentTopicId ? (
                    <p className="mt-1 truncate text-[10px] text-sky-200/45">
                      From {topics.find((entry) => entry.id === topic.parentTopicId)?.title ?? 'parent topic'}
                    </p>
                  ) : null}
                  <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-white/40">
                    {topic.preview}
                  </p>
                </button>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 px-3 py-8 text-center text-sm text-white/35">
                {topicModeFilter === 'all'
                  ? 'No topics yet. Create one to start chatting with this agent.'
                  : `No ${topicModeFilter} topics yet.`}
              </div>
            )}
          </div>
        </motion.div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col bg-[#05050A]">
        {activeTab === 'chat' ? (
          <>
            <header className="flex h-13 flex-shrink-0 items-center justify-between border-b border-white/10 px-3.5">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSidebarOpen((previous) => !previous)}
                  className="rounded-lg p-1.5 text-white/60 transition-colors hover:bg-white/10"
                >
                  {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
                </button>
                <div className="flex min-w-0 items-center gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <div className="truncate text-sm font-semibold text-white">
                        {workspace?.topic.title ?? 'Loading topic...'}
                      </div>
                      {workspace?.topic.sessionMode === 'quick' ? (
                        <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-1.5 py-0.5 text-[9px] text-amber-200/80">
                          Quick
                        </span>
                      ) : null}
                      {workspace?.topic.parentTopicId ? (
                        <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-1.5 py-0.5 text-[9px] text-sky-200/80">
                          Branch
                        </span>
                      ) : null}
                      {activeRunState?.isGenerating ? (
                        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] text-emerald-200/80">
                          Live
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
                      {workspace ? (
                        <button
                          onClick={handleOpenBranchTopicDialog}
                          className="rounded-md px-1.5 py-1 text-[10px] text-sky-200/55 transition-colors hover:bg-sky-400/10 hover:text-sky-100"
                          title="Branch task"
                        >
                          Branch
                        </button>
                      ) : null}
                      {workspace?.topic.parentTopicId ? (
                        <button
                          onClick={handleOpenBranchHandoffDialog}
                          className="rounded-md px-1.5 py-1 text-[10px] text-emerald-200/55 transition-colors hover:bg-emerald-400/10 hover:text-emerald-100"
                          title="Send branch findings to parent"
                        >
                          Send Up
                        </button>
                      ) : null}
                      {workspace ? (
                        <button
                          onClick={handleOpenSessionSettings}
                          className="rounded-md px-1.5 py-1 text-[10px] text-white/45 transition-colors hover:bg-white/10 hover:text-white/85"
                          title="Session settings"
                        >
                          Session
                        </button>
                      ) : null}
                    </div>
                    <div className="text-[10px] text-white/40">
                      {workspace?.runtime.displayName ?? workspace?.agent.name ?? selectedAgent?.name ?? 'Loading agent...'} ·{' '}
                      {workspace?.agent.workspaceRelpath ?? selectedAgent?.workspaceRelpath ?? 'agents/...'}
                    </div>
                    {activeParentTopic ? (
                      <div className="text-[10px] text-sky-200/45">Branched from {activeParentTopic.title}</div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <span
                  className={`hidden rounded-full border px-2 py-1 text-[10px] lg:inline-flex ${
                    runtimeCapabilities.hostBridge.available
                      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100/75'
                      : runtimeCapabilities.mode === 'electron'
                        ? 'border-amber-400/20 bg-amber-400/10 text-amber-100/75'
                        : 'border-white/10 bg-white/5 text-white/45'
                  }`}
                  title={runtimeCapabilities.hostBridge.message}
                >
                  {runtimeCapabilities.label}
                </span>
                <button
                  onClick={() => {
                    if (workspace) {
                      handleOpenSessionSettings();
                      return;
                    }
                    openGlobalModelPicker();
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[13px] text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <span className="max-w-[220px] truncate">
                    {activeProviderName}
                    {' · '}
                    {activeModel}
                  </span>
                  <span className="rounded-full border border-white/10 bg-black/20 px-1.5 py-0.5 text-[9px] text-white/55">
                    {activeProviderProtocolLabel}
                  </span>
                  <ChevronDown size={14} className="text-white/45" />
                </button>
                <button
                  onClick={handleOpenModelFeaturesDialog}
                  disabled={!workspace}
                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    模型功能
                    {activeModelFeatures.enableThinking ||
                    activeModelFeatures.enableCustomFunctionCalling ||
                    activeModelFeatures.structuredOutput.mode !== 'text' ||
                    Object.values(activeModelFeatures.responsesTools).some(Boolean) ? (
                      <span className="rounded-full border border-sky-400/25 bg-sky-400/12 px-1.5 py-0.5 text-[10px] text-sky-100">
                        ON
                      </span>
                    ) : null}
                  </span>
                </button>
                <button
                  onClick={() => setShowPromptInspector(true)}
                  disabled={!activePromptInspectorSnapshot}
                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    <BarChart3 size={13} />
                    Prompt Inspector
                  </span>
                </button>
              </div>
            </header>

            {workspace && (activeParentTopic || activeChildBranches.length > 0 || activeSiblingBranches.length > 0) ? (
              <div className="border-b border-white/5 bg-white/[0.02] px-4 py-2.5">
                <div className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center gap-2">
                  {activeParentTopic ? (
                    <button
                      onClick={() => activateTopic(activeParentTopic.id).catch(console.error)}
                      className="inline-flex items-center gap-2 rounded-full border border-sky-400/15 bg-sky-400/10 px-3 py-1.5 text-[11px] text-sky-100/85 transition-colors hover:bg-sky-400/16"
                    >
                      <GitBranch size={12} />
                      Parent · {activeParentTopic.title}
                    </button>
                  ) : null}
                  {activeChildBranches.length > 0 ? (
                    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] text-white/55">
                      Branches {activeChildBranches.length}
                    </span>
                  ) : null}
                  {activeChildBranches.map((topic) => (
                    <button
                      key={topic.id}
                      onClick={() => activateTopic(topic.id).catch(console.error)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] transition-colors ${
                        topicRunStates[topic.id]?.isGenerating
                          ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100/85'
                          : 'border-white/10 bg-black/20 text-white/65 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      <span className="max-w-[180px] truncate">{topic.title}</span>
                      {topicRunStates[topic.id]?.isGenerating ? <span>Running</span> : null}
                    </button>
                  ))}
                  {activeSiblingBranches.length > 0 ? (
                    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] text-white/55">
                      Siblings {activeSiblingBranches.length}
                    </span>
                  ) : null}
                  {activeSiblingBranches.map((topic) => (
                    <button
                      key={topic.id}
                      onClick={() => activateTopic(topic.id).catch(console.error)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] transition-colors ${
                        topicRunStates[topic.id]?.isGenerating
                          ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100/85'
                          : 'border-white/10 bg-black/20 text-white/65 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      <span className="max-w-[180px] truncate">{topic.title}</span>
                      {topicRunStates[topic.id]?.isGenerating ? <span>Running</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

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
                      lane={activeLane ?? {
                        id: workspace.agent.id,
                        name: activeDisplayName,
                        description: workspace.agent.description,
                        model: activeModel,
                        accentColor: workspace.agent.accentColor,
                        position: 0,
                      }}
                      messages={workspace.messages}
                      isGenerating={isGenerating}
                      showTimestamps={config.ui.showTimestamps}
                      showToolResults={config.ui.showToolResults}
                      autoScroll={config.ui.autoScroll}
                      compact={config.ui.compactLanes}
                      reasoningContent={activeRunState?.reasoningContent ?? ''}
                      liveReasoningStartedAt={activeRunState?.reasoningStartedAt}
                      messageMetricsById={messageMetricsById}
                      messageReasoningById={messageReasoningById}
                      scrollKey={workspace.topic.id}
                      latestAssistantMessageId={latestAssistantMessageId}
                      evidenceFeedbackByKey={knowledgeEvidenceFeedbackByKey}
                      onCopyMessage={handleCopyMessage}
                      onEvidenceFeedback={handleKnowledgeEvidenceFeedback}
                      onDeleteAssistantMessage={(messageId) => {
                        const targetMessage = workspace.messages.find((entry) => entry.id === messageId);
                        if (!targetMessage) {
                          return;
                        }
                        handleDeleteAssistantMessage(targetMessage).catch(console.error);
                      }}
                      onRegenerateAssistantMessage={(messageId) => {
                        const targetMessage = workspace.messages.find((entry) => entry.id === messageId);
                        if (!targetMessage) {
                          return;
                        }
                        handleRegenerateAssistantMessage(targetMessage).catch(console.error);
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            <ChatComposer
              agents={agents}
              activeAgentId={activeAgentId}
              activeDisplayName={activeDisplayName}
              activeModel={activeModel}
              activeMemoryEnabled={activeMemoryEnabled}
              isGenerating={isGenerating}
              backgroundGeneratingCount={backgroundGeneratingCount}
              workspaceAvailable={Boolean(workspace)}
              composerNotice={composerNotice}
              selectedAgentName={selectedAgent?.name ?? 'Agent'}
              currentContextTokens={currentContextTokens}
              currentContextWindow={currentContextWindow}
              currentContextUsagePercentage={currentContextUsagePercentage}
              currentContextBreakdown={activeRunState?.isGenerating ? null : currentContextBreakdown}
              imageAttachments={composerImageAttachments}
              appendRequest={composerAppendRequest}
              webSearchEnabled={composerWebSearchEnabled}
              searchProvider={composerSearchProvider}
              webSearchReady={composerWebSearchReady}
              enabledSearchProviders={enabledSearchProviders}
              onActivateAgent={(agentId) => activateAgent(agentId).catch(console.error)}
              onImportFiles={() => fileInputRef.current?.click()}
              onAttachImages={() => imageInputRef.current?.click()}
              onOpenSearchSettings={() => openSettings('search')}
              onToggleWebSearch={() => setComposerWebSearchEnabled((previous) => !previous)}
              onSelectSearchProvider={(providerId) => {
                setComposerSearchProviderId(providerId);
                setComposerWebSearchEnabled(true);
              }}
              onOpenPrompts={() => setActiveTab('prompts')}
              onRemoveImageAttachment={(attachmentId) =>
                setComposerImageAttachments((previous) =>
                  previous.filter((entry) => entry.id !== attachmentId),
                )
              }
              onStop={() => {
                if (workspace) {
                  stopTopicGeneration(workspace.topic.id);
                }
              }}
              onSend={(content) => {
                handleSend(content).catch(console.error);
              }}
            />
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
              <TerminalPanel
                onClose={() => setActiveTab('chat')}
                runtimeCapabilities={runtimeCapabilities}
              />
            </div>
          </Suspense>
        )}
      </div>

      {showSettings ? (
        <Suspense fallback={null}>
          <SettingsView
            config={config}
            agents={agents}
            memoryDocuments={memoryDocuments}
            activeAgentId={activeAgentId}
            initialCategory={settingsInitialCategory}
            sessionContextDiagnostics={
              currentContextTokens != null
                ? {
                    tokens: currentContextTokens,
                    contextWindow: currentContextWindow,
                    usagePercentage: currentContextUsagePercentage,
                    breakdown: activeRunState?.isGenerating ? null : currentContextBreakdown,
                  }
                : undefined
            }
            latestModelInvocation={latestModelInvocation}
            tokenUsageSummary={tokenUsageSummary}
            modelInvocationStats={modelInvocationStats}
            onClose={() => setShowSettings(false)}
            onConfigSaved={(nextConfig) => setConfig(nextConfig)}
            runtimeCapabilities={runtimeCapabilities}
            onMemoryFilesChanged={(agentId) => {
              void handleMemoryFilesChanged(agentId);
            }}
          />
        </Suspense>
	      ) : null}

      <PromptInspectorDialog
        open={showPromptInspector}
        onClose={() => setShowPromptInspector(false)}
        snapshot={activePromptInspectorSnapshot}
        latestInvocation={latestModelInvocation}
      />

      {showQuickTopicDialog && quickTopicDraft ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm">
          <div className="flex h-[74vh] min-h-[560px] w-full max-w-[980px] overflow-hidden rounded-[30px] border border-white/10 bg-[#171717] shadow-2xl">
            <div className="flex w-[300px] flex-col border-r border-white/5 bg-[#141414] px-5 py-6">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">Quick Session</div>
              <div className="mt-3 text-2xl font-semibold text-white">Create Quick Topic</div>
              <div className="mt-2 text-sm leading-6 text-white/50">
                适合短对话、临时角色和多模型并行试验。默认关闭记忆、skills 和工具。
              </div>
              <div className="mt-5 rounded-[24px] border border-white/8 bg-black/20 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">Runtime Preview</div>
                <div className="mt-3 space-y-3 text-sm text-white/75">
                  <div>
                    <div className="text-[11px] text-white/35">Identity</div>
                    <div className="mt-1">{quickTopicDraft.displayName.trim() || 'Quick Assistant'}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-white/35">Model</div>
                    <div className="mt-1">
                      {config.providers.find((provider) => provider.id === quickTopicDraft.providerIdOverride)?.name ??
                        activeProviderName}{' '}
                      · {quickTopicDraft.modelOverride || activeModel}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-white/35">Features</div>
                    <div className="mt-1">Memory Off · Skills Off · Tools Off</div>
                  </div>
                </div>
              </div>
              <div className="mt-4 rounded-[24px] border border-sky-500/15 bg-sky-500/8 p-4 text-sm leading-6 text-sky-100/75">
                Quick 会话仍然是独立 topic，可以和普通 Agent 会话同时运行，但不会自动继承记忆增强。
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-start justify-between gap-4 border-b border-white/5 px-6 py-5">
                <div>
                  <div className="text-lg font-semibold text-white">创建快速会话</div>
                  <div className="mt-1 text-sm text-white/50">在创建前先确定标题、身份、提示词和模型。</div>
                </div>
                <button
                  onClick={() => {
                    setShowQuickTopicDialog(false);
                    setQuickTopicDraft(null);
                  }}
                  className="rounded-full p-2 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 custom-scrollbar">
                <div className="space-y-5">
                  <div className="grid gap-5 md:grid-cols-2">
                    <label className="block">
                      <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-white/35">Title</div>
                      <input
                        type="text"
                        value={quickTopicDraft.title}
                        onChange={(event) =>
                          setQuickTopicDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  title: event.target.value,
                                }
                              : current,
                          )
                        }
                        placeholder="Quick Chat"
                        className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-emerald-500/40"
                      />
                    </label>

                    <label className="block">
                      <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-white/35">Display Name</div>
                      <input
                        type="text"
                        value={quickTopicDraft.displayName}
                        onChange={(event) =>
                          setQuickTopicDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  displayName: event.target.value,
                                }
                              : current,
                          )
                        }
                        placeholder="Quick Assistant"
                        className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-emerald-500/40"
                      />
                    </label>
                  </div>

                  <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                    <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-white/35">Model</div>
                    <div className="text-sm text-white/80">
                      {config.providers.find((provider) => provider.id === quickTopicDraft.providerIdOverride)?.name ??
                        activeProviderName}{' '}
                      · {quickTopicDraft.modelOverride || activeModel}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={openQuickModelPicker}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85 transition-colors hover:bg-white/10"
                      >
                        选择 quick 模型
                      </button>
                      <button
                        onClick={() =>
                          setQuickTopicDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  providerIdOverride: config.activeProviderId,
                                  modelOverride: config.activeModel,
                                }
                              : current,
                          )
                        }
                        className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/55 transition-colors hover:bg-white/10 hover:text-white/85"
                      >
                        跟随默认
                      </button>
                    </div>
                  </div>

                  <label className="block">
                    <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-white/35">System Prompt</div>
                    <textarea
                      value={quickTopicDraft.systemPromptOverride}
                      onChange={(event) =>
                        setQuickTopicDraft((current) =>
                          current
                            ? {
                                ...current,
                                systemPromptOverride: event.target.value,
                              }
                            : current,
                        )
                      }
                      rows={10}
                      className="w-full rounded-[22px] border border-white/10 bg-black/20 px-4 py-3 text-sm leading-7 text-white outline-none transition-colors focus:border-emerald-500/40 custom-scrollbar"
                    />
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-white/5 px-6 py-4">
                <div className="text-xs text-white/35">创建后仍可在“Session”面板里继续修改该 quick 会话。</div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setShowQuickTopicDialog(false);
                      setQuickTopicDraft(null);
                    }}
                    className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => handleCreateQuickTopic().catch(console.error)}
                    disabled={quickTopicSaving}
                    className="rounded-xl border border-sky-500/20 bg-sky-500/15 px-4 py-2 text-sm font-medium text-sky-100 transition-colors hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {quickTopicSaving ? '创建中...' : '创建 Quick Topic'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showBranchTopicDialog && workspace && branchTopicDraft ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm">
          <div className="flex h-[68vh] min-h-[520px] w-full max-w-[900px] overflow-hidden rounded-[30px] border border-white/10 bg-[#171717] shadow-2xl">
            <div className="flex w-[300px] flex-col border-r border-white/5 bg-[#141414] px-5 py-6">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">Branch Task</div>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-400/20 bg-sky-400/10">
                  <GitBranch size={18} className="text-sky-200/85" />
                </div>
                <div>
                  <div className="text-xl font-semibold text-white">Create Branch Topic</div>
                  <div className="text-sm text-white/45">{workspace.topic.title}</div>
                </div>
              </div>
              <div className="mt-5 rounded-[24px] border border-white/8 bg-black/20 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">Branch Behavior</div>
                <div className="mt-3 space-y-3 text-sm leading-6 text-white/70">
                  <div>
                    {branchTopicIsWorkflow
                      ? '编译任务图，并生成多个 worker branch。'
                      : '继承当前会话的模型、提示词和功能开关。'}
                  </div>
                  <div>
                    {branchTopicIsWorkflow
                      ? '每个 worker branch 只拿到自己那部分任务与精简上下文。'
                      : '带入一份精简上下文快照，而不是复制整段历史消息。'}
                  </div>
                  <div>
                    {branchTopicIsWorkflow
                      ? '适合并行拆解任务、分工处理、最后汇总。'
                      : '创建后可与父会话并行运行，互不锁定。'}
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  onClick={() =>
                    setBranchTopicDraft((current) =>
                      current ? { ...current, mode: 'single' } : current,
                    )
                  }
                  className={`rounded-xl border px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] transition-colors ${
                    branchTopicMode === 'single'
                      ? 'border-sky-400/30 bg-sky-500/15 text-sky-100'
                      : 'border-white/10 bg-black/15 text-white/55 hover:bg-white/5 hover:text-white/80'
                  }`}
                >
                  单分支
                </button>
                <button
                  onClick={() =>
                    setBranchTopicDraft((current) =>
                      current ? { ...current, mode: 'workflow' } : current,
                    )
                  }
                  className={`rounded-xl border px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] transition-colors ${
                    branchTopicMode === 'workflow'
                      ? 'border-sky-400/30 bg-sky-500/15 text-sky-100'
                      : 'border-white/10 bg-black/15 text-white/55 hover:bg-white/5 hover:text-white/80'
                  }`}
                >
                  工作流拆解
                </button>
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-start justify-between gap-4 border-b border-white/5 px-6 py-5">
                <div>
                  <div className="text-lg font-semibold text-white">
                    {branchTopicIsWorkflow ? '编译任务图' : '创建子任务分支'}
                  </div>
                  <div className="mt-1 text-sm text-white/50">
                    {branchTopicIsWorkflow
                      ? '把当前会话编译成任务图，并生成多个 worker branch。'
                      : '把当前会话派生为一个并行处理的 branch topic。'}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowBranchTopicDialog(false);
                    setBranchTopicDraft(null);
                  }}
                  className="rounded-full p-2 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 custom-scrollbar">
                <div className="space-y-5">
                  <label className="block">
                    <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-white/35">
                      {branchTopicIsWorkflow ? 'Workflow Title' : 'Branch Title'}
                    </div>
                    <input
                      type="text"
                      value={branchTopicDraft.title}
                      onChange={(event) =>
                        setBranchTopicDraft((current) =>
                          current
                            ? {
                                ...current,
                                title: event.target.value,
                              }
                            : current,
                        )
                      }
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-sky-500/40"
                    />
                  </label>

                  <label className="block">
                    <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-white/35">
                      {branchTopicIsWorkflow ? 'Workflow Goal' : 'Branch Goal'}
                    </div>
                    <textarea
                      value={branchTopicDraft.goal}
                      onChange={(event) =>
                        setBranchTopicDraft((current) =>
                          current
                            ? {
                                ...current,
                                goal: event.target.value,
                              }
                            : current,
                      )
                      }
                      rows={8}
                      placeholder={
                        branchTopicIsWorkflow
                          ? '例如：拆成检索、归纳、对比三条 worker branch，最后汇总成一份方案。'
                          : '例如：只整理报价策略；只拆任务清单；只产出一个技术方案草稿。'
                      }
                      className="w-full rounded-[22px] border border-white/10 bg-black/20 px-4 py-3 text-sm leading-7 text-white outline-none transition-colors focus:border-sky-500/40 custom-scrollbar"
                    />
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-white/5 px-6 py-4">
                <div className="text-xs text-white/35">
                  {branchTopicIsWorkflow
                    ? '工作流模式会编译任务图，并生成多个 worker branch。'
                    : '分支创建后会自动插入一条 system bootstrap，标明父会话来源与子任务目标。'}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setShowBranchTopicDialog(false);
                      setBranchTopicDraft(null);
                    }}
                    className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => handleCreateBranchTopic().catch(console.error)}
                    disabled={
                      branchTopicSaving ||
                      (branchTopicIsWorkflow && !branchTopicDraft.goal.trim())
                    }
                    className="rounded-xl border border-sky-500/20 bg-sky-500/15 px-4 py-2 text-sm font-medium text-sky-100 transition-colors hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {branchTopicSaving
                      ? '创建中...'
                      : branchTopicIsWorkflow
                        ? '编译并生成 Worker Branches'
                        : '创建 Branch Topic'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showBranchHandoffDialog && workspace?.topic.parentTopicId && branchHandoffDraft ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm">
          <div className="flex h-[58vh] min-h-[420px] w-full max-w-[820px] overflow-hidden rounded-[30px] border border-white/10 bg-[#171717] shadow-2xl">
            <div className="flex w-[280px] flex-col border-r border-white/5 bg-[#141414] px-5 py-6">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">Branch Handoff</div>
              <div className="mt-3 text-2xl font-semibold text-white">Send to Parent</div>
              <div className="mt-2 text-sm leading-6 text-white/50">
                把当前 branch 的阶段性结果整理回父会话，避免手动复制粘贴。
              </div>
              <div className="mt-5 rounded-[24px] border border-white/8 bg-black/20 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">Transfer Preview</div>
                <div className="mt-3 space-y-3 text-sm text-white/75">
                  <div>
                    <div className="text-[11px] text-white/35">Branch</div>
                    <div className="mt-1">{workspace.topic.title}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-white/35">Parent</div>
                    <div className="mt-1">{activeParentTopic?.title ?? 'Parent topic'}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-white/35">Payload</div>
                    <div className="mt-1">紧凑摘要 + 最近分支结论，不会复制完整 branch 历史。</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-start justify-between gap-4 border-b border-white/5 px-6 py-5">
                <div>
                  <div className="text-lg font-semibold text-white">回传分支结果</div>
                  <div className="mt-1 text-sm text-white/50">可选写一条 handoff note，帮助父会话快速理解这次回传重点。</div>
                </div>
                <button
                  onClick={() => {
                    setShowBranchHandoffDialog(false);
                    setBranchHandoffDraft(null);
                  }}
                  className="rounded-full p-2 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 custom-scrollbar">
                <label className="block">
                  <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-white/35">Handoff Note</div>
                  <textarea
                    value={branchHandoffDraft.note}
                    onChange={(event) =>
                      setBranchHandoffDraft((current) =>
                        current
                          ? {
                              ...current,
                              note: event.target.value,
                            }
                          : current,
                      )
                    }
                    rows={10}
                    placeholder="例如：这里只保留 rollout 结论，不需要把 branch 里的推导过程一起并回去。"
                    className="w-full rounded-[22px] border border-white/10 bg-black/20 px-4 py-3 text-sm leading-7 text-white outline-none transition-colors focus:border-emerald-500/40 custom-scrollbar"
                  />
                </label>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-white/5 px-6 py-4">
                <div className="text-xs text-white/35">发送后会自动跳回父会话，方便你直接继续主线对话。</div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setShowBranchHandoffDialog(false);
                      setBranchHandoffDraft(null);
                    }}
                    className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => handleBranchHandoff().catch(console.error)}
                    disabled={branchHandoffSaving}
                    className="rounded-xl border border-emerald-500/20 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {branchHandoffSaving ? '发送中...' : 'Send to Parent'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showModelFeaturesDialog && workspace && modelFeaturesDraft ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm">
          <div className="flex h-[76vh] min-h-[600px] w-full max-w-[1040px] overflow-hidden rounded-[30px] border border-white/10 bg-[#171717] shadow-2xl">
            <div className="flex w-[292px] flex-col border-r border-white/5 bg-[#141414] px-5 py-5">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">Model Features</div>
              <div className="mt-3 text-2xl font-semibold text-white">{activeProviderName}</div>
              <div className="mt-2 text-sm text-white/55">{activeModel}</div>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/55">
                  {isResponsesProvider ? 'Responses API' : 'Chat Completions'}
                </span>
                {isQwenCompatible ? (
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] text-emerald-200/80">
                    Qwen Compatible
                  </span>
                ) : null}
              </div>
              <div className="mt-4 rounded-[22px] border border-white/8 bg-black/20 p-3 text-[12px] leading-5 text-white/62">
                当前会话级模型能力
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-start justify-between gap-4 border-b border-white/5 px-6 py-5">
                <div>
                  <div className="text-lg font-semibold text-white">模型功能设置</div>
                  <div className="mt-1 text-sm text-white/50">这些开关会绑定到当前会话，不会改写全局模型列表。</div>
                </div>
                <button
                  onClick={() => {
                    setShowModelFeaturesDialog(false);
                    setModelFeaturesDraft(null);
                  }}
                  className="rounded-full p-2 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 custom-scrollbar">
                <div className="space-y-5">
                  <div className="space-y-3 rounded-[22px] border border-white/10 bg-black/20 px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.16em] text-white/35">当前模型</div>
                        <div className="mt-2 text-sm text-white/85">
                          {activeProviderName} · {activeModel}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setShowModelFeaturesDialog(false);
                            handleOpenSessionSettings();
                          }}
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85 transition-colors hover:bg-white/10"
                        >
                          去会话设置
                        </button>
                        <button
                          onClick={() => loadCurrentModelMetadata(true).catch(console.error)}
                          disabled={modelInspectorLoading}
                          className="rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-sm text-sky-100 transition-colors hover:bg-sky-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {modelInspectorLoading ? '检测中...' : '刷新规格'}
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      {[
                        ['厂商', activeModelMetadata?.providerName || activeProviderName],
                        ['版本', activeModelMetadata?.versionLabel || '未识别'],
                        ['模式', activeModelMetadata?.modeLabel || '未识别'],
                        ['上下文', activeModelMetadata?.contextWindow ? activeModelMetadata.contextWindow.toLocaleString() : '未识别'],
                        ['最大输入', activeModelMetadata?.maxInputTokens ? activeModelMetadata.maxInputTokens.toLocaleString() : '未识别'],
                        ['思维链', activeModelMetadata?.longestReasoningTokens ? activeModelMetadata.longestReasoningTokens.toLocaleString() : '未识别'],
                        ['最大输出', activeModelMetadata?.maxOutputTokens ? activeModelMetadata.maxOutputTokens.toLocaleString() : '未识别'],
                        ['输入价格', activeModelMetadata?.inputCostPerMillion != null ? `${activeModelMetadata.inputCostPerMillion} 元 / 1M` : '未识别'],
                        ['输出价格', activeModelMetadata?.outputCostPerMillion != null ? `${activeModelMetadata.outputCostPerMillion} 元 / 1M` : '未识别'],
                      ].map(([label, value]) => (
                          <div key={label} className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
                            <div className="text-[10px] uppercase tracking-[0.14em] text-white/35">{label}</div>
                            <div className="mt-1 text-xs text-white/82">{value}</div>
                          </div>
                      ))}
                    </div>

                    {modelInspectorError ? (
                      <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-3 text-xs leading-6 text-red-100/85">
                        {modelInspectorError}
                      </div>
                    ) : null}

                    {activeModelMetadata?.pricingNote ? (
                      <div className="rounded-2xl border border-amber-500/18 bg-amber-500/8 px-3 py-3 text-[11px] leading-5 text-amber-100/78">
                        {activeModelMetadata.pricingNote}
                      </div>
                    ) : null}

                    {officialModelResourceLinks.length ? (
                      <div className="flex flex-wrap gap-2">
                        {officialModelResourceLinks.map((link) => (
                          <a
                            key={link.href}
                            href={link.href}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                          >
                            {link.label}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {isResponsesProvider ? (
                    <>
                      <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                        <div className="mb-3 text-[11px] uppercase tracking-[0.16em] text-white/35">Responses Core</div>
                        <div className="grid gap-3 md:grid-cols-2">
                          {[
                            {
                              key: 'enableThinking',
                              label: '思考模式',
                              description: '开启 `enable_thinking`，流式返回 reasoning content。',
                            },
                            {
                              key: 'enableCustomFunctionCalling',
                              label: 'Function Calling',
                              description: '将本地工具 schema 按官方 `type:function` 注入 Responses API。',
                            },
                          ].map((item) => {
                            const checked = modelFeaturesDraft[item.key as keyof ModelFeaturesDraft] as boolean;
                            return (
                              <button
                                key={item.key}
                                onClick={() =>
                                  setModelFeaturesDraft((current) =>
                                    current
                                      ? {
                                          ...current,
                                          [item.key]: !checked,
                                        }
                                      : current,
                                  )
                                }
                                className={`rounded-[20px] border p-4 text-left transition-all ${
                                  checked
                                    ? 'border-emerald-500/25 bg-emerald-500/10 shadow-[0_10px_28px_rgba(16,185,129,0.12)]'
                                    : 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.05]'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-sm font-medium text-white/90">{item.label}</div>
                                  <div
                                    className={`h-2.5 w-2.5 rounded-full ${
                                      checked ? 'bg-emerald-300 shadow-[0_0_16px_rgba(52,211,153,0.6)]' : 'bg-white/20'
                                    }`}
                                  />
                                </div>
                                <div className="mt-2 text-xs leading-6 text-white/45">{item.description}</div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                        <div className="mb-3 text-[11px] uppercase tracking-[0.16em] text-white/35">Responses Built-in Tools</div>
                        <div className="grid gap-3 md:grid-cols-2">
                          {[
                            ['webSearch', '联网搜索', '官方 `web_search`。'],
                            ['webSearchImage', '文搜图', '官方 `web_search_image`。'],
                            ['webExtractor', '网页抓取', '官方 `web_extractor`。'],
                            ['codeInterpreter', '代码解释器', '官方 `code_interpreter`。'],
                            ['imageSearch', '图搜图', '官方 `image_search`，需随消息附图。'],
                            ['mcp', 'MCP', '挂载当前已启用的 SSE MCP server。'],
                          ].map(([key, label, description]) => {
                            const checked = modelFeaturesDraft.responsesTools[key as keyof TopicModelFeatures['responsesTools']];
                            return (
                              <button
                                key={key}
                                onClick={() =>
                                  setModelFeaturesDraft((current) =>
                                    current
                                      ? {
                                          ...current,
                                          responsesTools: {
                                            ...current.responsesTools,
                                            [key]: !checked,
                                          },
                                        }
                                      : current,
                                  )
                                }
                                className={`rounded-[20px] border p-4 text-left transition-all ${
                                  checked
                                    ? 'border-sky-400/25 bg-sky-400/10 shadow-[0_10px_28px_rgba(56,189,248,0.12)]'
                                    : 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.05]'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-sm font-medium text-white/90">{label}</div>
                                  <div
                                    className={`h-2.5 w-2.5 rounded-full ${
                                      checked ? 'bg-sky-300 shadow-[0_0_16px_rgba(125,211,252,0.6)]' : 'bg-white/20'
                                    }`}
                                  />
                                </div>
                                <div className="mt-2 text-xs leading-6 text-white/45">{description}</div>
                              </button>
                            );
                          })}
                        </div>
                        {modelFeaturesDraft.responsesTools.imageSearch ? (
                          <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-[11px] leading-5 text-white/55">
                            {composerImageAttachments.length
                              ? `当前输入框里已附加 ${composerImageAttachments.length} 张图片，可直接用于图搜图。`
                              : '图搜图需要先在聊天框附加图片。'}
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                      <div className="mb-3 text-[11px] uppercase tracking-[0.16em] text-white/35">Chat Advanced</div>
                      {isQwenCompatible ? (
                        <div className="space-y-3">
                          <button
                            onClick={() =>
                              setModelFeaturesDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      enableThinking: !current.enableThinking,
                                      structuredOutput: {
                                        ...current.structuredOutput,
                                        mode:
                                          !current.enableThinking && current.structuredOutput.mode !== 'text'
                                            ? 'text'
                                            : current.structuredOutput.mode,
                                      },
                                    }
                                  : current,
                              )
                            }
                            className={`w-full rounded-[20px] border p-4 text-left transition-all ${
                              modelFeaturesDraft.enableThinking
                                ? 'border-emerald-500/25 bg-emerald-500/10 shadow-[0_10px_28px_rgba(16,185,129,0.12)]'
                                : 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.05]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-medium text-white/90">思考模式</div>
                              <div
                                className={`h-2.5 w-2.5 rounded-full ${
                                  modelFeaturesDraft.enableThinking
                                    ? 'bg-emerald-300 shadow-[0_0_16px_rgba(52,211,153,0.6)]'
                                    : 'bg-white/20'
                                }`}
                              />
                            </div>
                            <div className="mt-2 text-xs leading-6 text-white/45">
                              走 `extra_body.enable_thinking = true`，适用于 Qwen Chat 通道。
                            </div>
                          </button>

                          <div className="rounded-[20px] border border-white/10 bg-black/20 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-medium text-white/90">结构化输出</div>
                                <div className="mt-1 text-[11px] leading-5 text-white/45">
                                  按官方文档通过 `response_format` 使用；开启结构化输出时会禁用 thinking。
                                </div>
                              </div>
                              <select
                                value={modelFeaturesDraft.structuredOutput.mode}
                                onChange={(event) =>
                                  setModelFeaturesDraft((current) =>
                                    current
                                      ? {
                                          ...current,
                                          structuredOutput: {
                                            ...current.structuredOutput,
                                            mode: event.target.value as TopicModelFeatures['structuredOutput']['mode'],
                                          },
                                          enableThinking: event.target.value === 'text' ? current.enableThinking : false,
                                        }
                                      : current,
                                  )
                                }
                                className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none"
                              >
                                <option value="text">纯文本</option>
                                <option value="json_object">JSON Object</option>
                                <option value="json_schema">JSON Schema</option>
                              </select>
                            </div>
                            {modelFeaturesDraft.structuredOutput.mode === 'json_schema' ? (
                              <textarea
                                value={modelFeaturesDraft.structuredOutput.schema}
                                onChange={(event) =>
                                  setModelFeaturesDraft((current) =>
                                    current
                                      ? {
                                          ...current,
                                          structuredOutput: {
                                            ...current.structuredOutput,
                                            schema: event.target.value,
                                          },
                                        }
                                      : current,
                                  )
                                }
                                className="mt-3 min-h-[132px] w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-3 font-mono text-[11px] leading-6 text-white outline-none"
                              />
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-[20px] border border-dashed border-white/10 bg-black/20 px-4 py-5 text-sm leading-6 text-white/45">
                          当前厂商未配置专属高级能力面板。普通 chat 模式会继续使用基础工具调用链。
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-white/5 px-6 py-4">
                <div className="text-xs text-white/35">
                  Responses 模式会使用官方内置工具与 Function Calling 循环；基础联网搜索仍由聊天框单独控制。
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setShowModelFeaturesDialog(false);
                      setModelFeaturesDraft(null);
                    }}
                    className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => handleSaveModelFeatures().catch(console.error)}
                    disabled={modelFeaturesSaving}
                    className="rounded-xl border border-emerald-500/20 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {modelFeaturesSaving ? '保存中...' : '保存模型功能'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showSessionSettings && workspace && sessionSettingsDraft ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm">
          <div className="flex h-[78vh] min-h-[620px] w-full max-w-[1040px] overflow-hidden rounded-[30px] border border-white/10 bg-[#171717] shadow-2xl">
            <div className="flex w-[320px] flex-col border-r border-white/5 bg-[#141414] px-5 py-6">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">Session Runtime</div>
              <div className="mt-3 text-2xl font-semibold text-white">{workspace.topic.title}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/55">
                  {workspace.topic.sessionMode === 'quick' ? 'Quick Session' : 'Agent Session'}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/45">
                  {workspace.agent.name}
                </span>
              </div>
              <div className="mt-5 rounded-[24px] border border-white/8 bg-black/20 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">Effective Runtime</div>
                <div className="mt-3 space-y-3 text-sm text-white/75">
                  <div>
                    <div className="text-[11px] text-white/35">Identity</div>
                    <div className="mt-1">{workspace.runtime.displayName}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-white/35">Model</div>
                    <div className="mt-1">
                      {activeProviderName} · {activeModel}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-white/35">Prompt Source</div>
                    <div className="mt-1">
                      {workspace.topic.systemPromptOverride ? 'Session override' : 'Agent template fallback'}
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-4 rounded-[24px] border border-amber-500/15 bg-amber-500/8 p-4 text-sm leading-6 text-amber-100/75">
                原始消息仍按 topic 隔离。这里只调整当前会话实例的身份、模型和能力开关，不会改写 agent 模板本身。
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-start justify-between gap-4 border-b border-white/5 px-6 py-5">
                <div>
                  <div className="text-lg font-semibold text-white">会话设置</div>
                  <div className="mt-1 text-sm text-white/50">当前 topic 的身份、提示词、模型和功能开关。</div>
                </div>
                <button
                  onClick={() => {
                    setShowSessionSettings(false);
                    setSessionSettingsDraft(null);
                  }}
                  className="rounded-full p-2 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 custom-scrollbar">
                <div className="space-y-5">
                  <div className="grid gap-5 md:grid-cols-2">
                    <label className="block">
                      <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-white/35">Display Name</div>
                      <input
                        type="text"
                        value={sessionSettingsDraft.displayName}
                        onChange={(event) =>
                          setSessionSettingsDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  displayName: event.target.value,
                                }
                              : current,
                          )
                        }
                        placeholder={workspace.runtime.displayName}
                        className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-emerald-500/40"
                      />
                    </label>

                    <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                      <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-white/35">Model Override</div>
                      <div className="text-sm text-white/80">
                        {(sessionSettingsDraft.providerIdOverride || activeProviderName) &&
                        (sessionSettingsDraft.modelOverride || activeModel)
                          ? `${config.providers.find((provider) => provider.id === sessionSettingsDraft.providerIdOverride)?.name ?? activeProviderName} · ${sessionSettingsDraft.modelOverride || activeModel}`
                          : 'Use inherited model'}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={openTopicModelPicker}
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85 transition-colors hover:bg-white/10"
                        >
                          选择会话模型
                        </button>
                        <button
                          onClick={() =>
                            setSessionSettingsDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    providerIdOverride: '',
                                    modelOverride: '',
                                  }
                                : current,
                            )
                          }
                          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/55 transition-colors hover:bg-white/10 hover:text-white/85"
                        >
                          跟随默认
                        </button>
                      </div>
                    </div>
                  </div>

                  <label className="block">
                    <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-white/35">System Prompt Override</div>
                    <textarea
                      value={sessionSettingsDraft.systemPromptOverride}
                      onChange={(event) =>
                        setSessionSettingsDraft((current) =>
                          current
                            ? {
                                ...current,
                                systemPromptOverride: event.target.value,
                              }
                            : current,
                        )
                      }
                      placeholder={workspace.runtime.systemPrompt}
                      rows={8}
                      className="w-full rounded-[22px] border border-white/10 bg-black/20 px-4 py-3 text-sm leading-7 text-white outline-none transition-colors focus:border-emerald-500/40 custom-scrollbar"
                    />
                  </label>

                  <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                    <div className="mb-3 text-[11px] uppercase tracking-[0.16em] text-white/35">Feature Flags</div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {[
                        {
                          key: 'enableMemory',
                          label: '记忆注入',
                          description: '控制当前会话是否装配 memory context。',
                        },
                        {
                          key: 'enableSkills',
                          label: 'Skills 注入',
                          description: '控制当前会话是否补入命中的 SKILL.md。',
                        },
                        {
                          key: 'enableTools',
                          label: '工具调用',
                          description: '关闭后会走纯模型路径，不绑定 agent tools。',
                        },
                        {
                          key: 'enableAgentSharedShortTerm',
                          label: '共享短期记忆',
                          description: '允许同一 agent 的近期 daily 记忆跨 topic 共享。',
                        },
                      ].map((item) => {
                        const checked = sessionSettingsDraft[item.key as keyof SessionSettingsDraft] as boolean;
                        return (
                          <button
                            key={item.key}
                            onClick={() =>
                              setSessionSettingsDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      [item.key]: !checked,
                                    }
                                  : current,
                              )
                            }
                            className={`rounded-[20px] border p-4 text-left transition-all ${
                              checked
                                ? 'border-emerald-500/25 bg-emerald-500/10 shadow-[0_10px_28px_rgba(16,185,129,0.12)]'
                                : 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.05]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-medium text-white/90">{item.label}</div>
                              <div
                                className={`h-2.5 w-2.5 rounded-full ${
                                  checked ? 'bg-emerald-300 shadow-[0_0_16px_rgba(52,211,153,0.6)]' : 'bg-white/20'
                                }`}
                              />
                            </div>
                            <div className="mt-2 text-xs leading-6 text-white/45">{item.description}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-white/5 px-6 py-4">
                <div className="text-xs text-white/35">
                  关闭 override 时会回退到 agent 模板或全局默认，不会丢失历史消息。
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setShowSessionSettings(false);
                      setSessionSettingsDraft(null);
                    }}
                    className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => handleSaveSessionSettings().catch(console.error)}
                    disabled={sessionSettingsSaving}
                    className="rounded-xl border border-emerald-500/20 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {sessionSettingsSaving ? '保存中...' : '保存会话设置'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
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
                {!filteredModelPickerProviders.groups.length ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 px-4 py-8 text-center text-sm text-white/40">
                    没有匹配的 provider。
                  </div>
                ) : (
                  filteredModelPickerProviders.groups.map((group) => {
                    const collapsed = collapsedPickerProviderGroups[group.id] ?? false;

                    return (
                      <div key={group.id} className="rounded-[22px] border border-white/5 bg-black/10 p-2">
                        <button
                          onClick={() =>
                            setCollapsedPickerProviderGroups((current) => ({
                              ...current,
                              [group.id]: !collapsed,
                            }))
                          }
                          className="flex w-full items-center justify-between rounded-[18px] px-3 py-2 text-left transition-colors hover:bg-white/5"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-2xl bg-white/5">
                              {collapsed ? (
                                <ChevronRight size={14} className="text-white/55" />
                              ) : (
                                <ChevronDown size={14} className="text-white/55" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-white/90">{group.label}</div>
                              <div className="truncate text-[11px] text-white/35">{group.description}</div>
                            </div>
                          </div>
                          <div className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/45">
                            {group.totalCount}
                          </div>
                        </button>

                        {!collapsed ? (
                          <div className="mt-2 space-y-1">
                            {group.providers.map((provider) => (
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
                                <div className="flex items-center gap-2">
                                  <div className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] text-white/40">
                                    {getProviderProtocolMeta(provider).label}
                                  </div>
                                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400/15 to-emerald-600/15">
                                    <Cloud size={14} className="text-emerald-300" />
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-start justify-between gap-4 border-b border-white/5 px-6 py-5">
                <div>
                  <div className="text-lg font-semibold text-white">
                    {modelPickerTarget === 'topic'
                      ? '选择会话模型'
                      : modelPickerTarget === 'quick'
                        ? '选择 Quick 模型'
                        : '选择聊天模型'}
                  </div>
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
                    <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/65">
                      {modelPickerTarget === 'topic' ? 'Current Session Model' : 'Current Global Model'}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/75">
                        {pickerCurrentProviderName}
                      </span>
                      <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-100">
                        {pickerEffectiveModel}
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
                                              modelPickerProvider.id === pickerEffectiveProviderId &&
                                              model === pickerEffectiveModel;

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
                                                    <span>
                                                      {active
                                                        ? modelPickerTarget === 'topic'
                                                          ? '当前会话使用中'
                                                          : '当前全局使用中'
                                                        : modelPickerTarget === 'topic'
                                                          ? '应用到当前会话'
                                                          : '点击切换'}
                                                    </span>
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
