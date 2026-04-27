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
  Plus,
  RefreshCw,
  RotateCcw,
  Minus,
  Search,
  Server,
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
  listDocumentQualityScores,
  recordAuditLog,
  refreshDocumentQualityScores,
  type DataStats,
  type DocumentQualityScoreRecord,
  type TokenUsageAggregate,
  type TokenUsageSummary,
} from '../../lib/db';
import {
  THEME_COLOR_BOARD,
  THEME_PRESETS,
  applyThemePreferences,
  getThemePresetByColor,
} from '../../lib/theme';
import type { AgentMemoryDocument, AgentProfile } from '../../lib/agent-workspace';
import {
  deleteAgentMemoryDocument,
  saveAgentMemoryDocument,
  syncCurrentAgentMemory,
} from '../../lib/agent-workspace';
import {
  createAgentMemoryApiFileStore,
  deleteAgentMemoryFile,
  ensureAgentMemoryFile,
  exportAgentPackage,
  getApiServerHealth,
  getNightlyArchiveStatus,
  getAutomationSnapshot,
  importAgentPackage,
  inspectOfficialModelMetadata,
  listStoredModelMetadata,
  listAgentMemoryFiles,
  readAgentMemoryFile,
  resolveApiServerBaseUrl,
  runAutomation,
  runNightlyArchiveNow,
  saveNightlyArchiveSettings,
  saveStoredModelMetadata,
  syncAgentMemoryLifecycleForAgent,
  writeAgentMemoryFile,
  type AgentMemoryFileEntry,
  type AutomationRunStatus,
  type AutomationSnapshot,
  type VortexPackage,
  type NightlyArchiveStatus,
  type OfficialModelMetadataResponse,
} from '../../lib/agent-memory-api';
import {
  buildModelGroups,
  buildProviderGroups,
} from '../../lib/model-groups';
import {
  WEB_RUNTIME_CAPABILITIES,
  type RuntimeCapabilityProfile,
} from '../../lib/runtime-capabilities';
import type { SessionContextTokenBreakdown } from '../../lib/session-context-budget';
import { describeChangedFields } from '../../lib/audit-log-changes';
import { AuditLogPanel } from './AuditLogPanel';
import { MemoryTimelinePanel } from './MemoryTimelinePanel';
import { UsagePanel } from './UsagePanel';

const CATEGORIES = [
  { id: 'general', label: '常规', icon: Sliders },
  { id: 'display', label: '外观', icon: Monitor },
  { id: 'models', label: '模型服务', icon: Cloud },
  { id: 'default', label: '默认模型', icon: Box },
  { id: 'mcp', label: 'MCP 服务器', icon: Server },
  { id: 'search', label: '网络搜索', icon: Globe },
  { id: 'memory', label: '全局记忆', icon: Brain },
  { id: 'api', label: 'API 服务器', icon: Network },
  { id: 'data', label: '数据', icon: Database },
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

function resolveMemoryLayer(document: AgentMemoryDocument) {
  if (document.sourceType === 'warm_summary') {
    return 'warm';
  }
  if (document.sourceType === 'cold_summary') {
    return 'cold';
  }
  if (document.memoryScope === 'daily' || document.memoryScope === 'session') {
    return 'hot';
  }
  return 'long-term';
}

function memoryLayerLabel(layer: string) {
  if (layer === 'long-term') {
    return '长期';
  }
  if (layer === 'hot') {
    return '热层';
  }
  if (layer === 'warm') {
    return '温层';
  }
  return '冷层';
}

function summarizeChangedKeys(changedKeys: string[]) {
  if (!changedKeys.length) {
    return '未识别字段差异';
  }
  return changedKeys.slice(0, 6).join(', ');
}

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
  memoryDocuments?: AgentMemoryDocument[];
  activeAgentId?: string | null;
  initialCategory?: CategoryId;
  runtimeCapabilities?: RuntimeCapabilityProfile;
  sessionContextDiagnostics?: {
    tokens: number;
    contextWindow?: number;
    usagePercentage: number | null;
    breakdown: SessionContextTokenBreakdown | null;
  };
  latestModelInvocation?: {
    providerName: string;
    model: string;
    completedAt: string;
    streamDurationMs: number;
    reasoningDurationMs?: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost?: number;
    usageSource: 'provider' | 'estimate';
  } | null;
  activeTopicUsageSnapshot?: TokenUsageAggregate | null;
  tokenUsageSummary?: TokenUsageSummary | null;
  modelInvocationStats?: {
    successCount: number;
    failureCount: number;
    totalLatencyMs: number;
    lastLatencyMs?: number;
    lastError?: string;
  };
  onClose: () => void;
  onConfigSaved?: (config: AgentConfig) => void;
  onMemoryFilesChanged?: (agentId: string) => void | Promise<void>;
  onOpenPromptInspector?: () => void;
  promptInspectorAvailable?: boolean;
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

interface AddModelDraft {
  providerId: string;
  value: string;
}

interface ConfirmProviderDeleteState {
  providerId: string;
  providerName: string;
}

interface ConfirmMemoryDeleteState {
  path: string;
  label: string;
}

interface ModelDetailsDialogState {
  providerId: string;
  model: string;
}

function formatNightlyArchiveSchedule(settings?: NightlyArchiveStatus['settings'] | null) {
  if (!settings) {
    return '未读取';
  }
  return settings.cronExpression ? `cron ${settings.cronExpression}` : `每天 ${settings.time}`;
}

function isNightlyArchiveStatus(status: AutomationRunStatus | null): status is NightlyArchiveStatus {
  return Boolean(status && 'settings' in status);
}

function formatNightlyArchiveRunSummary(status: NightlyArchiveStatus | null) {
  if (!status) {
    return '当前未读取到夜间归档状态。';
  }

  const lastRun = status.state.lastRunSummary;
  if (!lastRun) {
    return status.settings.enabled
      ? `已启用，计划 ${formatNightlyArchiveSchedule(status.settings)}，${status.settings.useLlmScoring ? '使用 LLM 评分' : '使用规则评分'}，下一次执行 ${status.nextRunAt ?? '待计算'}。`
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

function formatInspectorTokenValue(value?: number) {
  return value ? value.toLocaleString() : '未识别';
}

function formatInspectorPriceValue(value?: number) {
  return value != null ? `${value} 元 / 1M` : '未识别';
}

function formatBytesCompact(value?: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return '未识别';
  }
  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(value >= 1024 * 1024 * 1024 ? 1 : 0)} MB`;
}

function formatDurationShort(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) {
    return '未识别';
  }
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatTimestampShort(value?: string | null) {
  if (!value) {
    return '未记录';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function parseOptionalNumberInput(value: string) {
  const normalized = value.trim().replace(/,/g, '');
  if (!normalized) {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
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
  className = '',
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`settings-section-card ${className}`}>
      <div className="settings-section-header">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="settings-section-title text-[14px] font-semibold">{title}</h3>
            {description ? <p className="settings-section-description mt-0.5 text-xs leading-relaxed">{description}</p> : null}
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </div>
      </div>
      <div className="settings-section-items">
        {children}
      </div>
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
    <div className="settings-toggle-card flex items-center justify-between gap-4 px-5 h-[66px] cursor-pointer" onClick={() => onChange(!checked)}>
      <div className="min-w-0 flex-1">
        <div className="settings-toggle-title text-[14px] font-medium">{title}</div>
        {description && <p className="settings-toggle-description mt-0.5 text-xs">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
        className="settings-toggle-track relative inline-flex h-[28px] w-[52px] flex-shrink-0 cursor-pointer items-center rounded-full transition-all duration-200 focus:outline-none"
        style={{ backgroundColor: checked ? 'var(--app-accent)' : 'var(--settings-toggle-off)' }}
      >
        <span className="settings-toggle-thumb inline-block h-[24px] w-[24px] rounded-full bg-white shadow-sm mx-[2px] transition-transform duration-200" style={{ transform: checked ? 'translateX(24px)' : 'translateX(0)' }} />
      </button>
    </div>
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
    <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
      <div className="min-w-0 flex-1">
        <div className="settings-row-label text-[14px] font-medium">{label}</div>
        <p className="settings-row-description mt-0.5 text-xs">{description}</p>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="settings-row-value text-[14px] font-medium tabular-nums">{value.toFixed(1)}</div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-[120px] h-[6px] rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, var(--app-accent) 0%, var(--app-accent) ${((value - min) / (max - min)) * 100}%, var(--settings-range-track) ${((value - min) / (max - min)) * 100}%, var(--settings-range-track) 100%)`,
          }}
        />
      </div>
    </div>
  );
}

function SystemPromptEditor({
  draft,
  updateDraft,
}: {
  draft: AgentConfig;
  updateDraft: React.Dispatch<React.SetStateAction<AgentConfig>>;
}) {
  const [localPrompt, setLocalPrompt] = useState(draft.systemPrompt);

  useEffect(() => {
    setLocalPrompt(draft.systemPrompt);
  }, [draft.systemPrompt]);

  const handleSave = () => {
    updateDraft((current) => ({
      ...current,
      systemPrompt: localPrompt,
    }));
  };

  const isDirty = localPrompt !== draft.systemPrompt;

  return (
    <div className="flex flex-col gap-3">
      <div className="max-w-3xl">
        <textarea
          value={localPrompt}
          onChange={(e) => setLocalPrompt(e.target.value)}
          className="min-h-[132px] max-h-[260px] w-full resize-y rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-[13px] leading-6 text-white outline-none transition-[border-color,background-color] focus:outline-none focus:ring-1 focus:ring-emerald-400/20"
        />
      </div>
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={!isDirty}
          className={`rounded-lg px-4 py-2 text-[12px] font-medium border transition-[background-color,border-color,color,transform] active:scale-[0.98] focus:outline-none focus:ring-1 focus:ring-white/15 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 ${
            isDirty
              ? 'bg-emerald-500/15 border-emerald-400/20 text-emerald-200/80 hover:bg-emerald-500/25 hover:border-emerald-400/30'
              : 'border-white/[0.06] bg-white/[0.03] text-white/30'
          }`}
        >
          {isDirty ? '保存改动' : '已保存'}
        </button>
      </div>
    </div>
  );
}

