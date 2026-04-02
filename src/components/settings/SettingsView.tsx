import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpFromLine,
  Bot,
  Box,
  Brain,
  ChevronDown,
  ChevronRight,
  Cloud,
  Database,
  Download,
  Eye,
  EyeOff,
  FileText,
  FolderUp,
  Globe,
  HardDriveDownload,
  HardDriveUpload,
  Keyboard,
  Languages,
  Link2,
  MessageSquarePlus,
  Monitor,
  Network,
  Palette,
  Plus,
  RefreshCw,
  Minus,
  Search,
  Server,
  Settings as SettingsIcon,
  Sliders,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  type AgentConfig,
  type ApiServerSettings,
  type McpServerConfig,
  type ModelProvider,
  type SearchProviderConfig,
  normalizeAgentConfig,
  saveAgentConfig,
} from '../../lib/agent/config';
import {
  type ProviderProtocol,
  buildProviderModelListCandidates,
  getProviderBaseUrlPlaceholder,
  getProviderRequestMode,
  getProviderRequestPreview,
} from '../../lib/provider-compatibility';
import {
  addDocument,
  exportWorkspaceData,
  getDataStats,
  importWorkspaceData,
  type DataStats,
} from '../../lib/db';
import {
  THEME_COLOR_BOARD,
  THEME_PRESETS,
  applyThemePreferences,
  getThemePresetByColor,
} from '../../lib/theme';
import type { AgentProfile } from '../../lib/agent-workspace';
import { syncCurrentAgentMemory } from '../../lib/agent-workspace';
import {
  createAgentMemoryApiFileStore,
  deleteAgentMemoryFile,
  ensureAgentMemoryFile,
  getApiServerHealth,
  getNightlyArchiveStatus,
  listAgentMemoryFiles,
  readAgentMemoryFile,
  resolveApiServerBaseUrl,
  saveNightlyArchiveSettings,
  syncAgentMemoryLifecycleForAgent,
  writeAgentMemoryFile,
  type AgentMemoryFileEntry,
  type NightlyArchiveStatus,
} from '../../lib/agent-memory-api';

const CATEGORIES = [
  { id: 'models', label: '模型服务', icon: Cloud },
  { id: 'default', label: '默认模型', icon: Box },
  { id: 'general', label: '常规设置', icon: Sliders },
  { id: 'display', label: '显示设置', icon: Monitor },
  { id: 'data', label: '数据设置', icon: Database },
  { id: 'mcp', label: 'MCP 服务器', icon: Server },
  { id: 'search', label: '网络搜索', icon: Globe },
  { id: 'memory', label: '全局记忆', icon: Brain },
  { id: 'api', label: 'API 服务器', icon: Network },
  { id: 'docs', label: '文档处理', icon: FileText },
  { id: 'snippets', label: '快捷短语', icon: MessageSquarePlus },
  { id: 'shortcuts', label: '快捷键', icon: Keyboard },
  { id: 'assistant', label: '快捷助手', icon: Bot },
] as const;

const LANGUAGE_OPTIONS = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' },
  { value: 'ja-JP', label: '日本语' },
  { value: 'ko-KR', label: '한국어' },
] as const;

const PROXY_OPTIONS = [
  { value: 'direct', label: '直连', description: '浏览器直接请求模型与搜索服务。' },
  { value: 'system', label: '系统代理', description: '优先跟随系统或浏览器代理配置。' },
  { value: 'custom', label: '自定义代理', description: '通过自定义网关地址转发请求。' },
] as const;

const PROVIDER_PROTOCOL_OPTIONS: Array<{
  value: ProviderProtocol;
  label: string;
  description: string;
}> = [
  {
    value: 'openai_chat_compatible',
    label: 'OpenAI 兼容',
    description: '调用 `/chat/completions`，适合大多数兼容 OpenAI 的模型服务。',
  },
  {
    value: 'openai_responses_compatible',
    label: 'OpenAI Responses 兼容',
    description: '调用 `/responses`，适合 Qwen 内置工具、MCP 与更完整的 Responses 工作流。',
  },
  {
    value: 'anthropic_native',
    label: 'Anthropic 原生',
    description: '走 Anthropic Messages 接口，不使用 OpenAI 兼容路径。',
  },
] as const;

const SEARCH_TYPE_OPTIONS = [
  { value: 'api', label: 'API 服务商' },
  { value: 'local', label: '本地搜索' },
] as const;

const MCP_LIBRARY = [
  {
    id: 'mcp_tpl_alibaba',
    name: '阿里云百炼',
    provider: '市场',
    description: '适合把云端工具能力接入到工作区。',
    transport: 'streamable-http' as const,
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    homepage: 'https://www.aliyun.com/product/bailian',
  },
  {
    id: 'mcp_tpl_modelscope',
    name: 'ModelScope',
    provider: '市场',
    description: '面向模型与工作流的通用接入模板。',
    transport: 'streamable-http' as const,
    url: 'https://modelscope.cn/',
    homepage: 'https://modelscope.cn/',
  },
  {
    id: 'mcp_tpl_mcp_router',
    name: 'MCP Router',
    provider: '内置服务器',
    description: '适合作为多个 MCP 后端的聚合入口。',
    transport: 'streamable-http' as const,
    url: 'http://localhost:7331/mcp',
    homepage: 'https://github.com/modelcontextprotocol',
  },
  {
    id: 'mcp_tpl_local_stdio',
    name: '本地 Stdio Server',
    provider: '内置服务器',
    description: '通过命令行方式启动本地 MCP 服务。',
    transport: 'stdio' as const,
    url: '',
    homepage: 'https://modelcontextprotocol.io/',
  },
] as const;

type CategoryId = (typeof CATEGORIES)[number]['id'];

interface SettingsViewProps {
  config: AgentConfig;
  agents?: AgentProfile[];
  activeAgentId?: string | null;
  initialCategory?: CategoryId;
  onClose: () => void;
  onConfigSaved?: (config: AgentConfig) => void;
  onMemoryFilesChanged?: (agentId: string) => void | Promise<void>;
}

interface ProviderModelFetchResult {
  models: string[];
  resolvedUrl: string;
}

interface ModelImportDialogState {
  providerId: string;
  providerName: string;
  resolvedUrl: string;
  models: string[];
}

interface MemoryFileStatus {
  tone: 'neutral' | 'success' | 'error';
  message: string;
}

interface AddProviderDraft {
  vendorName: string;
  protocol: ProviderProtocol;
  apiKey: string;
  baseUrl: string;
}

interface ModelGroup {
  id: string;
  label: string;
  totalCount: number;
  series: Array<{
    id: string;
    label: string;
    models: string[];
  }>;
}

const MODEL_FAMILY_DEFINITIONS = [
  { label: 'Qwen', patterns: ['qwen'] },
  { label: 'GPT', patterns: ['gpt-', 'chatgpt-', 'o1', 'o3', 'o4', 'o-'] },
  { label: 'Doubao', patterns: ['doubao'] },
  { label: 'DeepSeek', patterns: ['deepseek'] },
  { label: 'Kimi', patterns: ['kimi'] },
  { label: 'Moonshot', patterns: ['moonshot'] },
  { label: 'Gemini', patterns: ['gemini'] },
  { label: 'Grok', patterns: ['grok'] },
  { label: 'Claude', patterns: ['claude'] },
  { label: 'Llama', patterns: ['llama'] },
  { label: 'GLM', patterns: ['glm'] },
  { label: 'MiniMax', patterns: ['minimax'] },
] as const;

const MODEL_FAMILY_ORDER: Map<string, number> = new Map(
  MODEL_FAMILY_DEFINITIONS.map((family, index) => [family.label, index]),
);

function formatNightlyArchiveRunSummary(status: NightlyArchiveStatus | null) {
  if (!status) {
    return '当前未读取到夜间归档状态。';
  }

  const lastRun = status.state.lastRunSummary;
  if (!lastRun) {
    return status.settings.enabled
      ? `已启用，计划时间 ${status.settings.time}，${status.settings.useLlmScoring ? '使用 LLM 评分' : '使用规则评分'}，下一次执行 ${status.nextRunAt ?? '待计算'}。`
      : '当前未启用夜间自动归档。';
  }

  return `最近一次 ${lastRun.trigger === 'catchup' ? '补跑' : '定时'}：处理 ${lastRun.processedAgents} 个 agent，成功 ${lastRun.successfulAgents}，失败 ${lastRun.failedAgents}，晋升 ${lastRun.promotedCount}，LLM 评分 ${lastRun.llmScoredCount}，规则回退 ${lastRun.ruleFallbackCount}。`;
}

function formatLifecycleSyncStatus(input: {
  scannedCount: number;
  warmUpdated: number;
  coldUpdated: number;
  skippedCount: number;
  failures: Array<{ path: string; message: string }>;
}) {
  const summary = `温冷层同步完成：扫描 ${input.scannedCount} 个源文件，更新 warm ${input.warmUpdated}、cold ${input.coldUpdated}，跳过 ${input.skippedCount}，失败 ${input.failures.length}。`;
  if (input.failures.length === 0) {
    return summary;
  }

  const failurePreview = input.failures
    .slice(0, 2)
    .map((failure) => `${failure.path}: ${failure.message}`)
    .join('；');
  const suffix = input.failures.length > 2 ? `；其余 ${input.failures.length - 2} 项见控制台` : '';
  return `${summary} ${failurePreview}${suffix}`;
}

function getProviderProtocolSuffix(protocol: ProviderProtocol) {
  switch (protocol) {
    case 'openai_responses_compatible':
      return 'Responses';
    case 'anthropic_native':
      return 'Anthropic';
    case 'openai_chat_compatible':
    default:
      return 'Chat';
  }
}

function createProviderId(name: string, protocol: ProviderProtocol) {
  const normalizedName = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const suffix = getProviderProtocolSuffix(protocol).toLowerCase();
  return `custom_${normalizedName || 'provider'}_${suffix}_${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

function buildProviderDisplayName(name: string, protocol: ProviderProtocol) {
  return `${name.trim()} · ${getProviderProtocolSuffix(protocol)}`;
}

function createMcpId() {
  return `mcp_${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

function createSearchProviderId() {
  return `search_custom_${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

function normalizeModelGroupKey(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function getModelBasename(model: string) {
  const segments = model.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? model;
}

function getModelSeriesDescriptor(model: string) {
  const basename = getModelBasename(model);
  const tokens = basename.split(/[-_:]+/).filter(Boolean);
  const normalizedTokens = tokens.map((token) => token.toLowerCase());
  const seriesLength = tokens.length >= 3 ? tokens.length - 1 : tokens.length;
  const seriesTokens = tokens.slice(0, Math.max(1, seriesLength));
  const normalizedSeriesTokens = normalizedTokens.slice(0, Math.max(1, seriesLength));

  return {
    key: normalizedSeriesTokens.join('-'),
    label: seriesTokens.join('-'),
  };
}

function classifyModelFamily(provider: ModelProvider, model: string) {
  const normalized = getModelBasename(model).toLowerCase();
  const providerName = provider.name.toLowerCase();

  const matchedFamily = MODEL_FAMILY_DEFINITIONS.find((family) =>
    family.patterns.some((pattern) => normalized.startsWith(pattern) || normalized.includes(pattern)),
  );
  if (matchedFamily) {
    return matchedFamily.label;
  }

  if (normalized.includes('embedding')) {
    return 'Embeddings';
  }
  if (providerName.includes('openai')) {
    return 'OpenAI Other';
  }
  if (providerName.includes('anthropic')) {
    return 'Anthropic Other';
  }
  const providerMatchedFamily = MODEL_FAMILY_DEFINITIONS.find((family) =>
    family.patterns.some((pattern) => providerName.includes(pattern)),
  );
  if (providerMatchedFamily) {
    return providerMatchedFamily.label;
  }

  return 'Other';
}

function buildModelGroups(provider: ModelProvider, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredModels = provider.models.filter((model) =>
    !normalizedQuery || model.toLowerCase().includes(normalizedQuery),
  );
  const grouped = new Map<string, string[]>();
  filteredModels.forEach((model) => {
    const family = classifyModelFamily(provider, model);
    const bucket = grouped.get(family) ?? [];
    bucket.push(model);
    grouped.set(family, bucket);
  });

  const groups = [...grouped.entries()]
    .map<ModelGroup>(([label, models]) => {
      const bySeries = new Map<string, { label: string; models: string[] }>();

      models.forEach((model) => {
        const descriptor = getModelSeriesDescriptor(model);
        const bucket = bySeries.get(descriptor.key) ?? { label: descriptor.label, models: [] };
        bucket.models.push(model);
        bySeries.set(descriptor.key, bucket);
      });

      const series = [...bySeries.entries()]
        .map(([key, entry]) => ({
          id: `${normalizeModelGroupKey(label)}_${normalizeModelGroupKey(key)}`,
          label: entry.label,
          models: entry.models.slice(),
        }))

      return {
        id: normalizeModelGroupKey(label),
        label,
        totalCount: models.length,
        series,
      };
    })
    .sort((left, right) => {
      const leftRank = MODEL_FAMILY_ORDER.get(left.label) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = MODEL_FAMILY_ORDER.get(right.label) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || 0;
    });

  return {
    totalCount: filteredModels.length,
    groups,
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadJson(data: unknown, filename: string) {
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename);
}

function downloadText(content: string, filename: string) {
  downloadBlob(new Blob([content], { type: 'text/markdown;charset=utf-8' }), filename);
}

async function readFileAsText(file: File) {
  return file.text();
}

function buildMarkdownExport(payload: Awaited<ReturnType<typeof exportWorkspaceData>>) {
  return payload.workspaces
    .map((workspace) => {
      const laneSections = workspace.lanes
        .map((lane) => {
          const messages = workspace.messagesByLane[lane.id] ?? [];
          const renderedMessages = messages
            .map(
              (message) =>
                `### ${message.authorName} · ${message.role}\n\n${message.content.trim() || '(empty)'}`,
            )
            .join('\n\n');

          return `## ${lane.name}\n\n${lane.description}\n\n${renderedMessages}`;
        })
        .join('\n\n---\n\n');

      return `# ${workspace.conversation.title}\n\nCreated: ${workspace.conversation.createdAt}\n\n${laneSections}`;
    })
    .join('\n\n\n');
}

function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.025))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-white/90">{title}</h3>
          {description ? <p className="mt-1 text-xs text-white/45">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function ToggleCard({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.02))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-white/90">{title}</div>
          <p className="mt-1 text-xs text-white/45">{description}</p>
        </div>
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      </div>
    </label>
  );
}

function WeightInputCard({
  label,
  value,
  description,
  min = 0,
  max = 2,
  step = 0.1,
  onChange,
}: {
  label: string;
  value: number;
  description: string;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-white/88">{label}</div>
        <div className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/60">
          {value.toFixed(1)}
        </div>
      </div>
      <p className="mt-1 text-[11px] leading-5 text-white/42">{description}</p>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-3 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
      />
    </div>
  );
}