export const SettingsView = ({
  config,
  agents = [],
  memoryDocuments = [],
  activeAgentId = null,
  initialCategory = 'models',
  runtimeCapabilities = WEB_RUNTIME_CAPABILITIES,
  sessionContextDiagnostics,
  latestModelInvocation,
  activeTopicUsageSnapshot,
  tokenUsageSummary,
  modelInvocationStats,
  onClose,
  onConfigSaved,
  onMemoryFilesChanged,
  onOpenPromptInspector,
  promptInspectorAvailable = false,
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
  const [collapsedProviderProtocolGroups, setCollapsedProviderProtocolGroups] = useState<Record<string, boolean>>({});
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [collapsedModelGroups, setCollapsedModelGroups] = useState<Record<string, boolean>>({});
  const [collapsedModelSeries, setCollapsedModelSeries] = useState<Record<string, boolean>>({});
  const [stats, setStats] = useState<DataStats | null>(null);
  const [providerChecks, setProviderChecks] = useState<Record<string, string>>({});
  const [providerModelMetadata, setProviderModelMetadata] = useState<
    Record<string, Record<string, OfficialModelMetadataResponse>>
  >({});
  const [providerLoadingId, setProviderLoadingId] = useState<string | null>(null);
  const [showAddProviderDialog, setShowAddProviderDialog] = useState(false);
  const [addProviderDraft, setAddProviderDraft] = useState<AddProviderDraft>({
    vendorName: '',
    protocol: 'openai_chat_compatible',
    apiKey: '',
    baseUrl: getProviderBaseUrlPlaceholder('openai_chat_compatible'),
  });
  const [showAddModelDialog, setShowAddModelDialog] = useState(false);
  const [addModelDraft, setAddModelDraft] = useState<AddModelDraft | null>(null);
  const [confirmProviderDelete, setConfirmProviderDelete] = useState<ConfirmProviderDeleteState | null>(null);
  const [confirmMemoryDelete, setConfirmMemoryDelete] = useState<ConfirmMemoryDeleteState | null>(null);
  const [modelDetailsDialog, setModelDetailsDialog] = useState<ModelDetailsDialogState | null>(null);
  const [modelDetailsLoading, setModelDetailsLoading] = useState(false);
  const [modelDetailsError, setModelDetailsError] = useState('');
  const [modelDetailsDraft, setModelDetailsDraft] = useState<Partial<OfficialModelMetadataResponse> | null>(null);
  const [modelDetailsSaving, setModelDetailsSaving] = useState(false);
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
  const [memoryInspectorBusyId, setMemoryInspectorBusyId] = useState('');
  const [apiServerSummary, setApiServerSummary] = useState<string>('');
  const [configSaveStatus, setConfigSaveStatus] = useState<MemoryFileStatus | null>(null);
  const [nightlyArchiveStatus, setNightlyArchiveStatus] = useState<NightlyArchiveStatus | null>(null);
  const [nightlyArchiveLoading, setNightlyArchiveLoading] = useState(false);
  const [nightlyArchiveEnabled, setNightlyArchiveEnabled] = useState(false);
  const [nightlyArchiveTime, setNightlyArchiveTime] = useState('03:00');
  const [nightlyArchiveCronExpression, setNightlyArchiveCronExpression] = useState('');
  const [nightlyArchiveUseLlmScoring, setNightlyArchiveUseLlmScoring] = useState(false);
  const [nightlyArchiveMessage, setNightlyArchiveMessage] = useState<MemoryFileStatus | null>(null);
  const [automationSnapshot, setAutomationSnapshot] = useState<AutomationSnapshot | null>(null);
  const [automationLoadingId, setAutomationLoadingId] = useState<string | null>(null);
  const [automationMessage, setAutomationMessage] = useState<MemoryFileStatus | null>(null);
  const initialAgentSlug = agents.find((agent) => agent.id === activeAgentId)?.slug ?? agents[0]?.slug ?? 'vortex-core';
  const [agentTaskDraft, setAgentTaskDraft] = useState({
    agentSlug: initialAgentSlug,
    instruction: '',
  });
  const [agentPackageDraft, setAgentPackageDraft] = useState({
    agentSlug: initialAgentSlug,
    targetAgentSlug: '',
    importConfig: false,
  });
  const [agentPackageStatus, setAgentPackageStatus] = useState<MemoryFileStatus | null>(null);
  const [documentQualityScores, setDocumentQualityScores] = useState<DocumentQualityScoreRecord[]>([]);
  const [documentQualityLoading, setDocumentQualityLoading] = useState(false);
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<VortexRuntimeDiagnostics | null>(null);
  const [runtimeDiagnosticsLoading, setRuntimeDiagnosticsLoading] = useState(false);
  const [runtimeDiagnosticsError, setRuntimeDiagnosticsError] = useState('');
  const backupRestoreInputRef = useRef<HTMLInputElement>(null);
  const externalImportInputRef = useRef<HTMLInputElement>(null);
  const agentPackageImportInputRef = useRef<HTMLInputElement>(null);
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

  const loadRuntimeDiagnostics = async () => {
    if (!window.flowAgentDesktop?.getRuntimeDiagnostics) {
      setRuntimeDiagnostics(null);
      setRuntimeDiagnosticsError('当前运行环境不支持桌面运行态诊断。');
      return;
    }

    setRuntimeDiagnosticsLoading(true);
    setRuntimeDiagnosticsError('');
    try {
      const diagnostics = await window.flowAgentDesktop.getRuntimeDiagnostics();
      setRuntimeDiagnostics(diagnostics);
    } catch (error) {
      setRuntimeDiagnostics(null);
      setRuntimeDiagnosticsError(error instanceof Error ? error.message : '读取运行态诊断失败。');
    } finally {
      setRuntimeDiagnosticsLoading(false);
    }
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
    if (activeCategory === 'docs') {
      loadDocumentQualityScores().catch(console.error);
    }
  }, [activeCategory]);

  useEffect(() => {
    if (activeCategory !== 'api' || runtimeCapabilities.mode !== 'electron') {
      return;
    }
    loadRuntimeDiagnostics().catch(console.error);
  }, [activeCategory, runtimeCapabilities.mode]);

  useEffect(() => {
    const nextAgentId = activeAgentId ?? agents[0]?.id ?? '';
    if (nextAgentId && !agents.find((agent) => agent.id === activeMemoryAgentId)) {
      setActiveMemoryAgentId(nextAgentId);
    }
  }, [activeAgentId, activeMemoryAgentId, agents]);

  const configWriteTarget =
    runtimeCapabilities.hostBridge.configPath ||
    (runtimeCapabilities.mode === 'electron' ? '当前桌面工作区 config.json' : '当前项目配置 config.json');

  const commit = async (nextConfig: AgentConfig) => {
    const normalized = normalizeAgentConfig(nextConfig);
    const previousConfig = draftRef.current;
    setDraft(normalized);
    draftRef.current = normalized;
    applyThemePreferences(normalized);
    try {
      await saveAgentConfig(normalized);
      const diff = describeChangedFields(
        previousConfig as unknown as Record<string, unknown>,
        normalized as unknown as Record<string, unknown>,
      );
      void recordAuditLog({
        category: 'config',
        action: 'config_saved',
        target: 'config.json',
        status: 'success',
        summary: `Saved project config: ${summarizeChangedKeys(diff.changedKeys)}.`,
        metadata: diff,
        createdAt: new Date().toISOString(),
      }).catch((error) => {
        console.warn('Failed to record config audit log:', error);
      });
      setConfigSaveStatus({ tone: 'success', message: `已写入 ${configWriteTarget}。` });
      onConfigSaved?.(normalized);
    } catch (error) {
      setConfigSaveStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : `写入 ${configWriteTarget} 失败。`,
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

  const filteredProviderGroups = useMemo(
    () => buildProviderGroups(draft.providers, providerSearchQuery),
    [draft.providers, providerSearchQuery],
  );

  const activeProvider = draft.providers.find((provider) => provider.id === activeProviderId);
  const activeProviderModelMetadata = activeProvider
    ? providerModelMetadata[activeProvider.id] ?? {}
    : {};
  const modelDetailsProvider = modelDetailsDialog
    ? draft.providers.find((provider) => provider.id === modelDetailsDialog.providerId) ?? null
    : null;
  const modelDetailsMetadata =
    modelDetailsDialog && modelDetailsProvider
      ? providerModelMetadata[modelDetailsProvider.id]?.[modelDetailsDialog.model] ?? null
      : null;
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
  const activeMemoryDocuments = useMemo(
    () => memoryDocuments.filter((document) => document.agentId === activeMemoryAgent?.id),
    [activeMemoryAgent?.id, memoryDocuments],
  );
  const memoryLayerCounts = useMemo(
    () =>
      activeMemoryDocuments.reduce(
        (counts, document) => {
          const layer = resolveMemoryLayer(document);
          counts[layer] += 1;
          return counts;
        },
        { 'long-term': 0, hot: 0, warm: 0, cold: 0 } as Record<string, number>,
      ),
    [activeMemoryDocuments],
  );

  useEffect(() => {
    setModelSearchQuery('');
    setCollapsedModelGroups({});
    setCollapsedModelSeries({});
  }, [activeProviderId]);

  useEffect(() => {
    if (!providerSearchQuery.trim()) {
      return;
    }
    setCollapsedProviderProtocolGroups({});
  }, [providerSearchQuery]);

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

  useEffect(() => {
    if (!showAddModelDialog) {
      setAddModelDraft(null);
    }
  }, [showAddModelDialog]);

  useEffect(() => {
    if (!modelDetailsDialog) {
      setModelDetailsDraft(null);
      setModelDetailsError('');
      return;
    }
    if (modelDetailsMetadata) {
      setModelDetailsDraft(modelDetailsMetadata);
    }
  }, [modelDetailsDialog, modelDetailsMetadata]);

  useEffect(() => {
    if (!draft.apiServer.enabled || !activeProvider) {
      return;
    }

    let cancelled = false;
    listStoredModelMetadata(draft.apiServer, activeProvider.id)
      .then((entries) => {
        if (cancelled) {
          return;
        }
        setProviderModelMetadata((current) => ({
          ...current,
          [activeProvider.id]: entries,
        }));
      })
      .catch(() => {
        // Silent; explicit actions surface errors.
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeProvider,
    draft.apiServer.enabled,
    draft.apiServer.baseUrl,
    draft.apiServer.authToken,
  ]);

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
      for (const file of files) {
        const bootstrapKind =
          file.kind === 'memory' || file.kind === 'corrections' || file.kind === 'reflections' ? file.kind : null;
        if (!bootstrapKind) {
          continue;
        }
        if (file.exists) {
          continue;
        }
        await ensureAgentMemoryFile(
          {
            agentSlug: activeMemoryAgent.slug,
            agentName: activeMemoryAgent.name,
            kind: bootstrapKind,
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
      setNightlyArchiveCronExpression('');
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
      setNightlyArchiveCronExpression(status?.settings.cronExpression ?? '');
      setNightlyArchiveUseLlmScoring(status?.settings.useLlmScoring ?? false);
      setAutomationSnapshot(await getAutomationSnapshot(draft.apiServer));
      if (options.announce) {
        setNightlyArchiveMessage({ tone: 'neutral', message: options.announce });
      }
    } catch (error) {
      if (requestId !== nightlyArchiveRequestIdRef.current) {
        return;
      }
      setNightlyArchiveStatus(null);
      setAutomationSnapshot(null);
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
    if (!addModelDraft?.providerId || !addModelDraft.value.trim()) {
      return;
    }

    const provider = draft.providers.find((entry) => entry.id === addModelDraft.providerId);
    if (!provider) {
      return;
    }

    const nextModels = Array.from(new Set([...provider.models, addModelDraft.value.trim()]));
    await updateProvider(provider.id, { models: nextModels });
    setShowAddModelDialog(false);
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
    setConfirmProviderDelete(null);
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

  const inspectProviderModels = async (provider: ModelProvider) => {
    if (!draft.apiServer.enabled) {
      setProviderChecks((current) => ({
        ...current,
        [provider.id]: '需要先启用本地 API Server，模型检测才能抓取官方规格。',
      }));
      return;
    }

    if (provider.models.length === 0) {
      setProviderChecks((current) => ({
        ...current,
        [provider.id]: '当前厂商还没有入库模型，先获取或添加模型后再检测。',
      }));
      return;
    }

    setProviderLoadingId(provider.id);
    setProviderChecks((current) => ({
      ...current,
      [provider.id]: `正在检测 ${provider.models.length} 个模型的规格与费用信息...`,
    }));

    const nextResults: Record<string, OfficialModelMetadataResponse> = {};
    let successCount = 0;
    let failureCount = 0;
    let firstError = '';

    for (const model of provider.models) {
      try {
        const result = await inspectOfficialModelMetadata(draft.apiServer, provider.id, provider.name, model, {
          refresh: true,
        });
        if (
          result &&
          (
            result.contextWindow ||
            result.maxInputTokens ||
            result.longestReasoningTokens ||
            result.maxOutputTokens ||
            result.inputCostPerMillion != null ||
            result.outputCostPerMillion != null
          )
        ) {
          nextResults[model] = result;
          successCount += 1;
        } else {
          failureCount += 1;
          if (!firstError) {
            firstError = `${model} 未识别到有效规格字段`;
          }
        }
      } catch (error) {
        failureCount += 1;
        if (!firstError) {
          firstError = error instanceof Error ? error.message : `${model} 检测失败`;
        }
      }
    }

    setProviderModelMetadata((current) => ({
      ...current,
      [provider.id]: nextResults,
    }));
    setProviderChecks((current) => ({
      ...current,
      [provider.id]:
        failureCount === 0
          ? `模型检测完成：已识别 ${successCount} / ${provider.models.length} 个模型。`
          : `模型检测完成：已识别 ${successCount} / ${provider.models.length} 个模型；失败 ${failureCount} 个。${firstError ? ` ${firstError}` : ''}`,
    }));
    setProviderLoadingId(null);
  };

  const inspectSingleModel = async (provider: ModelProvider, model: string) => {
    if (!draft.apiServer.enabled) {
      throw new Error('需要先启用本地 API Server，模型检测才能抓取官方规格。');
    }

    const result = await inspectOfficialModelMetadata(draft.apiServer, provider.id, provider.name, model);
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
      throw new Error('没有从官方页面识别到可用的模型规格信息。');
    }

    setProviderModelMetadata((current) => ({
      ...current,
      [provider.id]: {
        ...(current[provider.id] ?? {}),
        [model]: result,
      },
    }));

    return result;
  };

  const openModelDetailsDialog = async (provider: ModelProvider, model: string) => {
    setModelDetailsDialog({ providerId: provider.id, model });
    setModelDetailsError('');
    setModelDetailsDraft(null);
    const cached = providerModelMetadata[provider.id]?.[model];
    if (cached) {
      setModelDetailsDraft(cached);
      return;
    }

    setModelDetailsLoading(true);
    try {
      const result = await inspectSingleModel(provider, model);
      setModelDetailsDraft(result);
    } catch (error) {
      setModelDetailsError(error instanceof Error ? error.message : '模型检测失败。');
    } finally {
      setModelDetailsLoading(false);
    }
  };

  const handleSaveModelDetails = async () => {
    if (!modelDetailsDialog || !modelDetailsProvider || !modelDetailsDraft) {
      return;
    }

    setModelDetailsSaving(true);
    setModelDetailsError('');
    try {
      const result = await saveStoredModelMetadata(draft.apiServer, {
        providerId: modelDetailsProvider.id,
        providerName: modelDetailsProvider.name,
        model: modelDetailsDialog.model,
        metadata: {
          versionLabel: modelDetailsDraft.versionLabel?.trim() || undefined,
          modeLabel: modelDetailsDraft.modeLabel?.trim() || undefined,
          resolverVersion: modelDetailsDraft.resolverVersion,
          contextWindow: parseOptionalNumberInput(String(modelDetailsDraft.contextWindow ?? '')),
          maxInputTokens: parseOptionalNumberInput(String(modelDetailsDraft.maxInputTokens ?? '')),
          maxInputCharacters: parseOptionalNumberInput(
            String(modelDetailsDraft.maxInputCharacters ?? ''),
          ),
          longestReasoningTokens: parseOptionalNumberInput(
            String(modelDetailsDraft.longestReasoningTokens ?? ''),
          ),
          maxOutputTokens: parseOptionalNumberInput(String(modelDetailsDraft.maxOutputTokens ?? '')),
          inputCostPerMillion: parseOptionalNumberInput(
            String(modelDetailsDraft.inputCostPerMillion ?? ''),
          ),
          outputCostPerMillion: parseOptionalNumberInput(
            String(modelDetailsDraft.outputCostPerMillion ?? ''),
          ),
          pricingNote: modelDetailsDraft.pricingNote?.trim() || undefined,
          excerpt: modelDetailsDraft.excerpt,
          sources: modelDetailsDraft.sources,
          fetchedAt: modelDetailsDraft.fetchedAt,
        },
      });
      if (!result) {
        throw new Error('写入本地模型规格失败。');
      }
      setProviderModelMetadata((current) => ({
        ...current,
        [modelDetailsProvider.id]: {
          ...(current[modelDetailsProvider.id] ?? {}),
          [modelDetailsDialog.model]: result,
        },
      }));
      setModelDetailsDraft(result);
    } catch (error) {
      setModelDetailsError(error instanceof Error ? error.message : '保存模型规格失败。');
    } finally {
      setModelDetailsSaving(false);
    }
  };

  const handleResetModelDetails = async () => {
    if (!modelDetailsDialog || !modelDetailsProvider) {
      return;
    }

    setModelDetailsLoading(true);
    setModelDetailsError('');
    try {
      const result = await inspectOfficialModelMetadata(
        draft.apiServer,
        modelDetailsProvider.id,
        modelDetailsProvider.name,
        modelDetailsDialog.model,
        { refresh: true },
      );
      if (!result) {
        throw new Error('重置为官方默认失败。');
      }
      setProviderModelMetadata((current) => ({
        ...current,
        [modelDetailsProvider.id]: {
          ...(current[modelDetailsProvider.id] ?? {}),
          [modelDetailsDialog.model]: result,
        },
      }));
      setModelDetailsDraft(result);
    } catch (error) {
      setModelDetailsError(error instanceof Error ? error.message : '重置为默认失败。');
    } finally {
      setModelDetailsLoading(false);
    }
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

  const showDesktopNotification = (title: string, body: string) => {
    window.flowAgentDesktop?.showNotification({ title, body }).catch((error) => {
      console.warn('Failed to show desktop notification:', error);
    });
  };

  const updateInspectorMemory = async (
    document: AgentMemoryDocument,
    mode: 'important' | 'archive' | 'delete',
  ) => {
    if (!activeMemoryAgent) {
      return;
    }

    setMemoryInspectorBusyId(`${mode}:${document.id}`);
    try {
      if (mode === 'delete') {
        await deleteAgentMemoryDocument(document.id);
        setMemoryFileStatus({ tone: 'success', message: '已删除该条索引记忆。' });
      } else {
        await saveAgentMemoryDocument({
          id: document.id,
          agentId: activeMemoryAgent.id,
          title: document.title,
          content: document.content,
          memoryScope: mode === 'archive' ? 'daily' : document.memoryScope,
          sourceType: mode === 'archive' ? 'cold_summary' : document.sourceType,
          importanceScore: mode === 'important' ? Math.max(document.importanceScore, 5) : Math.min(document.importanceScore, 2),
          topicId: document.topicId,
          eventDate: document.eventDate,
        });
        setMemoryFileStatus({
          tone: 'success',
          message: mode === 'important' ? '已提高该条记忆的重要性。' : '已把该条记忆标记为冷层归档。',
        });
      }

      await notifyMemoryFilesChanged(activeMemoryAgent.id);
    } catch (error) {
      setMemoryFileStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : '更新记忆检查器状态失败。',
      });
    } finally {
      setMemoryInspectorBusyId('');
    }
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
      showDesktopNotification('Vortex 记忆归档完成', formatLifecycleSyncStatus(lifecycleResult));
      void recordAuditLog({
        category: 'memory',
        action: 'memory_lifecycle_synced',
        agentId: activeMemoryAgent.id,
        target: activeMemoryAgent.slug,
        status: lifecycleResult.failures.length ? 'error' : 'success',
        summary: `Synced memory lifecycle for ${activeMemoryAgent.name}.`,
        details: formatLifecycleSyncStatus(lifecycleResult),
        metadata: {
          agentSlug: activeMemoryAgent.slug,
          scannedCount: lifecycleResult.scannedCount,
          warmUpdated: lifecycleResult.warmUpdated,
          coldUpdated: lifecycleResult.coldUpdated,
          failures: lifecycleResult.failures,
        },
        createdAt: new Date().toISOString(),
      }).catch((error) => {
        console.warn('Failed to record memory lifecycle audit log:', error);
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
      const previousContent = (await readAgentMemoryFile(activeMemoryFilePath, draft.apiServer)) ?? '';
      await writeAgentMemoryFile(activeMemoryFilePath, memoryFileContent, draft.apiServer);
      await rescanAgentMemory(activeMemoryAgent.id, '已写入 Markdown 文件并刷新当前 agent 索引。');
      await loadMemoryFiles({ preferredPath: activeMemoryFilePath });
      void recordAuditLog({
        category: 'memory',
        action: 'memory_file_saved',
        agentId: activeMemoryAgent.id,
        target: activeMemoryFilePath,
        status: 'success',
        summary: `Saved memory file for ${activeMemoryAgent.name}.`,
        metadata: {
          agentSlug: activeMemoryAgent.slug,
          path: activeMemoryFilePath,
          size: memoryFileContent.length,
          previousContent,
          nextContent: memoryFileContent,
        },
        createdAt: new Date().toISOString(),
      }).catch((error) => {
        console.warn('Failed to record memory save audit log:', error);
      });
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
      void recordAuditLog({
        category: 'memory',
        action: 'memory_daily_created',
        agentId: activeMemoryAgent.id,
        target: ensured.path,
        status: 'success',
        summary: `Created daily memory for ${activeMemoryAgent.name}.`,
        metadata: {
          agentSlug: activeMemoryAgent.slug,
          path: ensured.path,
        },
        createdAt: new Date().toISOString(),
      }).catch((error) => {
        console.warn('Failed to record daily memory create audit log:', error);
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

    setMemoryFileLoading(true);
    try {
      const removedPath = activeMemoryFile.path;
      const deletedContent = (await readAgentMemoryFile(removedPath, draft.apiServer)) ?? '';
      await deleteAgentMemoryFile(activeMemoryFile.path, draft.apiServer);
      await rescanAgentMemory(activeMemoryAgent.id, '已删除日记文件并刷新索引。');
      await loadMemoryFiles({
        preferredPath: memoryFiles.find((file) => file.path !== activeMemoryFile.path)?.path ?? null,
      });
      void recordAuditLog({
        category: 'memory',
        action: 'memory_daily_deleted',
        agentId: activeMemoryAgent.id,
        target: removedPath,
        status: 'success',
        summary: `Deleted daily memory for ${activeMemoryAgent.name}.`,
        metadata: {
          agentSlug: activeMemoryAgent.slug,
          path: removedPath,
          deletedContent,
        },
        createdAt: new Date().toISOString(),
      }).catch((error) => {
        console.warn('Failed to record daily memory delete audit log:', error);
      });
    } catch (error) {
      setMemoryFileStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : '删除日记文件失败。',
      });
    } finally {
      setMemoryFileLoading(false);
      setConfirmMemoryDelete(null);
    }
  };

  const restoreMemoryTimelineFile = async (input: { path: string; content: string; reason: string }) => {
    if (!activeMemoryAgent) {
      return;
    }

    setMemoryFileLoading(true);
    try {
      const currentContent = (await readAgentMemoryFile(input.path, draft.apiServer)) ?? '';
      await writeAgentMemoryFile(input.path, input.content, draft.apiServer);
      await rescanAgentMemory(activeMemoryAgent.id, '已按时间线快照撤销记忆文件并刷新索引。');
      await loadMemoryFiles({ preferredPath: input.path });
      void recordAuditLog({
        category: 'memory',
        action: 'memory_file_restored',
        agentId: activeMemoryAgent.id,
        target: input.path,
        status: 'success',
        summary: `Restored memory file for ${activeMemoryAgent.name}.`,
        metadata: {
          agentSlug: activeMemoryAgent.slug,
          path: input.path,
          reason: input.reason,
          previousContent: currentContent,
          nextContent: input.content,
        },
        createdAt: new Date().toISOString(),
      }).catch((error) => {
        console.warn('Failed to record memory restore audit log:', error);
      });
    } catch (error) {
      setMemoryFileStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : '撤销记忆文件失败。',
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
      const previousNightlySettings = {
        enabled: nightlyArchiveStatus?.settings.enabled ?? nightlyArchiveEnabled,
        time: nightlyArchiveStatus?.settings.time ?? nightlyArchiveTime,
        cronExpression: nightlyArchiveStatus?.settings.cronExpression ?? '',
        useLlmScoring: nightlyArchiveStatus?.settings.useLlmScoring ?? nightlyArchiveUseLlmScoring,
      };
      const nextStatus = await saveNightlyArchiveSettings(draft.apiServer, {
        enabled: nightlyArchiveEnabled,
        time: nightlyArchiveTime,
        cronExpression: nightlyArchiveCronExpression.trim() || null,
        useLlmScoring: nightlyArchiveUseLlmScoring,
      });
      const nextNightlySettings = {
        enabled: nextStatus?.settings.enabled ?? nightlyArchiveEnabled,
        time: nextStatus?.settings.time ?? nightlyArchiveTime,
        cronExpression: nextStatus?.settings.cronExpression ?? '',
        useLlmScoring: nextStatus?.settings.useLlmScoring ?? nightlyArchiveUseLlmScoring,
      };
      const diff = describeChangedFields(previousNightlySettings, nextNightlySettings);
      setNightlyArchiveStatus(nextStatus);
      setNightlyArchiveEnabled(nextStatus?.settings.enabled ?? nightlyArchiveEnabled);
      setNightlyArchiveTime(nextStatus?.settings.time ?? nightlyArchiveTime);
      setNightlyArchiveCronExpression(nextStatus?.settings.cronExpression ?? nightlyArchiveCronExpression);
      setNightlyArchiveUseLlmScoring(nextStatus?.settings.useLlmScoring ?? nightlyArchiveUseLlmScoring);
      setNightlyArchiveMessage({
        tone: 'success',
        message: '已保存夜间自动归档设置。',
      });
      void recordAuditLog({
        category: 'config',
        action: 'nightly_archive_saved',
        target: '.vortex/nightly-memory-archive-settings.json',
        status: 'success',
        summary: `Saved nightly archive settings: ${summarizeChangedKeys(diff.changedKeys)}.`,
        metadata: diff,
        createdAt: new Date().toISOString(),
      }).catch((error) => {
        console.warn('Failed to record nightly archive audit log:', error);
      });
      showDesktopNotification(
        'Vortex 夜间归档已更新',
        `${nextStatus?.settings.enabled ? '已启用' : '已关闭'} · ${formatNightlyArchiveSchedule(nextStatus?.settings)}`,
      );
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

  const handleNightlyArchiveRunNow = async () => {
    setNightlyArchiveLoading(true);
    try {
      const nextStatus = await runNightlyArchiveNow(draft.apiServer);
      setNightlyArchiveStatus(nextStatus);
      setNightlyArchiveEnabled(nextStatus?.settings.enabled ?? nightlyArchiveEnabled);
      setNightlyArchiveTime(nextStatus?.settings.time ?? nightlyArchiveTime);
      setNightlyArchiveCronExpression(nextStatus?.settings.cronExpression ?? nightlyArchiveCronExpression);
      setNightlyArchiveUseLlmScoring(nextStatus?.settings.useLlmScoring ?? nightlyArchiveUseLlmScoring);
      setNightlyArchiveMessage({
        tone: 'success',
        message: '已手动触发一次记忆归档自动化。',
      });
    } catch (error) {
      setNightlyArchiveMessage({
        tone: 'error',
        message: error instanceof Error ? error.message : '手动触发夜间归档失败。',
      });
    } finally {
      setNightlyArchiveLoading(false);
    }
  };

  const handleAutomationRun = async (automationId: string) => {
    setAutomationLoadingId(automationId);
    try {
      const payload =
        automationId === 'agent_task'
          ? {
              agentSlug: agentTaskDraft.agentSlug.trim(),
              instruction: agentTaskDraft.instruction.trim(),
            }
          : undefined;
      const nextStatus = await runAutomation(draft.apiServer, automationId, payload);
      if (isNightlyArchiveStatus(nextStatus)) {
        setNightlyArchiveStatus(nextStatus);
        setNightlyArchiveEnabled(nextStatus.settings.enabled);
        setNightlyArchiveTime(nextStatus.settings.time);
        setNightlyArchiveCronExpression(nextStatus.settings.cronExpression ?? '');
        setNightlyArchiveUseLlmScoring(nextStatus.settings.useLlmScoring);
      }
      setAutomationSnapshot(await getAutomationSnapshot(draft.apiServer));
      setAutomationMessage({
        tone: 'success',
        message: `已运行自动化：${automationId}`,
      });
      if (automationId === 'agent_task') {
        setAgentTaskDraft((current) => ({ ...current, instruction: '' }));
      }
    } catch (error) {
      setAutomationMessage({
        tone: 'error',
        message: error instanceof Error ? error.message : '运行自动化失败。',
      });
    } finally {
      setAutomationLoadingId(null);
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
      void recordAuditLog({
        category: 'config',
        action: 'workspace_restored',
        target: file.name,
        status: 'success',
        summary: `Restored workspace backup from ${file.name}.`,
        metadata: {
          fileName: file.name,
        },
        createdAt: new Date().toISOString(),
      }).catch((error) => {
        console.warn('Failed to record workspace restore audit log:', error);
      });
      onConfigSaved?.(normalizeAgentConfig(payload.config));
      window.location.reload();
    } catch (error: any) {
      setConfigSaveStatus({
        tone: 'error',
        message: `恢复失败: ${error.message}`,
      });
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
      kind: 'vortex-backup',
      exportedAt: new Date().toISOString(),
      config: draft,
      workspace: await exportWorkspaceData({ minimal: draft.data.minimalBackup }),
    };
    downloadJson(payload, `vortex-backup-${Date.now()}.json`);
  };

  const handleMarkdownExport = async () => {
    const payload = await exportWorkspaceData();
    downloadText(buildMarkdownExport(payload), `vortex-export-${Date.now()}.md`);
  };

  const handleClearExpired = () => {
    // TODO: Implement session cleanup
  };

  const handleAgentPackageExport = async () => {
    try {
      const agentSlug = agentPackageDraft.agentSlug.trim();
      const packageData = await exportAgentPackage(draft.apiServer, agentSlug);
      if (!packageData) {
        throw new Error('本地 API Server 未启用或无法导出 agent package。');
      }
      downloadJson(packageData, `${packageData.agentSlug}-${Date.now()}.vortex`);
      setAgentPackageStatus({
        tone: 'success',
        message: `已导出 ${packageData.agentSlug}：${packageData.memoryFiles.length} 个记忆文件，${packageData.skillFiles.length} 个 skill 文件。`,
      });
    } catch (error) {
      setAgentPackageStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : '导出 agent package 失败。',
      });
    }
  };

  const handleAgentPackageImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const packageData = JSON.parse(await readFileAsText(file)) as VortexPackage;
      const result = await importAgentPackage(draft.apiServer, packageData, {
        targetAgentSlug: agentPackageDraft.targetAgentSlug.trim() || undefined,
        importConfig: agentPackageDraft.importConfig,
      });
      if (!result) {
        throw new Error('本地 API Server 未启用或无法导入 agent package。');
      }
      setAgentPackageStatus({
        tone: 'success',
        message: `已导入 ${result.agentSlug}：${result.memoryFileCount} 个记忆文件，${result.skillFileCount} 个 skill 文件。`,
      });
      await onMemoryFilesChanged?.(agents.find((agent) => agent.slug === result.agentSlug)?.id ?? activeMemoryAgentId);
    } catch (error) {
      setAgentPackageStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : '导入 agent package 失败。',
      });
    } finally {
      event.target.value = '';
    }
  };

  const loadDocumentQualityScores = async () => {
    setDocumentQualityLoading(true);
    try {
      setDocumentQualityScores(await listDocumentQualityScores());
    } finally {
      setDocumentQualityLoading(false);
    }
  };

  const handleRefreshDocumentQualityScores = async () => {
    setDocumentQualityLoading(true);
    try {
      setDocumentQualityScores(await refreshDocumentQualityScores());
    } finally {
      setDocumentQualityLoading(false);
    }
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
                  className="h-9 w-full min-w-0 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-white outline-none transition-[background-color,color,border-color] focus:outline-none focus:ring-1 focus:ring-emerald-400/20"
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
                  className="h-9 w-full min-w-0 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-white outline-none transition-[background-color,color,border-color] focus:outline-none focus:ring-1 focus:ring-emerald-400/20"
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
              <SystemPromptEditor draft={draft} updateDraft={updateDraft} />
            </SectionCard>
          </div>
        );

      case 'general':
        return (
          <div className="space-y-4">
            <SectionCard title="语言与网络" description="用于控制工作区的基础行为与请求路径。" className="settings-card-full">
              <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-gray-900">语言</div>
                  <p className="mt-0.5 text-xs text-gray-500">选择界面显示语言</p>
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
                  className="h-[36px] w-[120px] rounded-[10px] border border-black/[0.12] bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#FF2D78]/40"
                >
                  {LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-gray-900">代理模式</div>
                  <p className="mt-0.5 text-xs text-gray-500">{PROXY_OPTIONS.find((option) => option.value === draft.general.proxyMode)?.description}</p>
                </div>
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
                  className="h-[36px] w-[120px] rounded-[10px] border border-black/[0.12] bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#FF2D78]/40"
                >
                  {PROXY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {draft.general.proxyMode === 'custom' ? (
                <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium text-gray-900">代理地址</div>
                  </div>
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
                    className="h-[36px] w-[300px] rounded-[10px] border border-black/[0.12] bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#FF2D78]/40"
                  />
                </div>
              ) : null}
            </SectionCard>

            <SectionCard title="Knowledge Base" description="知识库检索相关设置">
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
            </SectionCard>
          </div>
        );

      case 'display':
        return (
          <div className="space-y-4">
            <SectionCard
              title="主题模式"
              description="支持浅色 / 深色主题，并允许你定制整套工作区的主题色。"
              className="settings-card-full"
            >
              <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-gray-900">主题选择</div>
                  <p className="mt-0.5 text-xs text-gray-500">选择界面显示主题</p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {(['dark', 'light'] as const).map((option) => (
                    <button
                      key={option}
                      onClick={() =>
                        updateDraft((current) => ({
                          ...current,
                          theme: {
                            ...current.theme,
                            mode: option as AgentConfig['theme']['mode'],
                          },
                        }))
                      }
                      className={`settings-mode-button h-[36px] px-4 rounded-[10px] border text-sm transition-all ${
                        draft.theme.mode === option ? 'settings-mode-button-active' : ''
                      }`}
                    >
                      {option === 'dark' ? '深色' : '浅色'}
                    </button>
                  ))}
                </div>
              </div>
            </SectionCard>

            <SectionCard title="基础主题色" description="常用的 10 个基础色已经预置，切换后会立即影响品牌渐变与强调色。" className="settings-card-full">
              <div className="settings-color-row px-5">
                {THEME_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => updateThemeColor(preset.color)}
                    title={preset.name}
                    aria-label={`选择 ${preset.name} 主题色`}
                    className={`settings-theme-preset-button ${
                      draft.theme.accentColor.toLowerCase() === preset.color.toLowerCase()
                        ? 'settings-theme-preset-button-active'
                        : ''
                    }`}
                  >
                    <span className="settings-theme-swatch" style={{ backgroundColor: preset.color }} />
                  </button>
                ))}
                <label className="settings-custom-color-button" title="自定义颜色">
                  <input
                    type="color"
                    value={draft.theme.accentColor}
                    onChange={(event) => updateThemeColor(event.target.value)}
                    className="settings-custom-color-input"
                    aria-label="选择自定义主题色"
                  />
                  <span className="settings-custom-color-swatch" style={{ backgroundColor: draft.theme.accentColor }} />
                  <span>自定义</span>
                </label>
              </div>
            </SectionCard>

            <SectionCard title="界面行为" description="自定义聊天界面的显示方式。">
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
            </SectionCard>

            <SectionCard title="多列显示密度" description="调整多 lane 工作区的最小列宽。" className="settings-card-full">
              <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-gray-900">列宽</div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="settings-row-value text-[14px] font-medium tabular-nums">{draft.ui.laneMinWidth}px</div>
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
                    className="w-[120px] h-[6px] rounded-full appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, var(--app-accent) 0%, var(--app-accent) ${((draft.ui.laneMinWidth - 300) / (460 - 300)) * 100}%, var(--settings-range-track) ${((draft.ui.laneMinWidth - 300) / (460 - 300)) * 100}%, var(--settings-range-track) 100%)`,
                    }}
                  />
                </div>
              </div>
            </SectionCard>
          </div>
        );

      case 'data':
        return (
          <div className="space-y-4">
            <SectionCard
              title="数据处理"
              description="备份、恢复、清理和查看本地工作区数据。"
              className="settings-card-full settings-data-hub-card"
            >
              <div className="settings-data-metrics">
                {[
                  ['会话', stats?.conversations ?? 0],
                  ['消息', stats?.messages ?? 0],
                  ['知识文档', stats?.documents ?? 0],
                  ['记忆文档', stats?.memoryDocuments ?? 0],
                ].map(([label, value]) => (
                  <div key={label} className="settings-data-metric">
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <div className="settings-data-actions-grid">
                <div className="settings-data-action-tile">
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium text-gray-900">导出备份</div>
                    <p className="mt-0.5 text-xs text-gray-500">将所有数据导出为 JSON 文件</p>
                  </div>
                  <button
                    onClick={handleBackup}
                    className="settings-data-action-button h-[36px] px-4 rounded-[10px] border border-black/[0.12] bg-white text-sm text-gray-700 hover:bg-black/[0.02] transition-colors"
                  >
                    导出
                  </button>
                </div>
                <div className="settings-data-action-tile">
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium text-gray-900">导入恢复</div>
                    <p className="mt-0.5 text-xs text-gray-500">从 JSON 文件恢复数据</p>
                  </div>
                  <button
                    onClick={() => backupRestoreInputRef.current?.click()}
                    className="settings-data-action-button h-[36px] px-4 rounded-[10px] border border-black/[0.12] bg-white text-sm text-gray-700 hover:bg-black/[0.02] transition-colors"
                  >
                    导入
                  </button>
                </div>
                <div className="settings-data-action-tile">
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium text-gray-900">清理过期会话</div>
                    <p className="mt-0.5 text-xs text-gray-500">删除超过 30 天的会话记录</p>
                  </div>
                  <button
                    onClick={handleClearExpired}
                    className="settings-data-action-button settings-danger-button h-[36px] px-4 rounded-[10px] border border-red-200 bg-red-50 text-sm text-red-600 hover:bg-red-100 transition-colors"
                  >
                    清理
                  </button>
                </div>
              </div>
            </SectionCard>
          </div>
        );

      case 'mcp':
        return (
          <div className="space-y-4">
            <SectionCard title="MCP 服务器" description="内置模板 + 自定义服务器。">
              <div className="space-y-2 px-5 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">
                  内置与推荐
                </div>
                {MCP_LIBRARY.map((server) => (
                  <div
                    key={server.id}
                    className={`flex items-center justify-between gap-4 px-4 py-3 rounded-[10px] cursor-pointer transition-colors ${
                      activeMcpId === server.id
                        ? 'bg-[#FF2D78]/5 border border-[#FF2D78]/20'
                        : 'bg-white border border-black/[0.06] hover:bg-black/[0.02]'
                    }`}
                    onClick={() => setActiveMcpId(server.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-black/[0.06]">
                        <Server size={16} className="text-gray-500" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900">{server.name}</div>
                        <div className="mt-0.5 text-xs text-gray-500">{server.provider}</div>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        addMcpServer(server);
                      }}
                      className="h-[32px] px-3 rounded-lg border border-black/[0.12] bg-white text-xs text-gray-700 hover:bg-black/[0.02] transition-colors"
                    >
                      添加
                    </button>
                  </div>
                ))}
              </div>
              <div className="space-y-2 px-5 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">
                  我的服务器
                </div>
                {draft.mcpServers.map((server) => (
                  <div
                    key={server.id}
                    className={`flex items-center justify-between gap-4 px-4 py-3 rounded-[10px] cursor-pointer transition-colors ${
                      activeMcpId === server.id
                        ? 'bg-[#FF2D78]/5 border border-[#FF2D78]/20'
                        : 'bg-white border border-black/[0.06] hover:bg-black/[0.02]'
                    }`}
                    onClick={() => setActiveMcpId(server.id)}
                  >
                    <div>
                      <div className="text-sm font-medium text-gray-900">{server.name}</div>
                      <div className="mt-0.5 text-xs text-gray-500">{server.transport}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] ${
                          server.enabled
                            ? 'border-[#FF2D78]/30 bg-[#FF2D78]/10 text-[#FF2D78]'
                            : 'border-black/[0.12] text-gray-400'
                        }`}
                      >
                        {server.enabled ? 'ON' : 'OFF'}
                      </span>
                      {server.source === 'custom' && (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            await updateDraft((current) => ({
                              ...current,
                              mcpServers: current.mcpServers.filter((s) => s.id !== server.id),
                            }));
                            setActiveMcpId(draft.mcpServers[0]?.id ?? MCP_LIBRARY[0]!.id);
                          }}
                          className="h-[32px] px-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-500 hover:bg-red-100 transition-colors"
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>

            {activeMcpServer && (
              <SectionCard title={activeMcpServer.name} description="自定义 MCP 服务器配置会持久化到本地设置中。">
                <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium text-gray-900">启用</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={activeMcpServer.enabled}
                    onClick={() => updateMcpServer(activeMcpServer.id, { enabled: !activeMcpServer.enabled })}
                    className="settings-toggle-track relative inline-flex h-[28px] w-[52px] flex-shrink-0 cursor-pointer items-center rounded-full transition-all duration-200 focus:outline-none"
                    style={{ backgroundColor: activeMcpServer.enabled ? 'var(--app-accent)' : 'var(--settings-toggle-off)' }}
                  >
                    <span className="settings-toggle-thumb inline-block h-[24px] w-[24px] rounded-full bg-white shadow-sm mx-[2px] transition-transform duration-200" style={{ transform: activeMcpServer.enabled ? 'translateX(24px)' : 'translateX(0)' }} />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium text-gray-900">服务器名称</div>
                  </div>
                  <input
                    value={activeMcpServer.name}
                    onChange={(event) => updateMcpServer(activeMcpServer.id, { name: event.target.value })}
                    className="h-[36px] w-[200px] rounded-[10px] border border-black/[0.12] bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#FF2D78]/40"
                    placeholder="服务器名称"
                  />
                </div>
                <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium text-gray-900">传输协议</div>
                  </div>
                  <select
                    value={activeMcpServer.transport}
                    onChange={(event) =>
                      updateMcpServer(activeMcpServer.id, {
                        transport: event.target.value as McpServerConfig['transport'],
                      })
                    }
                    className="h-[36px] w-[180px] rounded-[10px] border border-black/[0.12] bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#FF2D78]/40"
                  >
                    <option value="streamable-http">streamable-http</option>
                    <option value="sse">sse</option>
                    <option value="stdio">stdio</option>
                  </select>
                </div>
                {activeMcpServer.transport === 'stdio' ? (
                  <>
                    <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                      <div className="min-w-0 flex-1">
                        <div className="text-[14px] font-medium text-gray-900">命令</div>
                      </div>
                      <input
                        value={activeMcpServer.command}
                        onChange={(event) =>
                          updateMcpServer(activeMcpServer.id, { command: event.target.value })
                        }
                        placeholder="npx"
                        className="h-[36px] w-[200px] rounded-[10px] border border-black/[0.12] bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#FF2D78]/40"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                      <div className="min-w-0 flex-1">
                        <div className="text-[14px] font-medium text-gray-900">参数</div>
                      </div>
                      <input
                        value={activeMcpServer.args}
                        onChange={(event) =>
                          updateMcpServer(activeMcpServer.id, { args: event.target.value })
                        }
                        placeholder="-y @modelcontextprotocol/server-filesystem ./"
                        className="h-[36px] w-[300px] rounded-[10px] border border-black/[0.12] bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#FF2D78]/40"
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-medium text-gray-900">URL</div>
                    </div>
                    <input
                      value={activeMcpServer.url}
                      onChange={(event) => updateMcpServer(activeMcpServer.id, { url: event.target.value })}
                      placeholder="https://mcp.example.com"
                      className="h-[36px] w-[300px] rounded-[10px] border border-black/[0.12] bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#FF2D78]/40"
                    />
                  </div>
                )}
              </SectionCard>
            )}
          </div>
        );

      case 'search':
        return (
          <div className="settings-card-full settings-split-settings">
            <aside className="settings-split-nav-card">
              <div className="settings-split-nav-header">
                <h3>搜索服务</h3>
                <p>选择 provider 后在右侧配置 API 与默认项。</p>
              </div>
              <div className="settings-split-nav-group">
                <div className="settings-split-nav-label">API 服务商</div>
                {draft.search.providers
                  .filter((provider) => provider.category === 'api')
                  .map((provider) => (
                    <button
                      key={provider.id}
                      type="button"
                      className={`settings-split-nav-item ${
                        activeSearchProviderId === provider.id ? 'settings-split-nav-item-active' : ''
                      }`}
                      onClick={() => setActiveSearchProviderId(provider.id)}
                    >
                      <span>
                        <strong>{provider.name}</strong>
                        <small>{provider.description}</small>
                      </span>
                      {draft.search.defaultProviderId === provider.id ? <em>默认</em> : null}
                    </button>
                  ))}
              </div>
              <div className="settings-split-nav-group">
                <div className="settings-split-nav-label">本地搜索</div>
                {draft.search.providers
                  .filter((provider) => provider.category === 'local')
                  .map((provider) => (
                    <button
                      key={provider.id}
                      type="button"
                      className={`settings-split-nav-item ${
                        activeSearchProviderId === provider.id ? 'settings-split-nav-item-active' : ''
                      }`}
                      onClick={() => setActiveSearchProviderId(provider.id)}
                    >
                      <span>
                        <strong>{provider.name}</strong>
                        <small>{provider.description}</small>
                      </span>
                      {draft.search.defaultProviderId === provider.id ? <em>默认</em> : null}
                    </button>
                  ))}
              </div>
              <div className="settings-split-nav-footer">
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
                  title="失败回退知识库"
                  description="provider 不可用时走本地文档检索。"
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
            </aside>

            <main className="settings-split-detail-card">
              {activeSearchProvider ? (
                <SectionCard title={activeSearchProvider.name} description={activeSearchProvider.description}>
                <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium text-gray-900">启用</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={activeSearchProvider.enabled}
                    onClick={() => updateSearchProvider(activeSearchProvider.id, { enabled: !activeSearchProvider.enabled })}
                    className="settings-toggle-track relative inline-flex h-[28px] w-[52px] flex-shrink-0 cursor-pointer items-center rounded-full transition-all duration-200 focus:outline-none"
                    style={{ backgroundColor: activeSearchProvider.enabled ? 'var(--app-accent)' : 'var(--settings-toggle-off)' }}
                  >
                    <span className="settings-toggle-thumb inline-block h-[24px] w-[24px] rounded-full bg-white shadow-sm mx-[2px] transition-transform duration-200" style={{ transform: activeSearchProvider.enabled ? 'translateX(24px)' : 'translateX(0)' }} />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium text-gray-900">设为默认</div>
                  </div>
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
                    className="h-[36px] px-4 rounded-[10px] border border-[#FF2D78]/30 bg-[#FF2D78]/10 text-sm text-[#FF2D78] hover:bg-[#FF2D78]/15 transition-colors"
                  >
                    设为默认
                  </button>
                </div>
                <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium text-gray-900">名称</div>
                  </div>
                  <input
                    value={activeSearchProvider.name}
                    onChange={(event) =>
                      updateSearchProvider(activeSearchProvider.id, { name: event.target.value })
                    }
                    placeholder="Provider Name"
                    className="h-[36px] w-[200px] rounded-[10px] border border-black/[0.12] bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#FF2D78]/40"
                  />
                </div>
                <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium text-gray-900">类型</div>
                  </div>
                  <select
                    value={activeSearchProvider.category}
                    onChange={(event) =>
                      updateSearchProvider(activeSearchProvider.id, {
                        category: event.target.value as SearchProviderConfig['category'],
                      })
                    }
                    className="h-[36px] w-[180px] rounded-[10px] border border-black/[0.12] bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#FF2D78]/40"
                  >
                    {SEARCH_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                {activeSearchProvider.category === 'api' && (
                  <>
                    <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                      <div className="min-w-0 flex-1">
                        <div className="text-[14px] font-medium text-gray-900">Base URL</div>
                      </div>
                      <input
                        value={activeSearchProvider.baseUrl || ''}
                        onChange={(event) =>
                          updateSearchProvider(activeSearchProvider.id, { baseUrl: event.target.value })
                        }
                        placeholder="https://api.example.com"
                        className="h-[36px] w-[300px] rounded-[10px] border border-black/[0.12] bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#FF2D78]/40"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                      <div className="min-w-0 flex-1">
                        <div className="text-[14px] font-medium text-gray-900">API Key</div>
                      </div>
                      <input
                        value={activeSearchProvider.apiKey}
                        onChange={(event) =>
                          updateSearchProvider(activeSearchProvider.id, { apiKey: event.target.value })
                        }
                        placeholder="API Key"
                        className="h-[36px] w-[300px] rounded-[10px] border border-black/[0.12] bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#FF2D78]/40"
                      />
                    </div>
                  </>
                )}
              </SectionCard>
              ) : (
                <SectionCard title="未选择搜索服务" description="请先在左侧选择一个 provider。">
                  <div className="px-5 py-5 text-sm text-gray-500">没有可编辑的搜索服务。</div>
                </SectionCard>
              )}
            </main>
          </div>
        );

      case 'memory':
        return (
          <div className="space-y-4">
            <SectionCard title="记忆设置" description="控制全局记忆的注入方式与上下文窗口。">
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
              <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-gray-900">上下文窗口</div>
                  <p className="mt-0.5 text-xs text-gray-500">每个 lane 最近保留的消息条数</p>
                </div>
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
                  className="h-[36px] w-[100px] rounded-[10px] border border-black/[0.12] bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#FF2D78]/40 tabular-nums"
                />
              </div>
              <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-gray-900">Session Summary</div>
                  <p className="mt-0.5 text-xs text-gray-500">LLM 失败时自动回退到规则摘要</p>
                </div>
                <select
                  value={draft.memory.sessionSummaryMode}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      memory: {
                        ...current.memory,
                        sessionSummaryMode: event.target.value === 'llm' ? 'llm' : 'deterministic',
                      },
                    }))
                  }
                  className="h-[36px] w-[120px] rounded-[10px] border border-black/[0.12] bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#FF2D78]/40"
                >
                  <option value="deterministic">规则摘要</option>
                  <option value="llm">LLM 摘要</option>
                </select>
              </div>
            </SectionCard>

            <SectionCard
              title="记忆生命周期"
              description="控制 daily 记忆进入 hot / warm / cold 的时间窗口。"
            >
              <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-gray-900">热层天数</div>
                  <p className="mt-0.5 text-xs text-gray-500">默认 2 天，保留原始 daily</p>
                </div>
                <input
                  type="number"
                  min={0}
                  value={draft.memory.hotRetentionDays}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      memory: {
                        ...current.memory,
                        hotRetentionDays: Number(event.target.value),
                      },
                    }))
                  }
                  className="h-[36px] w-[100px] rounded-[10px] border border-black/[0.12] bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#FF2D78]/40 tabular-nums"
                />
              </div>
              <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-gray-900">温层天数</div>
                  <p className="mt-0.5 text-xs text-gray-500">低于热层时会自动按热层对齐</p>
                </div>
                <input
                  type="number"
                  min={0}
                  value={draft.memory.warmRetentionDays}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      memory: {
                        ...current.memory,
                        warmRetentionDays: Number(event.target.value),
                      },
                    }))
                  }
                  className="h-[36px] w-[100px] rounded-[10px] border border-black/[0.12] bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#FF2D78]/40 tabular-nums"
                />
              </div>
              <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-gray-900">冷层保留天数</div>
                  <p className="mt-0.5 text-xs text-gray-500">0 表示不按年龄裁剪</p>
                </div>
                <input
                  type="number"
                  min={0}
                  value={draft.memory.coldRetentionDays}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      memory: {
                        ...current.memory,
                        coldRetentionDays: Number(event.target.value),
                      },
                    }))
                  }
                  className="h-[36px] w-[100px] rounded-[10px] border border-black/[0.12] bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#FF2D78]/40 tabular-nums"
                />
              </div>
              <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-gray-900">冷层最大文件</div>
                  <p className="mt-0.5 text-xs text-gray-500">0 表示不限制数量</p>
                </div>
                <input
                  type="number"
                  min={0}
                  value={draft.memory.coldMaxFiles}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      memory: {
                        ...current.memory,
                        coldMaxFiles: Number(event.target.value),
                      },
                    }))
                  }
                  className="h-[36px] w-[100px] rounded-[10px] border border-black/[0.12] bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#FF2D78]/40 tabular-nums"
                />
              </div>
            </SectionCard>
          </div>
        );

      case 'api':
        return (
          <div className="space-y-4">
            <SectionCard
              title="本地 API Server"
              description="开启后，前端会通过本地 API 直接读写项目里的记忆文件和夜间归档设置。"
            >
              <ToggleCard
                title="启用 API Server"
                description="前端通过本地 API 直接读写记忆文件。"
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
              <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-gray-900">Base URL</div>
                  <p className="mt-0.5 text-xs text-gray-500">本地 API 服务器地址</p>
                </div>
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
                  className="h-[36px] w-[250px] rounded-[10px] border border-black/[0.12] bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#FF2D78]/40"
                />
              </div>
              <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-gray-900">Auth Token</div>
                  <p className="mt-0.5 text-xs text-gray-500">API 认证令牌</p>
                </div>
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
                  className="h-[36px] w-[250px] rounded-[10px] border border-black/[0.12] bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#FF2D78]/40"
                />
              </div>
            </SectionCard>
          </div>
        );

      case 'docs':
        return (
          <div className="space-y-4">
            <SectionCard
              title="文档导入"
              description="把本地文档导入知识库，供搜索和记忆检索使用。"
              className="settings-card-full"
            >
              <div className="settings-docs-import-row">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium text-gray-900">导入文档</div>
                  <p className="mt-0.5 text-xs text-gray-500">支持选择多个文件，内容会写入本地 SQLite 文档库。</p>
                </div>
                <button
                  onClick={() => externalImportInputRef.current?.click()}
                  className="h-[36px] px-4 rounded-[10px] border border-black/[0.12] bg-white text-sm text-gray-700 hover:bg-black/[0.02] transition-colors"
                >
                  选择文件
                </button>
              </div>
            </SectionCard>

            <SectionCard
              title="文档质量"
              description="查看检索文档的完整度、引用和反馈情况。"
              className="settings-card-full"
              action={
                <button
                  onClick={handleRefreshDocumentQualityScores}
                  disabled={documentQualityLoading}
                  className="h-[36px] px-4 rounded-[10px] border border-black/[0.12] bg-white text-sm text-gray-700 hover:bg-black/[0.02] disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                >
                  {documentQualityLoading ? '刷新中' : '刷新'}
                </button>
              }
            >
              {documentQualityScores.length > 0 ? (
                <div className="settings-docs-quality-list">
                  {documentQualityScores.slice(0, 6).map((record) => (
                    <div key={record.documentId} className="settings-docs-quality-item">
                      <div className="min-w-0">
                        <div className="text-[14px] font-medium text-gray-900 truncate">
                          {record.title || record.documentId}
                        </div>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {record.sourceType || 'document'} · 引用 {record.citationCount} · 反馈 {record.helpfulCount}/{record.notHelpfulCount}
                        </p>
                      </div>
                      <div className="settings-docs-score">
                        <strong>{Math.round(record.score)}</strong>
                        <span>{record.recommendation === 'keep' ? '保留' : record.recommendation === 'review' ? '复查' : '归档'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="settings-docs-empty">
                  <FileText size={18} />
                  <span>{documentQualityLoading ? '正在读取文档质量...' : '暂无文档质量记录，导入文档后可在这里查看。'}</span>
                </div>
              )}
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
          <SectionCard title="快捷键参考" description="当前工作区保留的快捷键建议。">
            <div className="px-5 py-3">
              <div className="grid gap-2 md:grid-cols-2">
                {[
                  ['Enter', '发送消息'],
                  ['Shift + Enter', '输入换行'],
                  ['Cmd/Ctrl + K', '命令面板'],
                  ['Cmd/Ctrl + /', '快捷帮助'],
                ].map(([combo, label]) => (
                  <div key={combo} className="flex items-center justify-between rounded-[10px] border border-black/[0.06] bg-white px-4 py-3">
                    <span className="text-sm text-gray-700">{label}</span>
                    <kbd className="px-2 py-1 rounded-md border border-black/[0.12] bg-black/[0.03] text-xs font-mono text-gray-500">{combo}</kbd>
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>
        );

      case 'assistant':
        return (
          <div className="space-y-4">
            <SectionCard title="多 lane 扇出模式" description="控制多 agent lane 的执行方式。">
              <div className="flex items-center justify-between gap-4 px-5 h-[66px]">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-gray-900">执行模式</div>
                  <p className="mt-0.5 text-xs text-gray-500">Parallel 并行 / Sequential 顺序</p>
                </div>
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
                  className="h-[36px] w-[120px] rounded-[10px] border border-black/[0.12] bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#FF2D78]/40"
                >
                  <option value="parallel">Parallel</option>
                  <option value="sequential">Sequential</option>
                </select>
              </div>
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
            </SectionCard>
          </div>
        );

      default:
        return null;
    }
  };

  const activeCategoryMeta = CATEGORIES.find((category) => category.id === activeCategory);

  return (
    <div className="settings-workspace fixed inset-0 z-50 flex overflow-hidden bg-[var(--settings-workspace-bg)]">
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
      <input
        ref={agentPackageImportInputRef}
        type="file"
        accept=".vortex,application/json"
        className="hidden"
        onChange={handleAgentPackageImport}
      />

      <div className="settings-modal-frame flex h-full min-h-0 w-full overflow-hidden bg-[var(--settings-workspace-bg)]">
        <div className="settings-category-panel flex w-[320px] flex-col border-r border-black/[0.08] bg-[var(--settings-sidebar-bg)]">
          <div className="settings-window-controls flex h-8 items-center gap-2 px-4 pt-3">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          </div>
          <button
            onClick={onClose}
            className="settings-return-button mx-2 mt-3 flex h-9 items-center gap-2 rounded-lg px-2 text-[13px] text-[var(--settings-nav-muted)] transition-colors hover:bg-[var(--settings-nav-hover)] hover:text-[var(--settings-nav-text)]"
          >
            <span className="text-[17px] leading-none">‹</span>
            返回应用
          </button>

          <nav className="flex-1 overflow-y-auto px-2 py-3 custom-scrollbar">
            <div className="space-y-0.5">
              {CATEGORIES.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setActiveCategory(category.id)}
                  className={`settings-category-button flex h-[36px] w-full items-center gap-3 rounded-lg px-3 text-[14px] transition-colors ${
                      activeCategory === category.id
                        ? 'settings-category-button-active font-medium'
                        : 'settings-category-button-idle hover:bg-[var(--settings-nav-hover)]'
                  }`}
                >
                  <category.icon
                    size={16}
                    strokeWidth={1.8}
                    className={activeCategory === category.id ? 'settings-category-icon-active' : 'settings-category-icon-idle'}
                  />
                  {category.label}
                </button>
              ))}
            </div>
          </nav>
        </div>

        {activeCategory === 'models' ? (
          <>
            {/* Provider list panel (370px) */}
            <div className="settings-provider-panel flex w-[320px] flex-col border-r border-white/[0.06] bg-[var(--app-bg-modal-side)]">
              <div className="border-b border-white/[0.06] px-4 py-3">
                <div className="relative">
                  <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/25" />
                  <input
                    type="text"
                    placeholder="搜索模型平台..."
                    value={providerSearchQuery}
                    onChange={(event) => setProviderSearchQuery(event.target.value)}
                    className="w-full h-[48px] rounded-xl border border-white/[0.08] bg-white/[0.04] py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/[0.15]"
                  />
                </div>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-3 custom-scrollbar">
                {!filteredProviderGroups.groups.length ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 px-4 py-8 text-center text-sm text-white/40">
                    没有匹配的模型服务。
                  </div>
                ) : (
                  filteredProviderGroups.groups.map((group) => {
                    const collapsed = collapsedProviderProtocolGroups[group.id] ?? false;

                    return (
                      <div key={group.id} className="rounded-[22px] border border-white/5 bg-black/10 p-2">
                        <button
                          onClick={() =>
                            setCollapsedProviderProtocolGroups((current) => ({
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
                              <div
                                key={provider.id}
                                className={`group flex items-center gap-3 rounded-lg px-3 h-[58px] transition-colors cursor-pointer ${
                                  activeProviderId === provider.id
                                    ? 'bg-white/[0.08] text-white/90'
                                    : 'text-white/50 hover:bg-white/[0.04]'
                                }`}
                                onClick={() => setActiveProviderId(provider.id)}
                              >
                                <div className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
                                  <Cloud size={16} strokeWidth={1.5} className="text-white/50" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-[13px] font-medium">{provider.name}</div>
                                  <div className="text-[11px] text-white/30">{provider.models.length} models</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div
                                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${
                                      provider.enabled
                                        ? 'border-[#FF2D78]/30 bg-[#FF2D78]/10 text-[#FF2D78]'
                                        : 'border-white/10 text-white/35'
                                    }`}
                                  >
                                    {provider.enabled ? 'ON' : 'OFF'}
                                  </div>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      removeModelsFromProvider(activeProvider.id, [provider.models[0]]);
                                    }}
                                    className="rounded-full p-1 text-white/20 opacity-0 transition-colors group-hover:opacity-100 hover:bg-white/10 hover:text-white/60"
                                  >
                                    <Minus size={12} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
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

            <div className="settings-content-area settings-detail-panel relative flex flex-1 flex-col bg-[#1E1E1E]">
              <button
                onClick={onClose}
                className="absolute right-4 top-4 z-10 rounded-full p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={18} />
              </button>

              {activeProvider ? (
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {/* Cherry Studio: 56px header */}
                  <div className="settings-model-header sticky top-0 z-10 flex h-[56px] items-center justify-between gap-4 border-b border-white/[0.06] bg-[var(--app-bg-secondary)] px-5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] flex-shrink-0">
                        <Cloud size={16} strokeWidth={1.5} className="text-white/50" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-semibold text-white/90 truncate">{activeProvider.name}</span>
                          <span className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/40 flex-shrink-0">
                            {activeProvider.type}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <button
                        onClick={() =>
                          setConfirmProviderDelete({
                            providerId: activeProvider.id,
                            providerName: activeProvider.name,
                          })
                        }
                        className="rounded-lg p-1.5 text-white/35 transition-colors hover:bg-white/[0.06] hover:text-white/60"
                      >
                        <Minus size={14} />
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
                        <div className="h-[28px] w-[52px] rounded-full bg-white/[0.10] after:absolute after:left-[2px] after:top-[2px] after:h-[24px] after:w-[24px] after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:content-[''] peer-checked:bg-[#FF2D78] peer-checked:after:translate-x-[24px] transition-colors duration-200" />
                      </label>
                    </div>
                  </div>

                  <div className="settings-detail-scroll space-y-4 px-6 py-5">
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

                        <div className="rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-4 text-sm leading-6 text-white/62">
                          图搜图、文搜图、网页抓取、代码解释器、MCP 这些模型专属能力不是在 Settings 里全局开启。
                          它们是当前会话级开关，需要先把厂商建成 <span className="font-medium text-white">Responses</span> 协议，
                          再回到聊天页右上角的 <span className="font-medium text-white">模型功能</span> 面板里单独启用。
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
                              onClick={() => inspectProviderModels(activeProvider)}
                              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
                            >
                              模型检测
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
                            onClick={() => {
                              setAddModelDraft({
                                providerId: activeProvider.id,
                                value: activeProvider.models[0] ?? '',
                              });
                              setShowAddModelDialog(true);
                            }}
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

                        {Object.keys(activeProviderModelMetadata).length > 0 ? (
                          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2 text-[11px] text-white/55">
                            <span className="text-white/82">已缓存 {Object.keys(activeProviderModelMetadata).length}</span>
                            <span>/ {activeProvider.models.length} 个模型规格</span>
                            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5">
                              写入 model-metadata.json
                            </span>
                          </div>
                        ) : null}

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
                                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-transparent text-white/20 transition-[border-color,background-color,color,transform,opacity] duration-150 hover:scale-105 hover:border-red-500/30 hover:bg-red-500/12 hover:text-red-300"
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
                                                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-transparent text-white/20 transition-[border-color,background-color,color,transform,opacity] duration-150 hover:scale-105 hover:border-red-500/30 hover:bg-red-500/12 hover:text-red-300"
                                                title={`移除 ${series.label} 系列`}
                                              >
                                                <Minus size={13} />
                                              </button>
                                            </div>

                                            {!seriesCollapsed ? (
                                              <div className="mt-2 space-y-2">
                                                {series.models.map((model) => {
                                                  const metadata = activeProviderModelMetadata[model];
                                                  return (
                                                    <div
                                                      key={model}
                                                      className="group flex items-center justify-between rounded-xl border border-white/5 bg-white/5 px-3 py-2.5 transition-colors hover:bg-white/10"
                                                    >
                                                      <div className="min-w-0 flex-1">
                                                        <div className="flex min-w-0 items-center gap-3">
                                                          <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-400/20 to-red-500/20">
                                                            <Box size={10} className="text-orange-400" />
                                                          </div>
                                                          <span className="truncate text-sm text-white/90">{model}</span>
                                                        </div>
                                                        {metadata ? (
                                                          <div className="mt-1 flex flex-wrap gap-1.5 pl-8">
                                                            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] text-white/52">
                                                              上下文 {formatInspectorTokenValue(metadata.contextWindow)}
                                                            </span>
                                                            {metadata.maxOutputTokens ? (
                                                              <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] text-white/52">
                                                                输出 {formatInspectorTokenValue(metadata.maxOutputTokens)}
                                                              </span>
                                                            ) : null}
                                                          </div>
                                                        ) : null}
                                                      </div>
                                                      <div className="flex items-center gap-2">
                                                        <button
                                                          onClick={() =>
                                                            openModelDetailsDialog(activeProvider, model).catch(console.error)
                                                          }
                                                          className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] text-white/60 transition-[border-color,background-color,color] duration-150 hover:border-sky-400/30 hover:bg-sky-400/12 hover:text-sky-100"
                                                          title="查看模型设置"
                                                        >
                                                          模型设置
                                                        </button>
                                                        <button
                                                          onClick={() =>
                                                            removeModelsFromProvider(activeProvider.id, [model])
                                                          }
                                                          className="rounded-full border border-transparent p-1.5 text-white/25 opacity-0 transition-[border-color,background-color,color,transform,opacity] duration-150 hover:scale-105 hover:border-red-500/30 hover:bg-red-500/12 hover:text-red-300 group-hover:opacity-100"
                                                          title="移除模型"
                                                        >
                                                          <Minus size={12} />
                                                        </button>
                                                      </div>
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
                    </SectionCard>
                  </div>
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center text-white/40">请选择一个模型服务</div>
              )}
            </div>
          </>
        ) : (
          <div className="settings-content-area settings-detail-panel relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--settings-workspace-bg)]">
            <div className="settings-content-scroll flex-1 overflow-y-auto custom-scrollbar">
              <div className="settings-general-stack mx-auto w-full space-y-3">
                <h1 className="settings-page-title">{activeCategoryMeta?.label ?? '设置'}</h1>
                {configSaveStatus ? (
                  <div
                    className={`settings-status-banner ${
                      configSaveStatus.tone === 'error'
                        ? 'settings-status-banner-error'
                        : configSaveStatus.tone === 'success'
                          ? 'settings-status-banner-success'
                          : 'settings-status-banner-neutral'
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

      {modelDetailsDialog && modelDetailsProvider ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm">
          <div className="w-full max-w-[760px] rounded-[28px] border border-white/10 bg-[#171717] shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-white/5 px-6 py-5">
              <div>
                <div className="text-lg font-semibold text-white">模型设置</div>
                <div className="mt-1 text-sm text-white/45">
                  {modelDetailsDialog.model} · {modelDetailsProvider.name}
                </div>
              </div>
              <button
                onClick={() => {
                  setModelDetailsDialog(null);
                  setModelDetailsDraft(null);
                  setModelDetailsError('');
                }}
                className="rounded-full p-2 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-white/35">模型 ID</div>
                  <input
                    value={modelDetailsDialog.model}
                    readOnly
                    className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white/70 outline-none"
                  />
                </label>
                <label className="block">
                  <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-white/35">厂商</div>
                  <input
                    value={modelDetailsDraft?.providerName ?? modelDetailsProvider.name}
                    onChange={(event) =>
                      setModelDetailsDraft((current) => ({
                        ...(current ?? {}),
                        providerName: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[13px] leading-6 text-white outline-none transition-[border-color,background-color] focus:outline-none focus:ring-1 focus:ring-emerald-400/20"
                  />
                </label>
                <label className="block">
                  <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-white/35">版本</div>
                  <input
                    value={modelDetailsDraft?.versionLabel ?? ''}
                    onChange={(event) =>
                      setModelDetailsDraft((current) => ({
                        ...(current ?? {}),
                        versionLabel: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[13px] leading-6 text-white outline-none transition-[border-color,background-color] focus:outline-none focus:ring-1 focus:ring-emerald-400/20"
                  />
                </label>
                <label className="block">
                  <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-white/35">模式</div>
                  <input
                    value={modelDetailsDraft?.modeLabel ?? ''}
                    onChange={(event) =>
                      setModelDetailsDraft((current) => ({
                        ...(current ?? {}),
                        modeLabel: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[13px] leading-6 text-white outline-none transition-[border-color,background-color] focus:outline-none focus:ring-1 focus:ring-emerald-400/20"
                  />
                </label>
                <label className="block">
                  <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-white/35">上下文长度</div>
                  <input
                    value={modelDetailsDraft?.contextWindow ?? ''}
                    onChange={(event) =>
                      setModelDetailsDraft((current) => ({
                        ...(current ?? {}),
                        contextWindow: parseOptionalNumberInput(event.target.value),
                      }))
                    }
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[13px] leading-6 text-white outline-none transition-[border-color,background-color] focus:outline-none focus:ring-1 focus:ring-emerald-400/20"
                  />
                </label>
                <label className="block">
                  <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-white/35">最大输入</div>
                  <input
                    value={modelDetailsDraft?.maxInputTokens ?? ''}
                    onChange={(event) =>
                      setModelDetailsDraft((current) => ({
                        ...(current ?? {}),
                        maxInputTokens: parseOptionalNumberInput(event.target.value),
                      }))
                    }
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[13px] leading-6 text-white outline-none transition-[border-color,background-color] focus:outline-none focus:ring-1 focus:ring-emerald-400/20"
                  />
                </label>
                <label className="block">
                  <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-white/35">最大输入字符数</div>
                  <input
                    value={modelDetailsDraft?.maxInputCharacters ?? ''}
                    onChange={(event) =>
                      setModelDetailsDraft((current) => ({
                        ...(current ?? {}),
                        maxInputCharacters: parseOptionalNumberInput(event.target.value),
                      }))
                    }
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[13px] leading-6 text-white outline-none transition-[border-color,background-color] focus:outline-none focus:ring-1 focus:ring-emerald-400/20"
                  />
                </label>
                <label className="block">
                  <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-white/35">最长思维链</div>
                  <input
                    value={modelDetailsDraft?.longestReasoningTokens ?? ''}
                    onChange={(event) =>
                      setModelDetailsDraft((current) => ({
                        ...(current ?? {}),
                        longestReasoningTokens: parseOptionalNumberInput(event.target.value),
                      }))
                    }
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[13px] leading-6 text-white outline-none transition-[border-color,background-color] focus:outline-none focus:ring-1 focus:ring-emerald-400/20"
                  />
                </label>
                <label className="block">
                  <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-white/35">最大输出</div>
                  <input
                    value={modelDetailsDraft?.maxOutputTokens ?? ''}
                    onChange={(event) =>
                      setModelDetailsDraft((current) => ({
                        ...(current ?? {}),
                        maxOutputTokens: parseOptionalNumberInput(event.target.value),
                      }))
                    }
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[13px] leading-6 text-white outline-none transition-[border-color,background-color] focus:outline-none focus:ring-1 focus:ring-emerald-400/20"
                  />
                </label>
                <label className="block">
                  <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-white/35">输入价格</div>
                  <input
                    value={modelDetailsDraft?.inputCostPerMillion ?? ''}
                    onChange={(event) =>
                      setModelDetailsDraft((current) => ({
                        ...(current ?? {}),
                        inputCostPerMillion: parseOptionalNumberInput(event.target.value),
                      }))
                    }
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[13px] leading-6 text-white outline-none transition-[border-color,background-color] focus:outline-none focus:ring-1 focus:ring-emerald-400/20"
                  />
                </label>
                <label className="block">
                  <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-white/35">输出价格</div>
                  <input
                    value={modelDetailsDraft?.outputCostPerMillion ?? ''}
                    onChange={(event) =>
                      setModelDetailsDraft((current) => ({
                        ...(current ?? {}),
                        outputCostPerMillion: parseOptionalNumberInput(event.target.value),
                      }))
                    }
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[13px] leading-6 text-white outline-none transition-[border-color,background-color] focus:outline-none focus:ring-1 focus:ring-emerald-400/20"
                  />
                </label>
              </div>

              <label className="block">
                <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-white/35">计费备注</div>
                <textarea
                  rows={3}
                  value={modelDetailsDraft?.pricingNote ?? ''}
                  onChange={(event) =>
                    setModelDetailsDraft((current) => ({
                      ...(current ?? {}),
                      pricingNote: event.target.value,
                    }))
                  }
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm leading-6 text-white outline-none focus:border-emerald-500/40"
                />
              </label>

              {modelDetailsError ? (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-3 text-sm text-red-100/85">
                  {modelDetailsError}
                </div>
              ) : null}

              {modelDetailsDraft?.sources?.length ? (
                <div className="flex flex-wrap gap-2">
                  {modelDetailsDraft.sources.map((source) => (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      {source.label}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-white/5 px-6 py-4">
              <button
                onClick={() => handleResetModelDetails().catch(console.error)}
                disabled={modelDetailsLoading}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw size={14} />
                重置为默认
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setModelDetailsDialog(null);
                    setModelDetailsDraft(null);
                    setModelDetailsError('');
                  }}
                  className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white"
                >
                  取消
                </button>
                <button
                  onClick={() => handleSaveModelDetails().catch(console.error)}
                  disabled={modelDetailsSaving || modelDetailsLoading}
                  className="rounded-full border border-emerald-500/20 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {modelDetailsSaving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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
                              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-transparent text-emerald-300 transition-[border-color,background-color,color,transform] duration-150 hover:scale-105 hover:border-emerald-500/30 hover:bg-emerald-500/12 disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              <Plus size={14} />
                            </button>
                            <button
                              onClick={() => removeModelsFromImportDialog(groupModels)}
                              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-transparent text-white/20 transition-[border-color,background-color,color,transform] duration-150 hover:scale-105 hover:border-red-500/30 hover:bg-red-500/12 hover:text-red-300"
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
                                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-transparent text-emerald-300 transition-[border-color,background-color,color,transform] duration-150 hover:scale-105 hover:border-emerald-500/30 hover:bg-emerald-500/12 disabled:cursor-not-allowed disabled:opacity-30"
                                      >
                                        <Plus size={13} />
                                      </button>
                                      <button
                                        onClick={() => removeModelsFromImportDialog(series.models)}
                                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-transparent text-white/20 transition-[border-color,background-color,color,transform] duration-150 hover:scale-105 hover:border-red-500/30 hover:bg-red-500/12 hover:text-red-300"
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
                                                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-transparent text-emerald-300 transition-[border-color,background-color,color,transform] duration-150 hover:scale-105 hover:border-emerald-500/30 hover:bg-emerald-500/12 disabled:cursor-not-allowed disabled:opacity-30"
                                                title="添加当前模型"
                                              >
                                                <Plus size={12} />
                                              </button>
                                              <button
                                                onClick={() => removeModelsFromImportDialog([model])}
                                                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-transparent text-white/20 opacity-0 transition-[border-color,background-color,color,transform,opacity] duration-150 hover:scale-105 hover:border-red-500/30 hover:bg-red-500/12 hover:text-red-300 group-hover:opacity-100"
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

      {showAddModelDialog && addModelDraft ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm">
          <div className="w-full max-w-[560px] rounded-[28px] border border-white/10 bg-[#171717] shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-white/5 px-6 py-5">
              <div>
                <div className="text-lg font-semibold text-white">添加模型 ID</div>
                <div className="mt-1 text-sm text-white/45">手动补充当前厂商下的模型标识，适合接口未返回或你想预先录入的模型。</div>
              </div>
              <button
                onClick={() => setShowAddModelDialog(false)}
                className="rounded-full p-2 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/35">当前厂商</div>
                <div className="mt-2 text-sm text-white/85">
                  {draft.providers.find((provider) => provider.id === addModelDraft.providerId)?.name ?? '未知厂商'}
                </div>
              </div>
              <label className="block">
                <div className="mb-2 text-sm font-medium text-white/90">模型 ID</div>
                <input
                  type="text"
                  value={addModelDraft.value}
                  onChange={(event) =>
                    setAddModelDraft((current) =>
                      current
                        ? {
                            ...current,
                            value: event.target.value,
                          }
                        : current,
                    )
                  }
                  placeholder="例如：qwen-plus / gpt-5 / deepseek-chat"
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-emerald-500/40"
                />
              </label>
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-white/5 px-6 py-4">
              <div className="text-sm text-white/45">只会添加到当前厂商，不会改动其它分组顺序。</div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowAddModelDialog(false)}
                  className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white"
                >
                  取消
                </button>
                <button
                  onClick={() => addModelToProvider().catch(console.error)}
                  disabled={!addModelDraft.value.trim()}
                  className="rounded-full border border-emerald-500/20 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  添加模型
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {confirmProviderDelete ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm">
          <div className="w-full max-w-[520px] rounded-[28px] border border-white/10 bg-[#171717] shadow-2xl">
            <div className="border-b border-white/5 px-6 py-5">
              <div className="text-lg font-semibold text-white">删除模型厂商</div>
              <div className="mt-1 text-sm text-white/45">这会移除该厂商及其已保存的模型列表。</div>
            </div>
            <div className="px-6 py-5">
              <div className="rounded-[22px] border border-red-500/15 bg-red-500/10 px-4 py-4 text-sm leading-6 text-red-100/85">
                确认删除 <span className="font-medium text-white">{confirmProviderDelete.providerName}</span>？
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-white/5 px-6 py-4">
              <button
                onClick={() => setConfirmProviderDelete(null)}
                className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white"
              >
                取消
              </button>
              <button
                onClick={() => removeProvider(confirmProviderDelete.providerId).catch(console.error)}
                className="rounded-full border border-red-500/20 bg-red-500/15 px-4 py-2 text-sm font-medium text-red-100 transition-colors hover:bg-red-500/20"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmMemoryDelete ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm">
          <div className="w-full max-w-[520px] rounded-[28px] border border-white/10 bg-[#171717] shadow-2xl">
            <div className="border-b border-white/5 px-6 py-5">
              <div className="text-lg font-semibold text-white">删除记忆文件</div>
              <div className="mt-1 text-sm text-white/45">删除后会立即重扫当前 agent 的记忆索引。</div>
            </div>
            <div className="space-y-4 px-6 py-5">
              <div className="rounded-[22px] border border-red-500/15 bg-red-500/10 px-4 py-4 text-sm leading-6 text-red-100/85">
                确认删除 <span className="font-medium text-white">{confirmMemoryDelete.label}</span>？
              </div>
              <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-3 text-[12px] text-white/50">
                {confirmMemoryDelete.path}
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-white/5 px-6 py-4">
              <button
                onClick={() => setConfirmMemoryDelete(null)}
                className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white"
              >
                取消
              </button>
              <button
                onClick={() => removeActiveDailyFile().catch(console.error)}
                className="rounded-full border border-red-500/20 bg-red-500/15 px-4 py-2 text-sm font-medium text-red-100 transition-colors hover:bg-red-500/20"
              >
                删除文件
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