export const SettingsView = ({
  config,
  agents = [],
  activeAgentId = null,
  initialCategory = 'models',
  onClose,
  onConfigSaved,
  onMemoryFilesChanged,
}: SettingsViewProps) => {
  const [draft, setDraft] = useState<AgentConfig>(() => normalizeAgentConfig(config));
  const draftRef = useRef<AgentConfig>(normalizeAgentConfig(config));
  const [activeCategory, setActiveCategory] = useState<CategoryId>(initialCategory);
  const [activeProviderId, setActiveProviderId] = useState<string>(config.providers[0]?.id ?? '');
  const [activeSearchProviderId, setActiveSearchProviderId] = useState<string>(
    config.search.providers[0]?.id ?? '',
  );
  const [activeMcpId, setActiveMcpId] = useState<string>(config.mcpServers[0]?.id ?? '');
  const [showKey, setShowKey] = useState(false);
  const [providerSearchQuery, setProviderSearchQuery] = useState('');
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [collapsedModelGroups, setCollapsedModelGroups] = useState<Record<string, boolean>>({});
  const [collapsedModelSeries, setCollapsedModelSeries] = useState<Record<string, boolean>>({});
  const [stats, setStats] = useState<DataStats | null>(null);
  const [providerChecks, setProviderChecks] = useState<Record<string, string>>({});
  const [providerLoadingId, setProviderLoadingId] = useState<string | null>(null);
  const [showAddProviderDialog, setShowAddProviderDialog] = useState(false);
  const [addProviderDraft, setAddProviderDraft] = useState<AddProviderDraft>({
    vendorName: '',
    protocol: 'openai_chat_compatible',
    apiKey: '',
    baseUrl: getProviderBaseUrlPlaceholder('openai_chat_compatible'),
  });
  const [modelImportDialog, setModelImportDialog] = useState<ModelImportDialogState | null>(null);
  const [importModelSearchQuery, setImportModelSearchQuery] = useState('');
  const [importOnlyNotAdded, setImportOnlyNotAdded] = useState(true);
  const [collapsedImportGroups, setCollapsedImportGroups] = useState<Record<string, boolean>>({});
  const [collapsedImportSeries, setCollapsedImportSeries] = useState<Record<string, boolean>>({});
  const [showThemeBoard, setShowThemeBoard] = useState(false);
  const [activeMemoryAgentId, setActiveMemoryAgentId] = useState<string>(activeAgentId ?? agents[0]?.id ?? '');
  const [memoryFiles, setMemoryFiles] = useState<AgentMemoryFileEntry[]>([]);
  const [activeMemoryFilePath, setActiveMemoryFilePath] = useState<string | null>(null);
  const [memoryFileContent, setMemoryFileContent] = useState('');
  const [memoryFileDirty, setMemoryFileDirty] = useState(false);
  const [memoryFileLoading, setMemoryFileLoading] = useState(false);
  const [memoryFileStatus, setMemoryFileStatus] = useState<MemoryFileStatus | null>(null);
  const [apiServerSummary, setApiServerSummary] = useState<string>('');
  const [configSaveStatus, setConfigSaveStatus] = useState<MemoryFileStatus | null>(null);
  const [nightlyArchiveStatus, setNightlyArchiveStatus] = useState<NightlyArchiveStatus | null>(null);
  const [nightlyArchiveLoading, setNightlyArchiveLoading] = useState(false);
  const [nightlyArchiveEnabled, setNightlyArchiveEnabled] = useState(false);
  const [nightlyArchiveTime, setNightlyArchiveTime] = useState('03:00');
  const [nightlyArchiveUseLlmScoring, setNightlyArchiveUseLlmScoring] = useState(false);
  const [nightlyArchiveMessage, setNightlyArchiveMessage] = useState<MemoryFileStatus | null>(null);
  const backupRestoreInputRef = useRef<HTMLInputElement>(null);
  const externalImportInputRef = useRef<HTMLInputElement>(null);
  const memoryFilesRequestIdRef = useRef(0);
  const nightlyArchiveRequestIdRef = useRef(0);

  const fetchProviderModels = async (provider: ModelProvider): Promise<ProviderModelFetchResult> => {
    const candidates = buildProviderModelListCandidates(provider);
    if (!provider.apiKey.trim()) {
      throw new Error('请先填写 API Key。');
    }
    if (candidates.length === 0) {
      throw new Error('请先填写 API 地址。');
    }

    let lastError = '未能获取模型列表。';

    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${provider.apiKey.trim()}`,
            'Content-Type': 'application/json',
          },
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message =
            payload?.error?.message ||
            payload?.message ||
            `HTTP ${response.status} ${response.statusText}`;
          lastError = `${url} 返回错误: ${message}`;
          continue;
        }

        const models: string[] = Array.isArray(payload?.data)
          ? payload.data
              .map((entry: any) => entry?.id || entry?.model || entry?.name)
              .filter((entry: unknown): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
          : [];

        if (models.length === 0) {
          lastError = `${url} 请求成功，但没有解析到模型列表。`;
          continue;
        }

        return {
          models: Array.from(new Set(models)),
          resolvedUrl: url,
        };
      } catch (error: any) {
        lastError = `${url} 请求失败: ${error.message}`;
      }
    }

    throw new Error(lastError);
  };

  const loadStats = async () => {
    const nextStats = await getDataStats();
    setStats(nextStats);
  };

  useEffect(() => {
    setDraft(normalizeAgentConfig(config));
    draftRef.current = normalizeAgentConfig(config);
    applyThemePreferences(config);
  }, [config]);

  useEffect(() => {
    setActiveCategory(initialCategory);
  }, [initialCategory]);

  useEffect(() => {
    if (!activeProviderId && draft.providers.length > 0) {
      setActiveProviderId(draft.providers[0]!.id);
    }
    if (!draft.providers.find((provider) => provider.id === activeProviderId) && draft.providers[0]) {
      setActiveProviderId(draft.providers[0].id);
    }
  }, [draft.providers, activeProviderId]);

  useEffect(() => {
    if (!draft.search.providers.find((provider) => provider.id === activeSearchProviderId)) {
      setActiveSearchProviderId(draft.search.providers[0]?.id ?? '');
    }
  }, [draft.search.providers, activeSearchProviderId]);

  useEffect(() => {
    if (!draft.mcpServers.find((server) => server.id === activeMcpId) && draft.mcpServers[0]) {
      setActiveMcpId(draft.mcpServers[0].id);
    }
  }, [draft.mcpServers, activeMcpId]);

  useEffect(() => {
    if (activeCategory === 'data') {
      loadStats().catch(console.error);
    }
  }, [activeCategory]);

  useEffect(() => {
    const nextAgentId = activeAgentId ?? agents[0]?.id ?? '';
    if (nextAgentId && !agents.find((agent) => agent.id === activeMemoryAgentId)) {
      setActiveMemoryAgentId(nextAgentId);
    }
  }, [activeAgentId, activeMemoryAgentId, agents]);

  const commit = async (nextConfig: AgentConfig) => {
    const normalized = normalizeAgentConfig(nextConfig);
    setDraft(normalized);
    draftRef.current = normalized;
    applyThemePreferences(normalized);
    try {
      await saveAgentConfig(normalized);
      setConfigSaveStatus({ tone: 'success', message: '已写入项目根目录 config.json。' });
      onConfigSaved?.(normalized);
    } catch (error) {
      setConfigSaveStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : '写入 config.json 失败。',
      });
    }
  };

  const updateDraft = async (updater: (current: AgentConfig) => AgentConfig) => {
    await commit(updater(draftRef.current));
  };

  const updateProvider = async (id: string, updates: Partial<ModelProvider>) => {
    await updateDraft((current) => ({
      ...current,
      providers: current.providers.map((provider) =>
        provider.id === id ? { ...provider, ...updates } : provider,
      ),
    }));
  };

  const updateSearchProvider = async (id: string, updates: Partial<SearchProviderConfig>) => {
    await updateDraft((current) => ({
      ...current,
      search: {
        ...current.search,
        providers: current.search.providers.map((provider) =>
          provider.id === id ? { ...provider, ...updates } : provider,
        ),
      },
    }));
  };

  const updateMcpServer = async (id: string, updates: Partial<McpServerConfig>) => {
    await updateDraft((current) => ({
      ...current,
      mcpServers: current.mcpServers.map((server) =>
        server.id === id ? { ...server, ...updates } : server,
      ),
    }));
  };

  const filteredProviders = useMemo(
    () =>
      draft.providers.filter((provider) =>
        provider.name.toLowerCase().includes(providerSearchQuery.toLowerCase()),
      ),
    [draft.providers, providerSearchQuery],
  );

  const activeProvider = draft.providers.find((provider) => provider.id === activeProviderId);
  const activeSearchProvider = draft.search.providers.find(
    (provider) => provider.id === activeSearchProviderId,
  );
  const activeMcpServer = draft.mcpServers.find((server) => server.id === activeMcpId);
  const activeMcpTemplate = MCP_LIBRARY.find((server) => server.id === activeMcpId);
  const modelGroups = useMemo(
    () => (activeProvider ? buildModelGroups(activeProvider, modelSearchQuery) : { totalCount: 0, groups: [] }),
    [activeProvider, modelSearchQuery],
  );
  const importDialogProvider = modelImportDialog
    ? draft.providers.find((provider) => provider.id === modelImportDialog.providerId) ?? null
    : null;
  const importedModelIds = useMemo(
    () => new Set((importDialogProvider?.models ?? []).map((model) => model.toLowerCase())),
    [importDialogProvider],
  );
  const importModelGroups = useMemo(
    () =>
      modelImportDialog
        ? buildModelGroups(
            {
              id: modelImportDialog.providerId,
              name: modelImportDialog.providerName,
              enabled: true,
              apiKey: '',
              baseUrl: '',
              models: modelImportDialog.models.filter(
                (model) => !importOnlyNotAdded || !importedModelIds.has(model.toLowerCase()),
              ),
              type: 'custom_openai',
              protocol: 'openai_chat_compatible',
            },
            importModelSearchQuery,
          )
        : { totalCount: 0, groups: [] },
    [modelImportDialog, importModelSearchQuery, importOnlyNotAdded, importedModelIds],
  );
  const activeMemoryAgent =
    agents.find((agent) => agent.id === activeMemoryAgentId) ?? agents.find((agent) => agent.id === activeAgentId) ?? null;
  const activeMemoryFile = memoryFiles.find((file) => file.path === activeMemoryFilePath) ?? null;

  useEffect(() => {
    setModelSearchQuery('');
    setCollapsedModelGroups({});
    setCollapsedModelSeries({});
  }, [activeProviderId]);

  useEffect(() => {
    if (!modelImportDialog) {
      setImportModelSearchQuery('');
      setImportOnlyNotAdded(true);
      setCollapsedImportGroups({});
      setCollapsedImportSeries({});
    }
  }, [modelImportDialog]);

  useEffect(() => {
    if (!showAddProviderDialog) {
      setAddProviderDraft({
        vendorName: '',
        protocol: 'openai_chat_compatible',
        apiKey: '',
        baseUrl: getProviderBaseUrlPlaceholder('openai_chat_compatible'),
      });
    }
  }, [showAddProviderDialog]);

  const loadMemoryFiles = async (options: { preferredPath?: string | null; announce?: string } = {}) => {
    const requestId = memoryFilesRequestIdRef.current + 1;
    memoryFilesRequestIdRef.current = requestId;

    if (!activeMemoryAgent) {
      setMemoryFiles([]);
      setActiveMemoryFilePath(null);
      setMemoryFileContent('');
      setMemoryFileDirty(false);
      return;
    }

    if (!draft.apiServer.enabled) {
      setMemoryFiles([]);
      setActiveMemoryFilePath(null);
      setMemoryFileContent('');
      setMemoryFileDirty(false);
      setApiServerSummary('');
      return;
    }

    setMemoryFileLoading(true);
    try {
      const health = await getApiServerHealth(draft.apiServer);
      if (requestId !== memoryFilesRequestIdRef.current) {
        return;
      }
      setApiServerSummary(
        health?.ok ? `已连接 ${resolveApiServerBaseUrl(draft.apiServer)} · ${health.rootDir ?? 'project root'}` : '',
      );

      const files = await listAgentMemoryFiles(activeMemoryAgent.slug, draft.apiServer);
      const memoryFile = files.find((file) => file.kind === 'memory');
      if (memoryFile && !memoryFile.exists) {
        await ensureAgentMemoryFile(
          {
            agentSlug: activeMemoryAgent.slug,
            agentName: activeMemoryAgent.name,
            kind: 'memory',
          },
          draft.apiServer,
        );
      }

      const refreshedFiles = await listAgentMemoryFiles(activeMemoryAgent.slug, draft.apiServer);
      const fallbackPath = refreshedFiles[0]?.path ?? null;
      const nextPath =
        options.preferredPath && refreshedFiles.some((file) => file.path === options.preferredPath)
          ? options.preferredPath
          : activeMemoryFilePath && refreshedFiles.some((file) => file.path === activeMemoryFilePath)
            ? activeMemoryFilePath
            : fallbackPath;

      const content = nextPath ? ((await readAgentMemoryFile(nextPath, draft.apiServer)) ?? '') : '';
      if (requestId !== memoryFilesRequestIdRef.current) {
        return;
      }

      setMemoryFiles(refreshedFiles);
      setActiveMemoryFilePath(nextPath);
      setMemoryFileContent(content);
      setMemoryFileDirty(false);
      if (options.announce) {
        setMemoryFileStatus({ tone: 'neutral', message: options.announce });
      }
    } catch (error) {
      if (requestId !== memoryFilesRequestIdRef.current) {
        return;
      }
      setApiServerSummary('');
      setMemoryFileStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : '读取记忆文件失败。',
      });
    } finally {
      if (requestId === memoryFilesRequestIdRef.current) {
        setMemoryFileLoading(false);
      }
    }
  };

  useEffect(() => {
    if (activeCategory !== 'memory') {
      return;
    }

    loadMemoryFiles().catch(console.error);
  }, [activeCategory, activeMemoryAgentId, draft.apiServer.enabled, draft.apiServer.baseUrl, draft.apiServer.authToken]);

  const loadNightlyArchive = async (options: { announce?: string } = {}) => {
    const requestId = nightlyArchiveRequestIdRef.current + 1;
    nightlyArchiveRequestIdRef.current = requestId;

    if (!draft.apiServer.enabled) {
      setNightlyArchiveStatus(null);
      setNightlyArchiveEnabled(false);
      setNightlyArchiveTime('03:00');
      setNightlyArchiveUseLlmScoring(false);
      setNightlyArchiveMessage(null);
      if (activeCategory === 'api') {
        setApiServerSummary('');
      }
      return;
    }

    setNightlyArchiveLoading(true);
    try {
      const [health, status] = await Promise.all([
        getApiServerHealth(draft.apiServer),
        getNightlyArchiveStatus(draft.apiServer),
      ]);
      if (requestId !== nightlyArchiveRequestIdRef.current) {
        return;
      }

      setApiServerSummary(
        health?.ok ? `已连接 ${resolveApiServerBaseUrl(draft.apiServer)} · ${health.rootDir ?? 'project root'}` : '',
      );
      setNightlyArchiveStatus(status);
      setNightlyArchiveEnabled(status?.settings.enabled ?? false);
      setNightlyArchiveTime(status?.settings.time ?? '03:00');
      setNightlyArchiveUseLlmScoring(status?.settings.useLlmScoring ?? false);
      if (options.announce) {
        setNightlyArchiveMessage({ tone: 'neutral', message: options.announce });
      }
    } catch (error) {
      if (requestId !== nightlyArchiveRequestIdRef.current) {
        return;
      }
      setNightlyArchiveStatus(null);
      setApiServerSummary('');
      setNightlyArchiveMessage({
        tone: 'error',
        message: error instanceof Error ? error.message : '读取夜间归档状态失败。',
      });
    } finally {
      if (requestId === nightlyArchiveRequestIdRef.current) {
        setNightlyArchiveLoading(false);
      }
    }
  };

  useEffect(() => {
    if (activeCategory !== 'api') {
      return;
    }

    loadNightlyArchive().catch(console.error);
  }, [activeCategory, draft.apiServer.enabled, draft.apiServer.baseUrl, draft.apiServer.authToken]);

  const addCustomProvider = async () => {
    const vendorName = addProviderDraft.vendorName.trim();
    if (!vendorName) {
      return;
    }

    const protocol = addProviderDraft.protocol;
    const provider: ModelProvider = {
      id: createProviderId(vendorName, protocol),
      name: buildProviderDisplayName(vendorName, protocol),
      enabled: true,
      apiKey: addProviderDraft.apiKey.trim(),
      baseUrl: addProviderDraft.baseUrl.trim(),
      models: [],
      type: protocol === 'anthropic_native' ? 'anthropic' : 'custom_openai',
      protocol,
    };

    await updateDraft((current) => ({
      ...current,
      providers: [...current.providers, provider],
    }));
    setActiveProviderId(provider.id);
    setShowAddProviderDialog(false);
  };

  const addModelToProvider = async () => {
    if (!activeProvider) {
      return;
    }

    const value = window.prompt('请输入模型 ID', activeProvider.models[0] ?? '');
    if (!value?.trim()) {
      return;
    }

    const nextModels = Array.from(new Set([...activeProvider.models, value.trim()]));
    await updateProvider(activeProvider.id, { models: nextModels });
  };

  const removeProvider = async (providerId: string) => {
    const provider = draft.providers.find((entry) => entry.id === providerId);
    if (!provider) {
      return;
    }

    if (draft.providers.length <= 1) {
      setProviderChecks((current) => ({
        ...current,
        [providerId]: '至少需要保留一个模型服务。',
      }));
      return;
    }

    const confirmed = window.confirm(`确认删除模型服务“${provider.name}”吗？`);
    if (!confirmed) {
      return;
    }

    await updateDraft((current) => {
      const nextProviders = current.providers.filter((entry) => entry.id !== providerId);
      const nextActiveProvider =
        nextProviders.find((entry) => entry.id === current.activeProviderId) ?? nextProviders[0] ?? null;

      return {
        ...current,
        providers: nextProviders,
        activeProviderId: nextActiveProvider?.id ?? '',
        activeModel: nextActiveProvider?.models.includes(current.activeModel)
          ? current.activeModel
          : nextActiveProvider?.models[0] ?? '',
      };
    });

    setProviderChecks((current) => ({
      ...current,
      [providerId]: `已删除 ${provider.name}。`,
    }));
  };

  const removeModelsFromProvider = async (providerId: string, modelsToRemove: string[]) => {
    const targetModels = new Set(modelsToRemove.map((model) => model.toLowerCase()));
    await updateDraft((current) => {
      const nextProviders = current.providers.map((provider) => {
        if (provider.id !== providerId) {
          return provider;
        }

        return {
          ...provider,
          models: provider.models.filter((model) => !targetModels.has(model.toLowerCase())),
        };
      });

      const nextProvider = nextProviders.find((provider) => provider.id === providerId) ?? null;

      return {
        ...current,
        providers: nextProviders,
        activeModel:
          current.activeProviderId === providerId && nextProvider
            ? nextProvider.models.includes(current.activeModel)
              ? current.activeModel
              : nextProvider.models[0] ?? ''
            : current.activeModel,
      };
    });
  };

  const addModelsToProvider = async (providerId: string, modelsToAdd: string[]) => {
    const additions = Array.from(new Set(modelsToAdd.map((model) => model.trim()).filter(Boolean)));
    if (additions.length === 0) {
      return;
    }

    await updateDraft((current) => {
      const nextProviders = current.providers.map((provider) => {
        if (provider.id !== providerId) {
          return provider;
        }

        const mergedModels = Array.from(new Set([...provider.models, ...additions]));
        return {
          ...provider,
          models: mergedModels,
        };
      });

      const nextProvider = nextProviders.find((provider) => provider.id === providerId) ?? null;

      return {
        ...current,
        providers: nextProviders,
        activeModel:
          current.activeProviderId === providerId && nextProvider
            ? nextProvider.models.includes(current.activeModel)
              ? current.activeModel
              : nextProvider.models[0] ?? ''
            : current.activeModel,
      };
    });
  };

  const openModelImportDialog = (provider: ModelProvider, result: ProviderModelFetchResult) => {
    setModelImportDialog({
      providerId: provider.id,
      providerName: provider.name,
      resolvedUrl: result.resolvedUrl,
      models: result.models,
    });
    setImportModelSearchQuery('');
    setCollapsedImportGroups({});
    setCollapsedImportSeries({});
  };

  const removeModelsFromImportDialog = (modelsToRemove: string[]) => {
    const targets = new Set(modelsToRemove.map((model) => model.toLowerCase()));
    setModelImportDialog((current) =>
      current
        ? {
            ...current,
            models: current.models.filter((model) => !targets.has(model.toLowerCase())),
          }
        : current,
    );
  };

  const validateProviderConfig = async (provider: ModelProvider) => {
    if (!provider.apiKey.trim()) {
      setProviderChecks((current) => ({
        ...current,
        [provider.id]: '尚未配置 API Key。',
      }));
      return;
    }

    const candidates = buildProviderModelListCandidates(provider);
    if (candidates.length === 0) {
      setProviderChecks((current) => ({
        ...current,
        [provider.id]: '请先填写 API 地址。',
      }));
      return;
    }

    const response = await fetch(candidates[0]!, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${provider.apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
    }).catch((error: Error) => {
      throw new Error(error.message);
    });

    const payload = await response.json().catch(() => ({}));
    const summary = response.ok
      ? `连接成功，当前记录 ${provider.models.length} 个模型。`
      : `${response.status} ${response.statusText} · ${
          payload?.error?.message || payload?.message || '请求失败'
        }`;

    setProviderChecks((current) => ({
      ...current,
      [provider.id]: summary,
    }));
  };

  const addMcpServer = async (template?: (typeof MCP_LIBRARY)[number]) => {
    const nextServer: McpServerConfig = {
      id: createMcpId(),
      name: template?.name ?? 'New MCP Server',
      url: template?.url ?? '',
      description: template?.description ?? '',
      enabled: false,
      transport: template?.transport ?? 'streamable-http',
      command: '',
      args: '',
      headers: '',
      source: template ? 'marketplace' : 'custom',
      provider: template?.provider ?? 'Custom',
      homepage: template?.homepage,
    };

    await updateDraft((current) => ({
      ...current,
      mcpServers: [...current.mcpServers, nextServer],
    }));
    setActiveMcpId(nextServer.id);
  };

  const addSearchProvider = async () => {
    const nextProvider: SearchProviderConfig = {
      id: createSearchProviderId(),
      name: 'Custom Search',
      type: 'custom',
      enabled: false,
      category: 'api',
      description: '',
      baseUrl: '',
      apiKey: '',
      homepage: '',
    };

    await updateDraft((current) => ({
      ...current,
      search: {
        ...current.search,
        providers: [...current.search.providers, nextProvider],
      },
    }));
    setActiveSearchProviderId(nextProvider.id);
  };

  const updateThemeColor = async (color: string) => {
    const preset = getThemePresetByColor(color);
    await updateDraft((current) => ({
      ...current,
      theme: {
        ...current.theme,
        accentColor: color,
        accentPresetId: preset?.id ?? 'custom',
      },
    }));
  };

  const notifyMemoryFilesChanged = async (agentId: string) => {
    await onMemoryFilesChanged?.(agentId);
  };

  const rescanAgentMemory = async (agentId: string, statusMessage: string) => {
    const fileStore = createAgentMemoryApiFileStore(draft.apiServer);
    const result = await syncCurrentAgentMemory({ agentId, fileStore, persist: true, strict: true });
    if (!result) {
      throw new Error('当前 agent 的记忆索引未刷新，请检查本地 API Server 连接。');
    }
    await notifyMemoryFilesChanged(agentId);
    setMemoryFileStatus({ tone: 'success', message: statusMessage });
  };

  const handleManualMemoryRescan = async () => {
    if (!activeMemoryAgent) {
      return;
    }

    try {
      await rescanAgentMemory(activeMemoryAgent.id, '已重新扫描当前 agent 的记忆文件。');
    } catch (error) {
      setMemoryFileStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : '重扫索引失败。',
      });
    }
  };

  const handleLifecycleSync = async () => {
    if (!activeMemoryAgent) {
      return;
    }

    setMemoryFileLoading(true);
    try {
      const lifecycleResult = await syncAgentMemoryLifecycleForAgent(activeMemoryAgent.slug, draft.apiServer);
      await rescanAgentMemory(
        activeMemoryAgent.id,
        `${formatLifecycleSyncStatus(lifecycleResult)} 已刷新当前 agent 索引。`,
      );
      await loadMemoryFiles({
        preferredPath: activeMemoryFilePath,
      });
      if (lifecycleResult.failures.length > 0) {
        console.warn('Memory lifecycle sync failures:', lifecycleResult.failures);
      }
    } catch (error) {
      setMemoryFileStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : '同步温冷层失败。',
      });
    } finally {
      setMemoryFileLoading(false);
    }
  };

  const saveMemoryFile = async () => {
    if (!activeMemoryAgent || !activeMemoryFilePath) {
      return;
    }

    setMemoryFileLoading(true);
    try {
      await writeAgentMemoryFile(activeMemoryFilePath, memoryFileContent, draft.apiServer);
      await rescanAgentMemory(activeMemoryAgent.id, '已写入 Markdown 文件并刷新当前 agent 索引。');
      await loadMemoryFiles({ preferredPath: activeMemoryFilePath });
    } catch (error) {
      setMemoryFileStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : '保存记忆文件失败。',
      });
    } finally {
      setMemoryFileLoading(false);
    }
  };

  const createTodayDailyFile = async () => {
    if (!activeMemoryAgent) {
      return;
    }

    setMemoryFileLoading(true);
    try {
      const ensured = await ensureAgentMemoryFile(
        {
          agentSlug: activeMemoryAgent.slug,
          agentName: activeMemoryAgent.name,
          kind: 'daily',
        },
        draft.apiServer,
      );
      await rescanAgentMemory(activeMemoryAgent.id, '已创建今日日志并刷新索引。');
      await loadMemoryFiles({
        preferredPath: ensured.path,
      });
    } catch (error) {
      setMemoryFileStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : '创建今日日志失败。',
      });
    } finally {
      setMemoryFileLoading(false);
    }
  };

  const removeActiveDailyFile = async () => {
    if (!activeMemoryAgent || !activeMemoryFile || activeMemoryFile.kind === 'memory') {
      return;
    }

    if (!window.confirm(`确定删除 ${activeMemoryFile.label} 吗？`)) {
      return;
    }

    setMemoryFileLoading(true);
    try {
      await deleteAgentMemoryFile(activeMemoryFile.path, draft.apiServer);
      await rescanAgentMemory(activeMemoryAgent.id, '已删除日记文件并刷新索引。');
      await loadMemoryFiles({
        preferredPath: memoryFiles.find((file) => file.path !== activeMemoryFile.path)?.path ?? null,
      });
    } catch (error) {
      setMemoryFileStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : '删除日记文件失败。',
      });
    } finally {
      setMemoryFileLoading(false);
    }
  };

  const handleNightlyArchiveSave = async () => {
    if (!draft.apiServer.enabled) {
      setNightlyArchiveMessage({
        tone: 'error',
        message: '请先启用本地 API Server。',
      });
      return;
    }

    setNightlyArchiveLoading(true);
    try {
      const nextStatus = await saveNightlyArchiveSettings(draft.apiServer, {
        enabled: nightlyArchiveEnabled,
        time: nightlyArchiveTime,
        useLlmScoring: nightlyArchiveUseLlmScoring,
      });
      setNightlyArchiveStatus(nextStatus);
      setNightlyArchiveEnabled(nextStatus?.settings.enabled ?? nightlyArchiveEnabled);
      setNightlyArchiveTime(nextStatus?.settings.time ?? nightlyArchiveTime);
      setNightlyArchiveUseLlmScoring(nextStatus?.settings.useLlmScoring ?? nightlyArchiveUseLlmScoring);
      setNightlyArchiveMessage({
        tone: 'success',
        message: '已保存夜间自动归档设置。',
      });
      await loadNightlyArchive();
    } catch (error) {
      setNightlyArchiveMessage({
        tone: 'error',
        message: error instanceof Error ? error.message : '保存夜间归档设置失败。',
      });
    } finally {
      setNightlyArchiveLoading(false);
    }
  };

  const restoreBackupFromFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const payload = JSON.parse(await readFileAsText(file));
      if (!payload?.config || !payload?.workspace) {
        throw new Error('备份文件缺少 config 或 workspace 字段。');
      }

      await importWorkspaceData(payload.workspace);
      await saveAgentConfig(normalizeAgentConfig(payload.config));
      onConfigSaved?.(normalizeAgentConfig(payload.config));
      window.location.reload();
    } catch (error: any) {
      window.alert(`恢复失败: ${error.message}`);
    } finally {
      event.target.value = '';
    }
  };

  const importExternalData = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) {
      return;
    }

    await Promise.all(
      files.map(async (file) => {
        const content = await readFileAsText(file);
        await addDocument(`document_${crypto.randomUUID?.() ?? Date.now().toString(36)}`, file.name, content);
      }),
    );

    await loadStats().catch(console.error);
    event.target.value = '';
  };

  const handleBackup = async () => {
    const payload = {
      kind: 'flowagent-backup',
      exportedAt: new Date().toISOString(),
      config: draft,
      workspace: await exportWorkspaceData({ minimal: draft.data.minimalBackup }),
    };
    downloadJson(payload, `flowagent-backup-${Date.now()}.json`);
  };

  const handleMarkdownExport = async () => {
    const payload = await exportWorkspaceData();
    downloadText(buildMarkdownExport(payload), `flowagent-export-${Date.now()}.md`);
  };

  const renderSettingsContent = () => {
    switch (activeCategory) {
      case 'default':
        return (
          <div className="space-y-6">
            <SectionCard
              title="默认模型路由"
              description="这里控制整个工作区默认使用的 provider 与 model。"
            >
              <div className="grid gap-3 md:grid-cols-2">
                <select
                  value={draft.activeProviderId}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      activeProviderId: event.target.value,
                      activeModel:
                        current.providers.find((provider) => provider.id === event.target.value)?.models[0] ??
                        '',
                    }))
                  }
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                >
                  {draft.providers
                    .filter((provider) => provider.enabled)
                    .map((provider) => (
                      <option key={provider.id} value={provider.id} className="bg-[#111111]">
                        {provider.name}
                      </option>
                    ))}
                </select>
                <select
                  value={draft.activeModel}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      activeModel: event.target.value,
                    }))
                  }
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                >
                  {(draft.providers.find((provider) => provider.id === draft.activeProviderId)?.models ?? []).map(
                    (model) => (
                      <option key={model} value={model} className="bg-[#111111]">
                        {model}
                      </option>
                    ),
                  )}
                </select>
              </div>
            </SectionCard>

            <SectionCard title="全局 System Prompt" description="对所有 lane 生效的系统级提示词。">
              <textarea
                value={draft.systemPrompt}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    systemPrompt: event.target.value,
                  }))
                }
                className="min-h-[220px] w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-emerald-500/50"
              />
            </SectionCard>
          </div>
        );

      case 'general':
        return (
          <div className="space-y-4">
            <SectionCard title="语言与网络" description="用于控制工作区的基础行为与请求路径。">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-white/90">
                    <Languages size={15} className="text-white/50" />
                    语言
                  </div>
                  <select
                    value={draft.general.language}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        general: {
                          ...current.general,
                          language: event.target.value,
                        },
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                  >
                    {LANGUAGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value} className="bg-[#111111]">
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-2 text-sm font-medium text-white/90">代理模式</div>
                  <select
                    value={draft.general.proxyMode}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        general: {
                          ...current.general,
                          proxyMode: event.target.value as AgentConfig['general']['proxyMode'],
                        },
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                  >
                    {PROXY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value} className="bg-[#111111]">
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs text-white/45">
                    {PROXY_OPTIONS.find((option) => option.value === draft.general.proxyMode)?.description}
                  </p>
                </div>
              </div>

              {draft.general.proxyMode === 'custom' ? (
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-2 text-sm font-medium text-white/90">代理地址</div>
                  <input
                    value={draft.general.proxyUrl}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        general: {
                          ...current.general,
                          proxyUrl: event.target.value,
                        },
                      }))
                    }
                    placeholder="https://proxy.example.com"
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                  />
                </div>
              ) : null}
            </SectionCard>

            <div className="grid gap-4 md:grid-cols-2">
              <ToggleCard
                title="Knowledge Base 优先"
                description="允许 agent 优先尝试本地 SQLite 文档检索。"
                checked={draft.search.enableKnowledgeBase}
                onChange={(checked) =>
                  updateDraft((current) => ({
                    ...current,
                    search: {
                      ...current.search,
                      enableKnowledgeBase: checked,
                    },
                  }))
                }
              />
              <ToggleCard
                title="保留助手上下文"
                description="每个 lane 在连续对话中记住自己的历史消息。"
                checked={draft.memory.keepAssistantContext}
                onChange={(checked) =>
                  updateDraft((current) => ({
                    ...current,
                    memory: {
                      ...current.memory,
                      keepAssistantContext: checked,
                    },
                  }))
                }
              />
              <ToggleCard
                title="自动启动 Sandbox"
                description="打开沙箱页时更快，但会增加一点浏览器负担。"
                checked={draft.sandbox.autoBoot}
                onChange={(checked) =>
                  updateDraft((current) => ({
                    ...current,
                    sandbox: {
                      ...current.sandbox,
                      autoBoot: checked,
                    },
                  }))
                }
              />
              <ToggleCard
                title="自动生成会话标题"
                description="基于第一条用户消息生成更容易区分的会话标题。"
                checked={draft.memory.autoTitleFromFirstMessage}
                onChange={(checked) =>
                  updateDraft((current) => ({
                    ...current,
                    memory: {
                      ...current.memory,
                      autoTitleFromFirstMessage: checked,
                    },
                  }))
                }
              />
            </div>
          </div>
        );

      case 'display':
        return (
          <div className="space-y-4">
            <SectionCard
              title="主题模式"
              description="支持浅色 / 深色主题，并允许你定制整套工作区的主题色。"
              action={
                <button
                  onClick={() => setShowThemeBoard((current) => !current)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75 hover:bg-white/10 hover:text-white"
                >
                  <Palette size={14} />
                  {showThemeBoard ? '收起色盘' : '打开色盘'}
                </button>
              }
            >
              <div className="grid gap-4 md:grid-cols-[220px_1fr]">
                <div className="grid gap-3">
                  {[
                    { value: 'dark', label: '深色主题' },
                    { value: 'light', label: '浅色主题' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      onClick={() =>
                        updateDraft((current) => ({
                          ...current,
                          theme: {
                            ...current.theme,
                            mode: option.value as AgentConfig['theme']['mode'],
                          },
                        }))
                      }
                      className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                        draft.theme.mode === option.value
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-white'
                          : 'border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.05]'
                      }`}
                    >
                      <div className="text-sm font-medium">{option.label}</div>
                    </button>
                  ))}
                </div>

                <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div>
                    <div className="text-sm font-medium text-white/90">基础主题色</div>
                    <p className="mt-1 text-xs text-white/45">
                      常用的 10 个基础色已经预置，切换后会立即影响品牌渐变与强调色。
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {THEME_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => updateThemeColor(preset.color)}
                        className={`rounded-2xl border p-3 text-left transition-transform hover:-translate-y-0.5 ${
                          draft.theme.accentColor.toLowerCase() === preset.color.toLowerCase()
                            ? 'border-white/30 bg-white/10'
                            : 'border-white/10 bg-black/20'
                        }`}
                      >
                        <div
                          className="h-10 rounded-xl"
                          style={{
                            background: `linear-gradient(135deg, ${preset.color}, color-mix(in srgb, ${preset.color} 70%, #8b5cf6 30%))`,
                          }}
                        />
                        <div className="mt-3 text-sm font-medium text-white/90">{preset.name}</div>
                      </button>
                    ))}
                  </div>

                  {showThemeBoard ? (
                    <div className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-sm font-medium text-white/90">扩展色盘</div>
                      <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">
                        {THEME_COLOR_BOARD.map((color) => (
                          <button
                            key={color}
                            onClick={() => updateThemeColor(color)}
                            className={`h-10 rounded-xl border transition-transform hover:scale-[1.04] ${
                              draft.theme.accentColor.toLowerCase() === color.toLowerCase()
                                ? 'border-white/80'
                                : 'border-white/15'
                            }`}
                            style={{ backgroundColor: color }}
                            title={color}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={draft.theme.accentColor}
                          onChange={(event) => updateThemeColor(event.target.value)}
                          className="h-11 w-20 rounded-xl border border-white/10 bg-black/20 p-1"
                        />
                        <div className="text-xs text-white/45">
                          当前主题色: <span className="font-mono text-white/70">{draft.theme.accentColor}</span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </SectionCard>

            <div className="grid gap-4 md:grid-cols-2">
              <ToggleCard
                title="自动滚动到最新消息"
                description="lane 在新回复到来时自动贴底。"
                checked={draft.ui.autoScroll}
                onChange={(checked) =>
                  updateDraft((current) => ({
                    ...current,
                    ui: {
                      ...current.ui,
                      autoScroll: checked,
                    },
                  }))
                }
              />
              <ToggleCard
                title="显示时间戳"
                description="在每条消息顶部展示时间。"
                checked={draft.ui.showTimestamps}
                onChange={(checked) =>
                  updateDraft((current) => ({
                    ...current,
                    ui: {
                      ...current.ui,
                      showTimestamps: checked,
                    },
                  }))
                }
              />
              <ToggleCard
                title="展示工具结果"
                description="在消息卡片内展示 tool 调用结果摘要。"
                checked={draft.ui.showToolResults}
                onChange={(checked) =>
                  updateDraft((current) => ({
                    ...current,
                    ui: {
                      ...current.ui,
                      showToolResults: checked,
                    },
                  }))
                }
              />
              <ToggleCard
                title="紧凑 lane 视图"
                description="减小卡片内边距，适合一次打开更多 agent。"
                checked={draft.ui.compactLanes}
                onChange={(checked) =>
                  updateDraft((current) => ({
                    ...current,
                    ui: {
                      ...current.ui,
                      compactLanes: checked,
                    },
                  }))
                }
              />
            </div>

            <SectionCard title="多列显示密度" description="调整多 lane 工作区的最小列宽。">
              <input
                type="range"
                min={300}
                max={460}
                step={10}
                value={draft.ui.laneMinWidth}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    ui: {
                      ...current.ui,
                      laneMinWidth: Number(event.target.value),
                    },
                  }))
                }
                className="w-full"
              />
              <div className="mt-2 text-xs text-white/45">{draft.ui.laneMinWidth}px</div>
            </SectionCard>
          </div>
        );

      case 'data':
        return (
          <div className="space-y-4">
            <SectionCard
              title="数据备份与恢复"
              description="备份会话、agent lane、知识库、全局记忆和设置。"
              action={
                <div className="flex gap-2">
                  <button
                    onClick={handleBackup}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
                  >
                    <HardDriveDownload size={15} />
                    备份
                  </button>
                  <button
                    onClick={() => backupRestoreInputRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
                  >
                    <HardDriveUpload size={15} />
                    恢复
                  </button>
                </div>
              }
            >
              <div className="grid gap-4 md:grid-cols-2">
                <ToggleCard
                  title="精简备份"
                  description="跳过知识库文档，仅备份聊天记录、助手与设置。"
                  checked={draft.data.minimalBackup}
                  onChange={(checked) =>
                    updateDraft((current) => ({
                      ...current,
                      data: {
                        ...current.data,
                        minimalBackup: checked,
                      },
                    }))
                  }
                />
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="text-sm font-medium text-white/90">数据概览</div>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                    {stats
                      ? [
                          ['会话', stats.conversations],
                          ['文档', stats.documents],
                          ['记忆', stats.memoryDocuments],
                          ['消息', stats.messages],
                          ['助手', stats.assistants],
                          ['短语', stats.snippets],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-xl border border-white/10 bg-black/20 p-3">
                            <div className="text-[11px] text-white/40">{label}</div>
                            <div className="mt-2 text-lg font-semibold text-white">{value}</div>
                          </div>
                        ))
                      : null}
                  </div>
                </div>
              </div>
            </SectionCard>

            <div className="grid gap-4 lg:grid-cols-2">
              <SectionCard title="导入设置" description="把外部文本、Markdown 或 JSON 导入到本地知识库。">
                <button
                  onClick={() => externalImportInputRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-white/75 transition-colors hover:bg-white/[0.05] hover:text-white"
                >
                  <FolderUp size={18} />
                  导入外部应用数据
                </button>
              </SectionCard>

              <SectionCard title="导出设置" description="支持 JSON 备份和 Markdown 导出。">
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    onClick={handleBackup}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-white hover:bg-white/10"
                  >
                    <Upload size={16} />
                    导出菜单设置
                  </button>
                  <button
                    onClick={handleMarkdownExport}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-white hover:bg-white/10"
                  >
                    <Download size={16} />
                    Markdown 导出
                  </button>
                </div>
              </SectionCard>
            </div>

            <SectionCard title="存储说明" description="当前版本使用浏览器端 localForage + sql.js 持久化。">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-sm font-medium text-white/90">应用数据</div>
                  <p className="mt-2 text-xs text-white/45">
                    会话、lane、知识库、全局记忆都保存在本地浏览器存储中。
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-sm font-medium text-white/90">恢复提示</div>
                  <p className="mt-2 text-xs text-white/45">
                    恢复备份后页面会自动刷新，确保 SQLite 与配置重新载入。
                  </p>
                </div>
              </div>
            </SectionCard>
          </div>
        );

      case 'mcp':
        return (
          <div className="grid min-h-[560px] gap-px overflow-hidden rounded-[28px] border border-white/10 bg-white/5 lg:grid-cols-[300px_1fr]">
            <div className="min-h-0 overflow-y-auto bg-[#1E1E1E] p-4 custom-scrollbar">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-white/90">MCP 服务器</div>
                  <p className="mt-1 text-xs text-white/45">内置模板 + 自定义服务器。</p>
                </div>
                <button
                  onClick={() => addMcpServer()}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75 hover:bg-white/10 hover:text-white"
                >
                  <Plus size={14} />
                  添加
                </button>
              </div>

              <div className="space-y-2">
                <div className="px-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">
                  内置与推荐
                </div>
                {MCP_LIBRARY.map((server) => (
                  <button
                    key={server.id}
                    onClick={() => setActiveMcpId(server.id)}
                    className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
                      activeMcpId === server.id
                        ? 'border-white/15 bg-white/10 text-white'
                        : 'border-transparent bg-transparent text-white/70 hover:bg-white/5'
                    }`}
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white/5">
                      <Server size={16} className="text-white/75" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">{server.name}</div>
                      <div className="mt-1 text-xs text-white/45">{server.provider}</div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-6 space-y-2">
                <div className="px-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">
                  我的服务器
                </div>
                {draft.mcpServers.map((server) => (
                  <button
                    key={server.id}
                    onClick={() => setActiveMcpId(server.id)}
                    className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors ${
                      activeMcpId === server.id
                        ? 'border-white/15 bg-white/10 text-white'
                        : 'border-transparent bg-transparent text-white/70 hover:bg-white/5'
                    }`}
                  >
                    <div>
                      <div className="text-sm font-medium">{server.name}</div>
                      <div className="mt-1 text-xs text-white/45">{server.transport}</div>
                    </div>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] ${
                        server.enabled
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                          : 'border-white/10 text-white/40'
                      }`}
                    >
                      {server.enabled ? 'ON' : 'OFF'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 overflow-y-auto bg-[#1E1E1E] p-6 custom-scrollbar">
              {activeMcpServer ? (
                <div className="space-y-4">
                  <SectionCard
                    title={activeMcpServer.name}
                    description="自定义 MCP 服务器配置会持久化到本地设置中。"
                    action={
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-2 text-xs text-white/55">
                          <input
                            type="checkbox"
                            checked={activeMcpServer.enabled}
                            onChange={(event) =>
                              updateMcpServer(activeMcpServer.id, { enabled: event.target.checked })
                            }
                          />
                          启用
                        </label>
                        {activeMcpServer.source === 'custom' ? (
                          <button
                            onClick={async () => {
                              await updateDraft((current) => ({
                                ...current,
                                mcpServers: current.mcpServers.filter((server) => server.id !== activeMcpServer.id),
                              }));
                              setActiveMcpId(draft.mcpServers[0]?.id ?? MCP_LIBRARY[0]!.id);
                            }}
                            className="rounded-full border border-red-500/20 bg-red-500/10 p-2 text-red-300 hover:bg-red-500/15"
                          >
                            <Trash2 size={14} />
                          </button>
                        ) : null}
                      </div>
                    }
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <input
                        value={activeMcpServer.name}
                        onChange={(event) => updateMcpServer(activeMcpServer.id, { name: event.target.value })}
                        className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                        placeholder="服务器名称"
                      />
                      <select
                        value={activeMcpServer.transport}
                        onChange={(event) =>
                          updateMcpServer(activeMcpServer.id, {
                            transport: event.target.value as McpServerConfig['transport'],
                          })
                        }
                        className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                      >
                        <option value="streamable-http" className="bg-[#111111]">
                          streamable-http
                        </option>
                        <option value="sse" className="bg-[#111111]">
                          sse
                        </option>
                        <option value="stdio" className="bg-[#111111]">
                          stdio
                        </option>
                      </select>
                    </div>

                    {activeMcpServer.transport === 'stdio' ? (
                      <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
                        <input
                          value={activeMcpServer.command}
                          onChange={(event) =>
                            updateMcpServer(activeMcpServer.id, { command: event.target.value })
                          }
                          placeholder="npx"
                          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                        />
                        <input
                          value={activeMcpServer.args}
                          onChange={(event) =>
                            updateMcpServer(activeMcpServer.id, { args: event.target.value })
                          }
                          placeholder="-y @modelcontextprotocol/server-filesystem ./"
                          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                        />
                      </div>
                    ) : (
                      <input
                        value={activeMcpServer.url}
                        onChange={(event) => updateMcpServer(activeMcpServer.id, { url: event.target.value })}
                        placeholder="https://mcp.example.com"
                        className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                      />
                    )}

                    <textarea
                      value={activeMcpServer.description}
                      onChange={(event) =>
                        updateMcpServer(activeMcpServer.id, { description: event.target.value })
                      }
                      placeholder="描述这个 MCP 服务器的用途。"
                      className="min-h-[100px] w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-emerald-500/50"
                    />

                    <textarea
                      value={activeMcpServer.headers}
                      onChange={(event) =>
                        updateMcpServer(activeMcpServer.id, { headers: event.target.value })
                      }
                      placeholder={'可选请求头，支持 JSON 或 "Authorization: Bearer xxx" 这样的多行文本。'}
                      className="min-h-[96px] w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-emerald-500/50"
                    />
                  </SectionCard>
                </div>
              ) : activeMcpTemplate ? (
                <SectionCard
                  title={activeMcpTemplate.name}
                  description={activeMcpTemplate.description}
                  action={
                    <button
                      onClick={() => addMcpServer(activeMcpTemplate)}
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75 hover:bg-white/10 hover:text-white"
                    >
                      <Plus size={14} />
                      添加到我的服务器
                    </button>
                  }
                >
                  <div className="space-y-3 text-sm text-white/75">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-xs uppercase tracking-[0.2em] text-white/35">Transport</div>
                      <div className="mt-2">{activeMcpTemplate.transport}</div>
                    </div>
                    {activeMcpTemplate.url ? (
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="text-xs uppercase tracking-[0.2em] text-white/35">Endpoint</div>
                        <div className="mt-2 break-all">{activeMcpTemplate.url}</div>
                      </div>
                    ) : null}
                    {activeMcpTemplate.homepage ? (
                      <a
                        href={activeMcpTemplate.homepage}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
                      >
                        <Link2 size={14} />
                        打开主页
                      </a>
                    ) : null}
                  </div>
                </SectionCard>
              ) : (
                <div className="flex h-full items-center justify-center text-white/40">未配置服务器</div>
              )}
            </div>
          </div>
        );

      case 'search':
        return (
          <div className="grid min-h-[560px] gap-px overflow-hidden rounded-[28px] border border-white/10 bg-white/5 lg:grid-cols-[320px_1fr]">
            <div className="min-h-0 overflow-y-auto bg-[#1E1E1E] p-4 custom-scrollbar">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-white/90">网络搜索</div>
                  <p className="mt-1 text-xs text-white/45">配置默认 provider 与联网检索偏好。</p>
                </div>
                <button
                  onClick={addSearchProvider}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75 hover:bg-white/10 hover:text-white"
                >
                  <Plus size={14} />
                  添加
                </button>
              </div>

              <div className="space-y-2">
                <div className="px-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">
                  API 服务商
                </div>
                {draft.search.providers
                  .filter((provider) => provider.category === 'api')
                  .map((provider) => (
                    <button
                      key={provider.id}
                      onClick={() => setActiveSearchProviderId(provider.id)}
                      className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors ${
                        activeSearchProviderId === provider.id
                          ? 'border-white/15 bg-white/10 text-white'
                          : 'border-transparent bg-transparent text-white/70 hover:bg-white/5'
                      }`}
                    >
                      <div>
                        <div className="text-sm font-medium">{provider.name}</div>
                        <div className="mt-1 text-xs text-white/45">{provider.description}</div>
                      </div>
                      {draft.search.defaultProviderId === provider.id ? (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">
                          默认
                        </span>
                      ) : null}
                    </button>
                  ))}
              </div>

              <div className="mt-6 space-y-2">
                <div className="px-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">
                  本地搜索
                </div>
                {draft.search.providers
                  .filter((provider) => provider.category === 'local')
                  .map((provider) => (
                    <button
                      key={provider.id}
                      onClick={() => setActiveSearchProviderId(provider.id)}
                      className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors ${
                        activeSearchProviderId === provider.id
                          ? 'border-white/15 bg-white/10 text-white'
                          : 'border-transparent bg-transparent text-white/70 hover:bg-white/5'
                      }`}
                    >
                      <div>
                        <div className="text-sm font-medium">{provider.name}</div>
                        <div className="mt-1 text-xs text-white/45">{provider.description}</div>
                      </div>
                      {draft.search.defaultProviderId === provider.id ? (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">
                          默认
                        </span>
                      ) : null}
                    </button>
                  ))}
              </div>
            </div>

            <div className="min-h-0 overflow-y-auto bg-[#1E1E1E] p-6 custom-scrollbar">
              {activeSearchProvider ? (
                <div className="space-y-4">
                  <SectionCard
                    title={activeSearchProvider.name}
                    description={activeSearchProvider.description}
                    action={
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            updateDraft((current) => ({
                              ...current,
                              search: {
                                ...current.search,
                                defaultProviderId: activeSearchProvider.id,
                              },
                            }))
                          }
                          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
                        >
                          设为默认
                        </button>
                        {activeSearchProvider.homepage ? (
                          <a
                            href={activeSearchProvider.homepage}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
                          >
                            <ArrowUpFromLine size={14} />
                            打开设置
                          </a>
                        ) : null}
                      </div>
                    }
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <ToggleCard
                        title="启用联网搜索"
                        description="允许 agent 走外部搜索 provider。"
                        checked={draft.search.enableWebSearch}
                        onChange={(checked) =>
                          updateDraft((current) => ({
                            ...current,
                            search: {
                              ...current.search,
                              enableWebSearch: checked,
                            },
                          }))
                        }
                      />
                      <ToggleCard
                        title="启用当前 Provider"
                        description="仅启用后才会出现在默认 provider 候选中。"
                        checked={activeSearchProvider.enabled}
                        onChange={(checked) =>
                          updateSearchProvider(activeSearchProvider.id, { enabled: checked })
                        }
                      />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <select
                        value={activeSearchProvider.category}
                        onChange={(event) =>
                          updateSearchProvider(activeSearchProvider.id, {
                            category: event.target.value as SearchProviderConfig['category'],
                          })
                        }
                        className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                      >
                        {SEARCH_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value} className="bg-[#111111]">
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <input
                        value={activeSearchProvider.name}
                        onChange={(event) =>
                          updateSearchProvider(activeSearchProvider.id, { name: event.target.value })
                        }
                        placeholder="Provider Name"
                        className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                      />
                    </div>

                    <input
                      value={activeSearchProvider.baseUrl || ''}
                      onChange={(event) =>
                        updateSearchProvider(activeSearchProvider.id, { baseUrl: event.target.value })
                      }
                      placeholder="https://api.example.com"
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                    />

                    {activeSearchProvider.category === 'api' ? (
                      <input
                        value={activeSearchProvider.apiKey}
                        onChange={(event) =>
                          updateSearchProvider(activeSearchProvider.id, { apiKey: event.target.value })
                        }
                        placeholder="API Key"
                        className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                      />
                    ) : null}

                    <textarea
                      value={activeSearchProvider.description}
                      onChange={(event) =>
                        updateSearchProvider(activeSearchProvider.id, { description: event.target.value })
                      }
                      placeholder="这个 provider 的用途和说明。"
                      className="min-h-[96px] w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-emerald-500/50"
                    />
                  </SectionCard>

                  <div className="grid gap-4 md:grid-cols-2">
                    <ToggleCard
                      title="启用本地知识库检索"
                      description="由 search_knowledge_base 工具提供。"
                      checked={draft.search.enableKnowledgeBase}
                      onChange={(checked) =>
                        updateDraft((current) => ({
                          ...current,
                          search: {
                            ...current.search,
                            enableKnowledgeBase: checked,
                          },
                        }))
                      }
                    />
                    <ToggleCard
                      title="联网失败时回退到知识库"
                      description="外部 provider 不可用时，仍可让 agent 走本地文档检索。"
                      checked={draft.search.fallbackToKnowledgeBase}
                      onChange={(checked) =>
                        updateDraft((current) => ({
                          ...current,
                          search: {
                            ...current.search,
                            fallbackToKnowledgeBase: checked,
                          },
                        }))
                      }
                    />
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-white/40">请选择一个搜索服务</div>
              )}
            </div>
          </div>
        );

      case 'memory':
        return (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <ToggleCard
                title="启用全局记忆"
                description="把全局记忆文档注入到所有 lane 的系统上下文。"
                checked={draft.memory.includeGlobalMemory}
                onChange={(checked) =>
                  updateDraft((current) => ({
                    ...current,
                    memory: {
                      ...current.memory,
                      includeGlobalMemory: checked,
                    },
                  }))
                }
              />
              <ToggleCard
                title="注入近期记忆快照"
                description="把最近对话摘要、关键片段和未完成任务一起注入运行时上下文。"
                checked={draft.memory.includeRecentMemorySnapshot}
                onChange={(checked) =>
                  updateDraft((current) => ({
                    ...current,
                    memory: {
                      ...current.memory,
                      includeRecentMemorySnapshot: checked,
                    },
                  }))
                }
              />
              <ToggleCard
                title="自动生成标题"
                description="基于首条用户输入生成标题。"
                checked={draft.memory.autoTitleFromFirstMessage}
                onChange={(checked) =>
                  updateDraft((current) => ({
                    ...current,
                    memory: {
                      ...current.memory,
                      autoTitleFromFirstMessage: checked,
                    },
                  }))
                }
              />
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-2 text-sm font-medium text-white/90">上下文窗口</div>
                <input
                  type="number"
                  min={4}
                  max={40}
                  value={draft.memory.historyWindow}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      memory: {
                        ...current.memory,
                        historyWindow: Number(event.target.value),
                      },
                    }))
                  }
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                />
                <p className="mt-2 text-xs text-white/45">每个 lane 最近保留的消息条数。</p>
              </div>
            </div>

            <SectionCard
              title="记忆晋升评分"
              description="调整夜间归档把 warm/cold 记忆提升为长期记忆时的加权标准。保持原主题，不改运行模型，只改评分汇总。"
            >
              <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
                <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-white/35">Threshold</div>
                  <div className="mt-3 text-3xl font-semibold text-white">{draft.memory.promotionScoreThreshold.toFixed(1)}</div>
                  <p className="mt-2 text-xs leading-6 text-white/45">
                    加权后的 `promotionScore` 达到这个阈值，就会优先进入 `MEMORY.md` 的自动 learned patterns 区块。
                  </p>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    step={0.1}
                    value={draft.memory.promotionScoreThreshold}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        memory: {
                          ...current.memory,
                          promotionScoreThreshold: Number(event.target.value),
                        },
                      }))
                    }
                    className="mt-4 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <WeightInputCard
                    label="压缩率"
                    value={draft.memory.scoringWeights.compression}
                    description="去掉赘述和重复尝试，只保留核心知识。"
                    onChange={(value) =>
                      updateDraft((current) => ({
                        ...current,
                        memory: {
                          ...current.memory,
                          scoringWeights: {
                            ...current.memory.scoringWeights,
                            compression: value,
                          },
                        },
                      }))
                    }
                  />
                  <WeightInputCard
                    label="时效性"
                    value={draft.memory.scoringWeights.timeliness}
                    description="识别版本、日期和临时状态，避免过期知识干扰。"
                    onChange={(value) =>
                      updateDraft((current) => ({
                        ...current,
                        memory: {
                          ...current.memory,
                          scoringWeights: {
                            ...current.memory.scoringWeights,
                            timeliness: value,
                          },
                        },
                      }))
                    }
                  />
                  <WeightInputCard
                    label="关联度"
                    value={draft.memory.scoringWeights.connectivity}
                    description="越能连接已有知识点，越适合长期检索。"
                    onChange={(value) =>
                      updateDraft((current) => ({
                        ...current,
                        memory: {
                          ...current.memory,
                          scoringWeights: {
                            ...current.memory.scoringWeights,
                            connectivity: value,
                          },
                        },
                      }))
                    }
                  />
                  <WeightInputCard
                    label="冲突解决"
                    value={draft.memory.scoringWeights.conflictResolution}
                    description="优先保留最新共识，压低冲突未解的旧记忆。"
                    onChange={(value) =>
                      updateDraft((current) => ({
                        ...current,
                        memory: {
                          ...current.memory,
                          scoringWeights: {
                            ...current.memory.scoringWeights,
                            conflictResolution: value,
                          },
                        },
                      }))
                    }
                  />
                  <WeightInputCard
                    label="抽象程度"
                    value={draft.memory.scoringWeights.abstraction}
                    description="越接近模式和原则，越值得长期保留。"
                    onChange={(value) =>
                      updateDraft((current) => ({
                        ...current,
                        memory: {
                          ...current.memory,
                          scoringWeights: {
                            ...current.memory.scoringWeights,
                            abstraction: value,
                          },
                        },
                      }))
                    }
                  />
                  <WeightInputCard
                    label="黄金标签"
                    value={draft.memory.scoringWeights.goldenLabel}
                    description="用户明确认可、验证通过的经验可提高权重。"
                    onChange={(value) =>
                      updateDraft((current) => ({
                        ...current,
                        memory: {
                          ...current.memory,
                          scoringWeights: {
                            ...current.memory.scoringWeights,
                            goldenLabel: value,
                          },
                        },
                      }))
                    }
                  />
                  <WeightInputCard
                    label="可迁移性"
                    value={draft.memory.scoringWeights.transferability}
                    description="可跨任务复用的 workflow 和 tool gotchas 更值钱。"
                    onChange={(value) =>
                      updateDraft((current) => ({
                        ...current,
                        memory: {
                          ...current.memory,
                          scoringWeights: {
                            ...current.memory.scoringWeights,
                            transferability: value,
                          },
                        },
                      }))
                    }
                  />
                </div>
              </div>
            </SectionCard>

            <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <SectionCard
                title="文件记忆源"
                description="Markdown 文件是真源，SQLite 只保留当前 agent 的索引与缓存。"
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.24em] text-white/35">Current Agent</div>
                    <select
                      value={activeMemoryAgentId}
                      onChange={(event) => {
                        setActiveMemoryAgentId(event.target.value);
                        setMemoryFileStatus(null);
                      }}
                      className="mt-3 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                    >
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                    <div className="mt-3 text-xs text-white/45">
                      默认只扫描当前 agent 目录：{activeMemoryAgent?.workspaceRelpath ?? 'agents/...'}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.24em] text-white/35">API Server</div>
                    <div className="mt-3 text-sm text-white/90">{resolveApiServerBaseUrl(draft.apiServer)}</div>
                    <div className="mt-2 text-xs text-white/45">
                      {draft.apiServer.enabled
                        ? apiServerSummary || '启用后会通过本地 API 直接读写项目里的记忆文件。'
                        : '当前未启用。到“API 服务器”分类开启本地服务后，这里才会写入项目文件。'}
                    </div>
                    <div className="mt-4 flex gap-2">
                      <button
                        onClick={() => setActiveCategory('api')}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/85 hover:bg-white/10"
                      >
                        打开 API 设置
                      </button>
                      <button
                        onClick={() => loadMemoryFiles({ announce: '已重新读取当前 agent 的记忆文件。' })}
                        disabled={!draft.apiServer.enabled || memoryFileLoading}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/85 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        重新读取
                      </button>
                    </div>
                  </div>
                </div>
              </SectionCard>
            </div>

            <div className="grid min-h-[560px] gap-px overflow-hidden rounded-[28px] border border-white/10 bg-white/5 lg:grid-cols-[228px_minmax(0,1fr)]">
              <div className="min-h-0 overflow-y-auto bg-[#1E1E1E] p-4 custom-scrollbar">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-white/90">记忆文件</div>
                    <p className="mt-1 text-xs text-white/45">直接编辑当前 agent 的 MEMORY.md 与 daily 日志。</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        loadMemoryFiles({ announce: '已重新读取当前 agent 的记忆文件。' }).catch(console.error);
                      }}
                      disabled={!draft.apiServer.enabled || memoryFileLoading}
                      className="rounded-full border border-white/10 bg-white/5 p-2 text-white/75 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw size={14} />
                    </button>
                    <button
                      onClick={() => {
                        createTodayDailyFile().catch(console.error);
                      }}
                      disabled={!draft.apiServer.enabled || memoryFileLoading || !activeMemoryAgent}
                      className="rounded-full border border-white/10 bg-white/5 p-2 text-white/75 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  {memoryFiles.map((file) => (
                    <button
                      key={file.path}
                      onClick={async () => {
                        if (!draft.apiServer.enabled) {
                          return;
                        }

                        try {
                          const content =
                            (await readAgentMemoryFile(file.path, draft.apiServer)) ??
                            (file.kind === 'memory' && activeMemoryAgent
                              ? (
                                  await ensureAgentMemoryFile(
                                    {
                                      agentSlug: activeMemoryAgent.slug,
                                      agentName: activeMemoryAgent.name,
                                      kind: 'memory',
                                    },
                                    draft.apiServer,
                                  )
                                ).content
                              : '');

                          setActiveMemoryFilePath(file.path);
                          setMemoryFileContent(content);
                          setMemoryFileDirty(false);
                          setMemoryFileStatus(null);
                        } catch (error) {
                          setMemoryFileStatus({
                            tone: 'error',
                            message: error instanceof Error ? error.message : '读取记忆文件失败。',
                          });
                        }
                      }}
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                        activeMemoryFilePath === file.path
                          ? 'border-white/15 bg-white/10 text-white'
                          : 'border-transparent bg-transparent text-white/70 hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="truncate text-sm font-medium">{file.label}</div>
                        <div className="text-[10px] uppercase tracking-[0.2em] text-white/35">
                          {file.kind === 'memory'
                            ? 'LONG-TERM'
                            : file.kind === 'daily_source'
                              ? 'SOURCE'
                              : file.kind === 'daily_warm'
                                ? 'WARM'
                                : 'COLD'}
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-white/45">
                        {file.kind === 'memory'
                          ? `memory/agents/${activeMemoryAgent?.slug ?? 'agent'}/MEMORY.md`
                          : file.path}
                      </div>
                    </button>
                  ))}
                  {!memoryFiles.length ? (
                    <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-white/45">
                      {draft.apiServer.enabled ? '当前 agent 还没有可编辑的记忆文件。' : '先启用 API 服务器，才能直接编辑项目里的记忆文件。'}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="min-h-0 overflow-y-auto bg-[#1E1E1E] p-6 custom-scrollbar">
                <SectionCard
                  title={activeMemoryFile?.label ?? '记忆文件编辑器'}
                  description="这里编辑的是原始 Markdown 文件。保存后会立即刷新当前 agent 的索引与运行时记忆。"
                  action={
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          saveMemoryFile().catch(console.error);
                        }}
                        disabled={!draft.apiServer.enabled || !activeMemoryFilePath || memoryFileLoading}
                        className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Upload size={14} />
                        保存
                      </button>
                      <button
                        onClick={() => {
                          handleManualMemoryRescan().catch(console.error);
                        }}
                        disabled={!draft.apiServer.enabled || !activeMemoryAgent || memoryFileLoading}
                        className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <RefreshCw size={14} />
                        重扫索引
                      </button>
                      <button
                        onClick={() => {
                          handleLifecycleSync().catch(console.error);
                        }}
                        disabled={!draft.apiServer.enabled || !activeMemoryAgent || memoryFileLoading}
                        className="inline-flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-2 text-sm text-amber-100 hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <RefreshCw size={14} />
                        同步温冷层
                      </button>
                      <button
                        onClick={() => {
                          removeActiveDailyFile().catch(console.error);
                        }}
                        disabled={
                          !draft.apiServer.enabled ||
                          !activeMemoryFile ||
                          activeMemoryFile.kind === 'memory' ||
                          memoryFileLoading
                        }
                        className="inline-flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-200 hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                        删除
                      </button>
                    </div>
                  }
                >
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-white/55">
                      <div>文件路径: {activeMemoryFile?.path ?? '未选择文件'}</div>
                      <div className="mt-2">
                        {activeMemoryFile?.kind === 'memory'
                          ? '长期记忆建议写在正文里，必要时可手动维护 frontmatter。'
                          : '日记文件适合顺序追加活动记录、待办、阻塞和 next step。'}
                      </div>
                    </div>
                    <textarea
                      value={memoryFileContent}
                      onChange={(event) => {
                        setMemoryFileContent(event.target.value);
                        setMemoryFileDirty(true);
                      }}
                      placeholder={
                        draft.apiServer.enabled
                          ? '这里直接编辑项目中的 Markdown 文件。'
                          : '启用 API 服务器后，这里会直接绑定到 memory/agents/<agent-slug>/...'
                      }
                      disabled={!draft.apiServer.enabled || !activeMemoryFilePath}
                      className="min-h-[360px] w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-4 font-mono text-sm text-white outline-none focus:border-emerald-500/50 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <div
                      className={`text-xs ${
                        memoryFileStatus?.tone === 'error'
                          ? 'text-red-200'
                          : memoryFileStatus?.tone === 'success'
                            ? 'text-emerald-200'
                            : 'text-white/45'
                      }`}
                    >
                      {memoryFileStatus?.message ??
                        (memoryFileDirty
                          ? '当前文件有未保存修改。'
                          : '文件内容与当前 agent 的索引状态已同步。')}
                    </div>
                  </div>
                </SectionCard>
              </div>
            </div>
          </div>
        );

      case 'api':
        return (
          <div className="space-y-4">
            <SectionCard
              title="本地 API Server"
              description="开启后，前端会通过本地 API 直接读写项目里的记忆文件和夜间归档设置。"
            >
              <div className="space-y-4">
                <ToggleCard
                  title="启用本地 API Server"
                  description="开启后，前端会通过本地 API 直接读写项目里的 memory 文件。"
                  checked={draft.apiServer.enabled}
                  onChange={(checked) =>
                    updateDraft((current) => ({
                      ...current,
                      apiServer: {
                        ...current.apiServer,
                        enabled: checked,
                      },
                    }))
                  }
                />
                <input
                  value={draft.apiServer.baseUrl}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      apiServer: {
                        ...current.apiServer,
                        baseUrl: event.target.value,
                      },
                    }))
                  }
                  placeholder="http://127.0.0.1:3850"
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-emerald-500/50"
                />
                <input
                  value={draft.apiServer.authToken}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      apiServer: {
                        ...current.apiServer,
                        authToken: event.target.value,
                      },
                    }))
                  }
                  placeholder="Auth token"
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-emerald-500/50"
                />
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
                  <div>
                    本地服务命令：
                    <code className="ml-2 rounded bg-black/30 px-2 py-1 text-xs text-white">npm run api-server</code>
                  </div>
                  <div className="mt-2 text-xs text-white/45">
                    {draft.apiServer.enabled
                      ? apiServerSummary || '正在连接本地 API Server。'
                      : '当前未启用，夜间归档和文件真源编辑都不会生效。'}
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="夜间自动归档"
              description="由本地 API Server 在后台定时执行。若夜间服务未启动，下次启动时会自动补跑。"
              action={
                <button
                  onClick={() => loadNightlyArchive({ announce: '已重新读取夜间归档状态。' })}
                  disabled={!draft.apiServer.enabled || nightlyArchiveLoading}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/75 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw size={14} className={nightlyArchiveLoading ? 'animate-spin' : undefined} />
                  刷新状态
                </button>
              }
            >
              <div className="space-y-4">
                <ToggleCard
                  title="启用夜间自动归档"
                  description="默认每天在设定时间同步温冷层，并在需要时补跑漏掉的归档。"
                  checked={nightlyArchiveEnabled}
                  onChange={setNightlyArchiveEnabled}
                />
                <ToggleCard
                  title="启用 LLM 重要性评分"
                  description="复用当前活动模型为进入 warm/cold 的 daily 打分；失败时自动回退规则评分。"
                  checked={nightlyArchiveUseLlmScoring}
                  onChange={setNightlyArchiveUseLlmScoring}
                />
                <div className="grid gap-4 md:grid-cols-[220px_1fr]">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="mb-2 text-sm font-medium text-white/90">归档时间</div>
                    <input
                      type="time"
                      value={nightlyArchiveTime}
                      onChange={(event) => setNightlyArchiveTime(event.target.value)}
                      disabled={!draft.apiServer.enabled || nightlyArchiveLoading}
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <p className="mt-2 text-xs text-white/45">使用本机时间，默认每天凌晨 03:00。</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/75">
                    <div className="font-medium text-white/90">当前状态</div>
                    <div className="mt-2 text-xs text-white/55">
                      {formatNightlyArchiveRunSummary(nightlyArchiveStatus)}
                    </div>
                    <div className="mt-4 grid gap-2 text-xs text-white/50">
                      <div>下一次执行：{nightlyArchiveStatus?.nextRunAt ?? '未计划'}</div>
                      <div>最近成功：{nightlyArchiveStatus?.state.lastSuccessfulRunAt ?? '暂无'}</div>
                      <div>最近尝试：{nightlyArchiveStatus?.state.lastAttemptedRunAt ?? '暂无'}</div>
                      <div>补跑待执行：{nightlyArchiveStatus?.catchUpDue ? '是' : '否'}</div>
                      <div>LLM 评分：{nightlyArchiveStatus?.settings.useLlmScoring ? '开启' : '关闭'}</div>
                    </div>
                  </div>
                </div>
                <div
                  className={`text-xs ${
                    nightlyArchiveMessage?.tone === 'error'
                      ? 'text-red-200'
                      : nightlyArchiveMessage?.tone === 'success'
                        ? 'text-emerald-200'
                        : 'text-white/45'
                  }`}
                >
                  {nightlyArchiveMessage?.message ?? '夜间归档设置会保存到项目内 `.flowagent/` 状态文件。'}
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      handleNightlyArchiveSave().catch(console.error);
                    }}
                    disabled={!draft.apiServer.enabled || nightlyArchiveLoading}
                    className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ArrowUpFromLine size={14} />
                    保存夜间归档设置
                  </button>
                </div>
              </div>
            </SectionCard>
          </div>
        );

      case 'docs':
        return (
          <div className="grid gap-4 md:grid-cols-2">
            <SectionCard title="RAG 最大返回条数" description="控制知识库召回结果数量。">
              <input
                type="number"
                min={1}
                max={12}
                value={draft.documents.maxSearchResults}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    documents: {
                      ...current.documents,
                      maxSearchResults: Number(event.target.value),
                    },
                  }))
                }
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
              />
            </SectionCard>
            <SectionCard title="文档预览长度" description="控制搜索结果卡片的摘要长度。">
              <input
                type="number"
                min={80}
                max={600}
                value={draft.documents.maxDocumentPreviewLength}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    documents: {
                      ...current.documents,
                      maxDocumentPreviewLength: Number(event.target.value),
                    },
                  }))
                }
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
              />
            </SectionCard>
            <SectionCard title="启用向量检索" description="开启后会调用 embedding 接口，为知识库追加语义召回。">
              <ToggleCard
                title="Hybrid Search"
                description="保留 BM25，同时叠加向量相似度排序。"
                checked={draft.documents.enableVectorSearch}
                onChange={(checked) =>
                  updateDraft((current) => ({
                    ...current,
                    documents: {
                      ...current.documents,
                      enableVectorSearch: checked,
                    },
                  }))
                }
              />
            </SectionCard>
            <SectionCard title="Embedding 模型" description="默认按阿里 DashScope 兼容接口调用。">
              <div className="space-y-3">
                <input
                  value={draft.documents.embeddingModel}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      documents: {
                        ...current.documents,
                        embeddingModel: event.target.value,
                      },
                    }))
                  }
                  placeholder="text-embedding-v4"
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                />
                <input
                  value={draft.documents.embeddingBaseUrl}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      documents: {
                        ...current.documents,
                        embeddingBaseUrl: event.target.value,
                      },
                    }))
                  }
                  placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                />
                <input
                  type="number"
                  min={64}
                  max={2048}
                  step={64}
                  value={draft.documents.embeddingDimensions}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      documents: {
                        ...current.documents,
                        embeddingDimensions: Number(event.target.value),
                      },
                    }))
                  }
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                />
              </div>
            </SectionCard>
            <SectionCard title="Embedding API Key" description="只保存在本地配置中，不会写入 git。">
              <input
                type="password"
                value={draft.documents.embeddingApiKey}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    documents: {
                      ...current.documents,
                      embeddingApiKey: event.target.value,
                    },
                  }))
                }
                placeholder="sk-..."
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
              />
            </SectionCard>
          </div>
        );

      case 'snippets':
        return (
          <SectionCard title="Prompt Snippets" description="短语的新增、编辑和插入已经接入到主界面的 Prompts & Assistants 页面。">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60">
              在主界面中编辑
            </span>
          </SectionCard>
        );

      case 'shortcuts':
        return (
          <SectionCard title="Keyboard Reference" description="当前工作区保留的快捷键建议。">
            <div className="grid gap-3 md:grid-cols-2">
              {[
                ['Enter', '发送消息'],
                ['Shift + Enter', '输入换行'],
                ['Cmd/Ctrl + K', '建议保留给命令面板'],
                ['Cmd/Ctrl + /', '建议保留给快捷帮助'],
              ].map(([combo, label]) => (
                <div key={combo} className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.2em] text-white/35">{combo}</div>
                  <div className="mt-2 text-sm text-white/85">{label}</div>
                </div>
              ))}
            </div>
          </SectionCard>
        );

      case 'assistant':
        return (
          <div className="grid gap-4 md:grid-cols-2">
            <SectionCard title="多 lane 扇出模式" description="控制多 agent lane 的执行方式。">
              <select
                value={draft.assistant.fanoutMode}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    assistant: {
                      ...current.assistant,
                      fanoutMode: event.target.value as AgentConfig['assistant']['fanoutMode'],
                    },
                  }))
                }
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
              >
                <option value="parallel" className="bg-[#111111]">
                  Parallel
                </option>
                <option value="sequential" className="bg-[#111111]">
                  Sequential
                </option>
              </select>
            </SectionCard>
            <ToggleCard
              title="允许 lane 覆盖模型"
              description="助手配置可以覆盖工作区默认 provider / model。"
              checked={draft.assistant.allowLaneModelOverride}
              onChange={(checked) =>
                updateDraft((current) => ({
                  ...current,
                  assistant: {
                    ...current.assistant,
                    allowLaneModelOverride: checked,
                  },
                }))
              }
            />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <input
        ref={backupRestoreInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={restoreBackupFromFile}
      />
      <input
        ref={externalImportInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={importExternalData}
      />

      <div className="flex h-[86vh] min-h-[640px] w-full max-w-[1460px] overflow-hidden rounded-[32px] border border-white/10 bg-[#1E1E1E] shadow-2xl">
        <div className="flex w-48 flex-col border-r border-white/5 bg-[#181818]">
          <div className="flex items-center gap-2 border-b border-white/5 p-4 font-semibold text-white/90">
            <SettingsIcon size={18} />
            <span>设置</span>
          </div>
          <div className="flex-1 space-y-1 overflow-y-auto p-2 custom-scrollbar">
            {CATEGORIES.map((category) => (
              <button
                key={category.id}
                onClick={() => setActiveCategory(category.id)}
                  className={`flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-sm transition-colors ${
                    activeCategory === category.id
                      ? 'bg-white/10 font-medium text-white'
                      : 'text-white/60 hover:bg-white/5 hover:text-white/90'
                }`}
              >
                <category.icon
                  size={16}
                  className={activeCategory === category.id ? 'text-emerald-400' : undefined}
                />
                {category.label}
              </button>
            ))}
          </div>
        </div>

        {activeCategory === 'models' ? (
          <>
            <div className="flex w-64 flex-col border-r border-white/5 bg-[#1E1E1E]">
              <div className="border-b border-white/5 p-3">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                  <input
                    type="text"
                    placeholder="搜索模型平台..."
                    value={providerSearchQuery}
                    onChange={(event) => setProviderSearchQuery(event.target.value)}
                    className="w-full rounded-full border border-white/10 bg-black/20 py-1.5 pl-9 pr-4 text-sm text-white focus:border-emerald-500/50 focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex-1 space-y-1 overflow-y-auto p-2 custom-scrollbar">
                {filteredProviders.map((provider) => (
                  <div
                    key={provider.id}
                    className={`group flex items-center gap-2 rounded-2xl px-2 py-2 text-sm transition-colors ${
                      activeProviderId === provider.id ? 'bg-white/5 text-white' : 'text-white/70 hover:bg-white/5'
                    }`}
                  >
                    <button
                      onClick={() => setActiveProviderId(provider.id)}
                      className="flex min-w-0 flex-1 items-center justify-between px-1 py-1 text-left"
                    >
                      <div className="flex items-center gap-3 truncate">
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400/20 to-emerald-600/20">
                          <Cloud size={14} className="text-emerald-400" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{provider.name}</div>
                          <div className="text-[11px] text-white/35">{provider.models.length} 个模型</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/40">
                        {provider.models.length}
                      </div>
                      <div
                        className={`rounded-full border px-2 py-0.5 text-[10px] ${
                          provider.enabled
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                            : 'border-white/10 text-white/40'
                        }`}
                      >
                        {provider.enabled ? 'ON' : 'OFF'}
                      </div>
                    </div>
                    </button>
                    <button
                      onClick={() => removeProvider(provider.id)}
                      className="rounded-full border border-transparent p-2 text-white/20 opacity-0 transition-all duration-150 hover:scale-105 hover:border-red-500/30 hover:bg-red-500/12 hover:text-red-300 group-hover:opacity-100"
                      title="删除模型服务"
                    >
                      <Minus size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="border-t border-white/5 p-3">
                <button
                  onClick={() => setShowAddProviderDialog(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-full border border-white/10 py-2 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <Plus size={16} />
                  添加
                </button>
              </div>
            </div>

            <div className="relative flex flex-1 flex-col bg-[#1E1E1E]">
              <button
                onClick={onClose}
                className="absolute right-4 top-4 z-10 rounded-full p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={18} />
              </button>

              {activeProvider ? (
                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                  <div className="mb-8 flex items-center justify-between">
                    <h2 className="flex items-center gap-3 text-xl font-semibold text-white">
                      {activeProvider.name}
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-normal text-white/45">
                        {activeProvider.type}
                      </span>
                      <span className="rounded-full border border-emerald-500/15 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-normal text-emerald-100/80">
                        {getProviderRequestMode(activeProvider.protocol) === 'responses'
                          ? 'responses'
                          : activeProvider.protocol === 'anthropic_native'
                            ? 'anthropic'
                            : 'chat'}
                      </span>
                    </h2>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => removeProvider(activeProvider.id)}
                        className="rounded-full border border-white/10 bg-white/5 p-2 text-white/60 transition-all duration-150 hover:scale-105 hover:border-red-500/30 hover:bg-red-500/12 hover:text-red-300"
                        title="删除当前模型服务"
                      >
                        <Minus size={15} />
                      </button>
                      <label className="relative inline-flex cursor-pointer items-center">
                        <input
                          type="checkbox"
                          className="peer sr-only"
                          checked={activeProvider.enabled}
                          onChange={(event) =>
                            updateProvider(activeProvider.id, { enabled: event.target.checked })
                          }
                        />
                        <div className="peer h-6 w-11 rounded-full bg-white/10 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-emerald-500 peer-checked:after:translate-x-full" />
                      </label>
                    </div>
                  </div>

                  <div className="max-w-3xl space-y-8">
                    <SectionCard title="鉴权与连通性">
                      <div className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <div className="mb-2 flex items-center justify-between">
                              <label className="text-sm font-medium text-white/90">创建协议</label>
                              <div className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/45">
                                {getProviderRequestMode(activeProvider.protocol)}
                              </div>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                              <div className="text-sm text-white/90">
                                {PROVIDER_PROTOCOL_OPTIONS.find((option) => option.value === activeProvider.protocol)?.label ??
                                  '未知协议'}
                              </div>
                            </div>
                            <p className="mt-2 text-[11px] text-white/40">
                              协议在新增厂商时确定。需要另一种协议时，请新增一个带固定后缀的新厂商条目。
                            </p>
                          </div>

                          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                            <div className="text-[11px] uppercase tracking-[0.24em] text-white/35">Request Mode</div>
                            <div className="mt-2 text-sm font-medium text-white/90">
                              {getProviderRequestMode(activeProvider.protocol) === 'responses'
                                ? 'Responses'
                                : activeProvider.protocol === 'anthropic_native'
                                  ? 'Anthropic Messages'
                                  : 'Chat Completions'}
                            </div>
                            <div className="mt-2 text-xs leading-6 text-white/45">
                              {getProviderRequestMode(activeProvider.protocol) === 'responses'
                                ? '该厂商会走 `/responses`，适合 Qwen 内置工具、MCP 与更完整的 tool orchestration。'
                                : '该厂商会走传统聊天接口，工具调用继续通过 chat-completions / LangGraph 本地工具链完成。'}
                            </div>
                          </div>
                        </div>

                        <div>
                          <div className="mb-2 flex items-center justify-between">
                            <label className="text-sm font-medium text-white/90">API 密钥</label>
                            <Sliders size={14} className="text-white/40" />
                          </div>
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <input
                                type={showKey ? 'text' : 'password'}
                                value={activeProvider.apiKey}
                                onChange={(event) =>
                                  updateProvider(activeProvider.id, { apiKey: event.target.value })
                                }
                                placeholder="sk-..."
                                className="w-full rounded-lg border border-white/10 bg-black/20 py-2 pl-3 pr-10 text-sm text-white focus:border-emerald-500/50 focus:outline-none"
                              />
                              <button
                                onClick={() => setShowKey((previous) => !previous)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80"
                              >
                                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                            </div>
                            <button
                              onClick={() => validateProviderConfig(activeProvider)}
                              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
                            >
                              检测
                            </button>
                          </div>
                          <p className="mt-2 text-right text-[11px] text-white/40">多个密钥可用逗号分隔</p>
                          {providerChecks[activeProvider.id] ? (
                            <p className="mt-2 text-[11px] text-emerald-300/80">{providerChecks[activeProvider.id]}</p>
                          ) : null}
                        </div>

                        <div>
                          <div className="mb-2 flex items-center justify-between">
                            <label className="text-sm font-medium text-white/90">API 地址</label>
                            <Sliders size={14} className="text-white/40" />
                          </div>
                          <input
                            type="text"
                            value={activeProvider.baseUrl || ''}
                            onChange={(event) =>
                              updateProvider(activeProvider.id, { baseUrl: event.target.value })
                            }
                            placeholder={getProviderBaseUrlPlaceholder(activeProvider.protocol)}
                            className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white focus:border-emerald-500/50 focus:outline-none"
                          />
                          <p className="mt-2 text-[11px] text-white/40">
                            预览: {getProviderRequestPreview(activeProvider.baseUrl, activeProvider.protocol)}
                          </p>
                        </div>
                      </div>
                    </SectionCard>

                    <SectionCard
                      title="模型列表"
                      description="支持自动探测 `/models`，Responses 兼容地址会额外回退到对应的 Chat 兼容模型列表。"
                      action={
                        <div className="flex items-center gap-2">
                          <button
                            onClick={async () => {
                              try {
                                setProviderLoadingId(activeProvider.id);
                                setProviderChecks((current) => ({
                                  ...current,
                                  [activeProvider.id]: '正在自动获取模型列表...',
                                }));

                                const result = await fetchProviderModels(activeProvider);
                                setProviderChecks((current) => ({
                                  ...current,
                                  [activeProvider.id]: `已获取 ${result.models.length} 个模型，请先筛选后导入。`,
                                }));
                                openModelImportDialog(activeProvider, result);
                              } catch (error: any) {
                                setProviderChecks((current) => ({
                                  ...current,
                                  [activeProvider.id]: `自动获取失败: ${error.message}`,
                                }));
                              } finally {
                                setProviderLoadingId(null);
                              }
                            }}
                            disabled={providerLoadingId === activeProvider.id}
                            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <RefreshCw
                              size={12}
                              className={providerLoadingId === activeProvider.id ? 'animate-spin' : ''}
                            />
                            获取模型列表
                          </button>
                          <button
                            onClick={addModelToProvider}
                            className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-white/80 hover:bg-white/10"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      }
                    >
                      <div className="space-y-4">
                        <div className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-black/10 p-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="text-sm font-medium text-white/90">按模型族和系列浏览</div>
                            <div className="text-[11px] text-white/40">
                              当前 {activeProvider.models.length} 个模型，筛选后 {modelGroups.totalCount} 个，分为 {modelGroups.groups.length} 个分类。
                            </div>
                          </div>
                          <div className="relative w-full md:max-w-xs">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                            <input
                              type="text"
                              value={modelSearchQuery}
                              onChange={(event) => setModelSearchQuery(event.target.value)}
                              placeholder="搜索模型名称..."
                              className="w-full rounded-full border border-white/10 bg-black/20 py-2 pl-9 pr-4 text-sm text-white focus:border-emerald-500/50 focus:outline-none"
                            />
                          </div>
                        </div>

                        {modelGroups.groups.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-8 text-center text-sm text-white/40">
                            没有匹配的模型。
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {modelGroups.groups.map((group) => {
                              const collapsed = collapsedModelGroups[group.id] ?? false;

                              return (
                                <div
                                  key={group.id}
                                  className="rounded-2xl border border-white/5 bg-white/[0.03] p-2"
                                >
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() =>
                                        setCollapsedModelGroups((current) => ({
                                          ...current,
                                          [group.id]: !collapsed,
                                        }))
                                      }
                                      className="flex min-w-0 flex-1 items-center justify-between rounded-[18px] px-3 py-2 text-left transition-colors hover:bg-white/5"
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
                                    <button
                                      onClick={() =>
                                        removeModelsFromProvider(
                                          activeProvider.id,
                                          group.series.flatMap((series) => series.models),
                                        )
                                      }
                                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-transparent text-white/20 transition-all duration-150 hover:scale-105 hover:border-red-500/30 hover:bg-red-500/12 hover:text-red-300"
                                      title={`移除 ${group.label} 分类`}
                                    >
                                      <Minus size={14} />
                                    </button>
                                  </div>

                                  {!collapsed ? (
                                    <div className="mt-2 space-y-3 px-1 pb-1">
                                      {group.series.map((series) => {
                                        const seriesCollapsed = collapsedModelSeries[series.id] ?? false;

                                        return (
                                          <div
                                            key={series.id}
                                            className="rounded-[18px] border border-white/5 bg-black/10 p-3"
                                          >
                                            <div className="flex items-center gap-2">
                                              <button
                                                onClick={() =>
                                                  setCollapsedModelSeries((current) => ({
                                                    ...current,
                                                    [series.id]: !seriesCollapsed,
                                                  }))
                                                }
                                                className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-[14px] px-1 py-1 text-left transition-colors hover:bg-white/5"
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
                                              <button
                                                onClick={() =>
                                                  removeModelsFromProvider(activeProvider.id, series.models)
                                                }
                                                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-transparent text-white/20 transition-all duration-150 hover:scale-105 hover:border-red-500/30 hover:bg-red-500/12 hover:text-red-300"
                                                title={`移除 ${series.label} 系列`}
                                              >
                                                <Minus size={13} />
                                              </button>
                                            </div>

                                            {!seriesCollapsed ? (
                                              <div className="mt-2 space-y-2">
                                                {series.models.map((model) => (
                                                  <div
                                                    key={model}
                                                    className="group flex items-center justify-between rounded-xl border border-white/5 bg-white/5 p-3 transition-colors hover:bg-white/10"
                                                  >
                                                    <div className="flex min-w-0 items-center gap-3">
                                                      <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-400/20 to-red-500/20">
                                                        <Box size={10} className="text-orange-400" />
                                                      </div>
                                                      <span className="truncate text-sm text-white/90">{model}</span>
                                                    </div>
                                                    <button
                                                      onClick={() =>
                                                        removeModelsFromProvider(activeProvider.id, [model])
                                                      }
                                                      className="rounded-full border border-transparent p-1.5 text-white/25 opacity-0 transition-all duration-150 hover:scale-105 hover:border-red-500/30 hover:bg-red-500/12 hover:text-red-300 group-hover:opacity-100"
                                                      title="移除模型"
                                                    >
                                                      <Minus size={12} />
                                                    </button>
                                                  </div>
                                                ))}
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
                    </SectionCard>
                  </div>
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center text-white/40">请选择一个模型服务</div>
              )}
            </div>
          </>
        ) : (
          <div className="relative flex min-w-0 flex-1 flex-col bg-[#1E1E1E]">
            <button
              onClick={onClose}
              className="absolute right-4 top-4 z-10 rounded-full p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X size={18} />
            </button>

            <div className="flex-1 overflow-y-auto p-5 pr-14 custom-scrollbar">
              <div className="space-y-4">
                {configSaveStatus ? (
                  <div
                    className={`rounded-2xl border px-4 py-3 text-sm ${
                      configSaveStatus.tone === 'error'
                        ? 'border-red-500/20 bg-red-500/10 text-red-100'
                        : configSaveStatus.tone === 'success'
                          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
                          : 'border-white/10 bg-white/[0.03] text-white/70'
                    }`}
                  >
                    {configSaveStatus.message}
                  </div>
                ) : null}
                {renderSettingsContent()}
              </div>
            </div>
          </div>
        )}
      </div>

      {modelImportDialog ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm">
          <div className="flex h-[78vh] min-h-[560px] w-full max-w-[980px] flex-col overflow-hidden rounded-[30px] border border-white/10 bg-[#171717] shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-white/5 px-6 py-5">
              <div>
                <div className="text-lg font-semibold text-white">选择要导入的模型</div>
                <div className="mt-1 text-sm text-white/55">
                  {modelImportDialog.providerName} · 来源 {modelImportDialog.resolvedUrl}
                </div>
              </div>
              <button
                onClick={() => setModelImportDialog(null)}
                className="rounded-full p-2 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex flex-1 min-h-0 flex-col px-6 py-5">
              <div className="mb-4 flex flex-col gap-3 rounded-[24px] border border-white/5 bg-black/10 p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-medium text-white/90">
                    共获取 {modelImportDialog.models.length} 个模型，当前已入库 {importDialogProvider?.models.length ?? 0} 个
                  </div>
                  <div className="text-[11px] text-white/40">
                    默认不选中。点击加号会立即写入当前 provider，减号只会删除当前显示列表。
                  </div>
                </div>
                <div className="w-full md:min-w-[360px]">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                    <input
                      type="text"
                      value={importModelSearchQuery}
                      onChange={(event) => setImportModelSearchQuery(event.target.value)}
                      placeholder="搜索待导入模型..."
                      className="w-full rounded-full border border-white/10 bg-black/20 py-2 pl-9 pr-4 text-sm text-white focus:border-emerald-500/50 focus:outline-none"
                    />
                  </div>
                  <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-xs text-white/60">
                    <input
                      type="checkbox"
                      checked={importOnlyNotAdded}
                      onChange={(event) => setImportOnlyNotAdded(event.target.checked)}
                      className="h-4 w-4 rounded border-white/15 bg-black/20 text-emerald-500 focus:ring-emerald-500/40"
                    />
                    仅显示未入库模型
                  </label>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pr-1 custom-scrollbar">
                {importModelGroups.groups.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-4 py-12 text-center text-sm text-white/40">
                    没有匹配的模型。
                  </div>
                ) : (
                  <div className="space-y-3">
                    {importModelGroups.groups.map((group) => {
                      const collapsed = collapsedImportGroups[group.id] ?? false;
                      const groupModels = group.series.flatMap((series) => series.models);
                      const importedCount = groupModels.filter((model) => importedModelIds.has(model.toLowerCase())).length;

                      return (
                        <div
                          key={group.id}
                          className="rounded-2xl border border-white/5 bg-white/[0.03] p-2"
                        >
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() =>
                                setCollapsedImportGroups((current) => ({
                                  ...current,
                                  [group.id]: !collapsed,
                                }))
                              }
                              className="flex min-w-0 flex-1 items-center justify-between rounded-[18px] px-3 py-2 text-left transition-colors hover:bg-white/5"
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
                                    {group.series.length} 个系列 · {importedCount}/{group.totalCount} 已入库
                                  </div>
                                </div>
                              </div>
                              <div className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/45">
                                {group.totalCount}
                              </div>
                            </button>
                            <button
                              onClick={() =>
                                addModelsToProvider(
                                  modelImportDialog.providerId,
                                  groupModels.filter((model) => !importedModelIds.has(model.toLowerCase())),
                                )
                              }
                              disabled={importedCount === group.totalCount}
                              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-transparent text-emerald-300 transition-all duration-150 hover:scale-105 hover:border-emerald-500/30 hover:bg-emerald-500/12 disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              <Plus size={14} />
                            </button>
                            <button
                              onClick={() => removeModelsFromImportDialog(groupModels)}
                              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-transparent text-white/20 transition-all duration-150 hover:scale-105 hover:border-red-500/30 hover:bg-red-500/12 hover:text-red-300"
                              title={`删除 ${group.label} 分类`}
                            >
                              <Minus size={14} />
                            </button>
                          </div>

                          {!collapsed ? (
                            <div className="mt-2 space-y-3 px-1 pb-1">
                              {group.series.map((series) => {
                                const seriesCollapsed = collapsedImportSeries[series.id] ?? false;
                                const seriesImportedCount = series.models.filter((model) =>
                                  importedModelIds.has(model.toLowerCase()),
                                ).length;

                                return (
                                  <div
                                    key={series.id}
                                    className="rounded-[18px] border border-white/5 bg-black/10 p-3"
                                  >
                                    <div className="flex items-center gap-3">
                                      <button
                                        onClick={() =>
                                          setCollapsedImportSeries((current) => ({
                                            ...current,
                                            [series.id]: !seriesCollapsed,
                                          }))
                                        }
                                        className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-[14px] px-1 py-1 text-left transition-colors hover:bg-white/5"
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
                                            <div className="text-[11px] text-white/35">
                                              {seriesImportedCount}/{series.models.length} 已入库
                                            </div>
                                          </div>
                                        </div>
                                        <div className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/45">
                                          {series.models.length}
                                        </div>
                                      </button>
                                      <button
                                        onClick={() =>
                                          addModelsToProvider(
                                            modelImportDialog.providerId,
                                            series.models.filter((model) => !importedModelIds.has(model.toLowerCase())),
                                          )
                                        }
                                        disabled={seriesImportedCount === series.models.length}
                                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-transparent text-emerald-300 transition-all duration-150 hover:scale-105 hover:border-emerald-500/30 hover:bg-emerald-500/12 disabled:cursor-not-allowed disabled:opacity-30"
                                      >
                                        <Plus size={13} />
                                      </button>
                                      <button
                                        onClick={() => removeModelsFromImportDialog(series.models)}
                                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-transparent text-white/20 transition-all duration-150 hover:scale-105 hover:border-red-500/30 hover:bg-red-500/12 hover:text-red-300"
                                        title={`删除 ${series.label} 系列`}
                                      >
                                        <Minus size={13} />
                                      </button>
                                    </div>

                                    {!seriesCollapsed ? (
                                      <div className="mt-2 space-y-2">
                                        {series.models.map((model) => {
                                          const imported = importedModelIds.has(model.toLowerCase());

                                          return (
                                            <div
                                              key={model}
                                              className={`group flex items-center gap-3 rounded-xl border p-3 transition-colors ${
                                                imported
                                                  ? 'border-emerald-500/25 bg-emerald-500/10'
                                                  : 'border-white/5 bg-white/5 hover:bg-white/10'
                                              }`}
                                            >
                                              <div className="flex min-w-0 flex-1 items-center justify-between">
                                                <div className="flex min-w-0 items-center gap-3">
                                                  <div
                                                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${
                                                      imported
                                                        ? 'border-emerald-400/70 bg-emerald-400/20 text-emerald-300'
                                                        : 'border-white/15 bg-black/20 text-white/20'
                                                    }`}
                                                  >
                                                    {imported ? '✓' : '+'}
                                                  </div>
                                                  <span className="truncate text-sm text-white/90">{model}</span>
                                                </div>
                                                <div className="text-[11px] text-white/35">
                                                  {imported ? '已入库' : '可添加'}
                                                </div>
                                              </div>
                                              <button
                                                onClick={() =>
                                                  addModelsToProvider(modelImportDialog.providerId, [model])
                                                }
                                                disabled={imported}
                                                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-transparent text-emerald-300 transition-all duration-150 hover:scale-105 hover:border-emerald-500/30 hover:bg-emerald-500/12 disabled:cursor-not-allowed disabled:opacity-30"
                                                title="添加当前模型"
                                              >
                                                <Plus size={12} />
                                              </button>
                                              <button
                                                onClick={() => removeModelsFromImportDialog([model])}
                                                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-transparent text-white/20 opacity-0 transition-all duration-150 hover:scale-105 hover:border-red-500/30 hover:bg-red-500/12 hover:text-red-300 group-hover:opacity-100"
                                                title="删除当前模型"
                                              >
                                                <Minus size={12} />
                                              </button>
                                            </div>
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

            <div className="flex items-center justify-between gap-4 border-t border-white/5 px-6 py-4">
              <div className="text-sm text-white/50">点加号立即入库，点减号仅从当前获取列表中移除显示。</div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setModelImportDialog(null)}
                  className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showAddProviderDialog ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm">
          <div className="w-full max-w-[720px] rounded-[28px] border border-white/10 bg-[#171717] shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-white/5 px-6 py-5">
              <div>
                <div className="text-lg font-semibold text-white">添加模型厂商</div>
                <div className="mt-1 text-sm text-white/45">
                  在这里一次性确定厂商、协议类型、API Key 和 Base URL。协议会固定保存，不再在详情页里回退。
                </div>
              </div>
              <button
                onClick={() => setShowAddProviderDialog(false)}
                className="rounded-full p-2 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-5 px-6 py-5">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <div className="mb-2 text-sm font-medium text-white/90">厂商名称</div>
                  <input
                    type="text"
                    value={addProviderDraft.vendorName}
                    onChange={(event) =>
                      setAddProviderDraft((current) => ({
                        ...current,
                        vendorName: event.target.value,
                      }))
                    }
                    placeholder="例如：Qwen / OpenRouter / 自建网关"
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-emerald-500/40"
                  />
                </label>

                <label className="block">
                  <div className="mb-2 text-sm font-medium text-white/90">协议类型</div>
                  <select
                    value={addProviderDraft.protocol}
                    onChange={(event) =>
                      setAddProviderDraft((current) => {
                        const nextProtocol = event.target.value as ProviderProtocol;
                        const previousPlaceholder = getProviderBaseUrlPlaceholder(current.protocol);
                        const nextPlaceholder = getProviderBaseUrlPlaceholder(nextProtocol);
                        const nextTypeBaseUrl =
                          !current.baseUrl.trim() || current.baseUrl.trim() === previousPlaceholder
                            ? nextPlaceholder
                            : current.baseUrl;
                        return {
                          ...current,
                          protocol: nextProtocol,
                          baseUrl: nextTypeBaseUrl,
                        };
                      })
                    }
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-emerald-500/40"
                  >
                    {PROVIDER_PROTOCOL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-[11px] leading-5 text-white/40">
                    {PROVIDER_PROTOCOL_OPTIONS.find((option) => option.value === addProviderDraft.protocol)?.description}
                  </p>
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <div className="mb-2 text-sm font-medium text-white/90">API Key</div>
                  <input
                    type="text"
                    value={addProviderDraft.apiKey}
                    onChange={(event) =>
                      setAddProviderDraft((current) => ({
                        ...current,
                        apiKey: event.target.value,
                      }))
                    }
                    placeholder="sk-..."
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-emerald-500/40"
                  />
                </label>

                <label className="block">
                  <div className="mb-2 text-sm font-medium text-white/90">Base URL</div>
                  <input
                    type="text"
                    value={addProviderDraft.baseUrl}
                    onChange={(event) =>
                      setAddProviderDraft((current) => ({
                        ...current,
                        baseUrl: event.target.value,
                      }))
                    }
                    placeholder={getProviderBaseUrlPlaceholder(addProviderDraft.protocol)}
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-emerald-500/40"
                  />
                  <p className="mt-2 text-[11px] text-white/40">
                    请求预览: {getProviderRequestPreview(addProviderDraft.baseUrl, addProviderDraft.protocol)}
                  </p>
                </label>
              </div>

              <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/35">生成后的厂商名</div>
                <div className="mt-2 text-sm text-white/85">
                  {addProviderDraft.vendorName.trim()
                    ? buildProviderDisplayName(addProviderDraft.vendorName, addProviderDraft.protocol)
                    : '请输入厂商名称'}
                </div>
                <div className="mt-2 text-[11px] leading-5 text-white/40">
                  会自动加上固定后缀，例如 `Qwen · Chat` 或 `Qwen · Responses`。后续如果需要另一种协议，新增一条即可，不直接改老条目。
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-white/5 px-6 py-4">
              <div className="text-sm text-white/45">
                协议在创建时固定保存，避免后续编辑其它字段时被误覆盖。
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowAddProviderDialog(false)}
                  className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white"
                >
                  取消
                </button>
                <button
                  onClick={() => addCustomProvider().catch(console.error)}
                  disabled={!addProviderDraft.vendorName.trim()}
                  className="rounded-full border border-emerald-500/20 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  创建厂商
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
