import localforage from 'localforage';
import { DEFAULT_API_SERVER_BASE_URL, getProjectConfig, saveProjectConfig } from '../agent-memory-api';
import {
  type ProviderProtocol,
  getDefaultProviderProtocol,
} from '../provider-compatibility';
import type { KnowledgeDocumentSourceType } from '../knowledge-document-model';

export type ProviderType = 'openai' | 'anthropic' | 'custom_openai';
export type ProxyMode = 'direct' | 'system' | 'custom';
export type ThemeMode = 'dark' | 'light';
export type SearchProviderType =
  | 'zhipu'
  | 'tavily'
  | 'searxng'
  | 'exa'
  | 'bing'
  | 'google'
  | 'baidu'
  | 'bocha'
  | 'custom';
export type SearchProviderCategory = 'api' | 'local';
export type McpTransport = 'streamable-http' | 'sse' | 'stdio';
export type McpSource = 'builtin' | 'marketplace' | 'custom';

export interface ModelProvider {
  id: string;
  name: string;
  enabled: boolean;
  apiKey: string;
  baseUrl?: string;
  models: string[];
  type: ProviderType;
  protocol: ProviderProtocol;
}

export interface GeneralSettings {
  language: string;
  proxyMode: ProxyMode;
  proxyUrl: string;
}

export interface ThemeSettings {
  mode: ThemeMode;
  accentColor: string;
  accentPresetId: string;
}

export interface UiPreferences {
  autoScroll: boolean;
  showTimestamps: boolean;
  showToolResults: boolean;
  compactLanes: boolean;
  laneMinWidth: number;
}

export interface SearchProviderConfig {
  id: string;
  name: string;
  type: SearchProviderType;
  enabled: boolean;
  category: SearchProviderCategory;
  description: string;
  baseUrl?: string;
  apiKey: string;
  homepage?: string;
}

export interface SearchWeights {
  lexicalWeight: number;
  vectorWeight: number;
  graphWeight: number;
  sourceTypeWeights: Partial<Record<KnowledgeDocumentSourceType, number>>;
}

export interface SearchSettings {
  enableKnowledgeBase: boolean;
  enableWebSearch: boolean;
  maxKnowledgeResults: number;
  defaultProviderId: string;
  fallbackToKnowledgeBase: boolean;
  weights: SearchWeights;
  providers: SearchProviderConfig[];
}

export interface MemorySettings {
  autoTitleFromFirstMessage: boolean;
  historyWindow: number;
  keepAssistantContext: boolean;
  enableSessionMemory: boolean;
  enableAgentSharedShortTerm: boolean;
  agentSharedShortTermWindowDays: number;
  enableAgentLongTerm: boolean;
  includeGlobalMemory: boolean;
  includeRecentMemorySnapshot: boolean;
  promotionScoreThreshold: number;
  scoringWeights: {
    compression: number;
    timeliness: number;
    connectivity: number;
    conflictResolution: number;
    abstraction: number;
    goldenLabel: number;
    transferability: number;
  };
}

export interface SandboxSettings {
  autoBoot: boolean;
  preferredRuntime: 'node' | 'bash';
  persistFiles: boolean;
}

export interface AssistantSettings {
  fanoutMode: 'parallel' | 'sequential';
  allowLaneModelOverride: boolean;
}

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  description: string;
  enabled: boolean;
  transport: McpTransport;
  command: string;
  args: string;
  headers: string;
  source: McpSource;
  provider: string;
  homepage?: string;
}

export interface ApiServerSettings {
  enabled: boolean;
  baseUrl: string;
  authToken: string;
}

export interface DocumentProcessingSettings {
  maxSearchResults: number;
  maxDocumentPreviewLength: number;
  enableVectorSearch: boolean;
  embeddingModel: string;
  embeddingBaseUrl: string;
  embeddingApiKey: string;
  embeddingDimensions: number;
}

export interface DataSettings {
  minimalBackup: boolean;
}

export interface AgentConfig {
  activeProviderId: string;
  activeModel: string;
  providers: ModelProvider[];
  systemPrompt: string;
  general: GeneralSettings;
  theme: ThemeSettings;
  ui: UiPreferences;
  search: SearchSettings;
  memory: MemorySettings;
  sandbox: SandboxSettings;
  assistant: AssistantSettings;
  mcpServers: McpServerConfig[];
  apiServer: ApiServerSettings;
  documents: DocumentProcessingSettings;
  data: DataSettings;
}

interface ConfigMigrationDependencies {
  bootstrapSettings?: ApiServerSettings;
  defaultConfig?: AgentConfig;
  readLegacyConfig?: () => Promise<AgentConfig | null>;
  clearLegacyConfig?: () => Promise<void>;
  readHostConfig?: (settings: ApiServerSettings) => Promise<AgentConfig | null>;
  writeHostConfig?: (settings: ApiServerSettings, value: AgentConfig) => Promise<AgentConfig | null>;
}

interface EmbeddingEnvironmentDefaults {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  dimensions?: number;
}

const DEFAULT_PROVIDERS: ModelProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    enabled: true,
    apiKey: '',
    models: ['gpt-4o', 'gpt-4.1-mini', 'gpt-4-turbo'],
    type: 'openai',
    protocol: 'openai_chat_compatible',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    enabled: true,
    apiKey: '',
    models: ['claude-3-7-sonnet-latest', 'claude-3-5-sonnet-latest'],
    type: 'anthropic',
    protocol: 'anthropic_native',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek (深度求索)',
    enabled: true,
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-coder'],
    type: 'custom_openai',
    protocol: 'openai_chat_compatible',
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow (硅基流动)',
    enabled: true,
    apiKey: '',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['Qwen/Qwen2.5-72B-Instruct', 'THUDM/glm-4-9b-chat'],
    type: 'custom_openai',
    protocol: 'openai_chat_compatible',
  },
];

const DEFAULT_SEARCH_PROVIDERS: SearchProviderConfig[] = [
  {
    id: 'search_zhipu',
    name: 'Zhipu',
    type: 'zhipu',
    enabled: false,
    category: 'api',
    description: '适合中文语境下的联网检索与工具调用。',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: '',
    homepage: 'https://open.bigmodel.cn/',
  },
  {
    id: 'search_tavily',
    name: 'Tavily',
    type: 'tavily',
    enabled: true,
    category: 'api',
    description: '开发者常用的 AI 搜索 API，适合研究与问答场景。',
    baseUrl: 'https://api.tavily.com',
    apiKey: '',
    homepage: 'https://tavily.com/',
  },
  {
    id: 'search_searxng',
    name: 'Searxng',
    type: 'searxng',
    enabled: false,
    category: 'api',
    description: '可自托管的聚合搜索引擎，适合私有化部署。',
    baseUrl: 'http://localhost:8080',
    apiKey: '',
    homepage: 'https://docs.searxng.org/',
  },
  {
    id: 'search_exa',
    name: 'Exa',
    type: 'exa',
    enabled: false,
    category: 'api',
    description: '偏向高质量网页与研究资料的语义搜索。',
    baseUrl: 'https://api.exa.ai',
    apiKey: '',
    homepage: 'https://exa.ai/',
  },
  {
    id: 'search_bocha',
    name: 'Bocha',
    type: 'bocha',
    enabled: false,
    category: 'api',
    description: '面向中文检索的搜索服务预留位。',
    baseUrl: '',
    apiKey: '',
    homepage: 'https://bochaai.com/',
  },
  {
    id: 'search_bing',
    name: 'Bing',
    type: 'bing',
    enabled: false,
    category: 'local',
    description: '使用 Bing 的本地偏好配置作为搜索入口。',
    baseUrl: 'https://www.bing.com',
    apiKey: '',
    homepage: 'https://www.bing.com/account/general',
  },
  {
    id: 'search_google',
    name: 'Google',
    type: 'google',
    enabled: false,
    category: 'local',
    description: '使用 Google 作为本地搜索偏好入口。',
    baseUrl: 'https://www.google.com',
    apiKey: '',
    homepage: 'https://www.google.com/preferences',
  },
  {
    id: 'search_baidu',
    name: 'Baidu',
    type: 'baidu',
    enabled: false,
    category: 'local',
    description: '面向中文网页的本地搜索入口。',
    baseUrl: 'https://www.baidu.com',
    apiKey: '',
    homepage: 'https://www.baidu.com',
  },
];

const DEFAULT_MCP_SERVERS: McpServerConfig[] = [
  {
    id: 'mcp_local_docs',
    name: 'Local Docs',
    url: 'local://docs',
    description: 'Reserved slot for local documentation sources.',
    enabled: false,
    transport: 'streamable-http',
    command: '',
    args: '',
    headers: '',
    source: 'builtin',
    provider: 'FlowAgent',
  },
];

export const DEFAULT_CONFIG: AgentConfig = {
  activeProviderId: 'openai',
  activeModel: 'gpt-4o',
  providers: DEFAULT_PROVIDERS,
  systemPrompt:
    'You are FlowAgent, a helpful AI assistant running in the browser. You have access to a local SQLite database for RAG, multiple assistant lanes, and a WebContainer sandbox for executing code. Use tools when they materially improve the answer.',
  general: {
    language: 'zh-CN',
    proxyMode: 'direct',
    proxyUrl: '',
  },
  theme: {
    mode: 'dark',
    accentColor: '#4f7cff',
    accentPresetId: 'ocean',
  },
  ui: {
    autoScroll: true,
    showTimestamps: true,
    showToolResults: true,
    compactLanes: false,
    laneMinWidth: 360,
  },
  search: {
    enableKnowledgeBase: true,
    enableWebSearch: false,
    maxKnowledgeResults: 5,
    defaultProviderId: 'search_tavily',
    fallbackToKnowledgeBase: true,
    weights: {
      lexicalWeight: 0.45,
      vectorWeight: 0.55,
      graphWeight: 0.12,
      sourceTypeWeights: {
        skill_doc: 1,
        workspace_doc: 1,
        user_upload: 1,
        system_note: 1,
      },
    },
    providers: DEFAULT_SEARCH_PROVIDERS,
  },
  memory: {
    autoTitleFromFirstMessage: true,
    historyWindow: 18,
    keepAssistantContext: true,
    enableSessionMemory: true,
    enableAgentSharedShortTerm: false,
    agentSharedShortTermWindowDays: 3,
    enableAgentLongTerm: true,
    includeGlobalMemory: true,
    includeRecentMemorySnapshot: true,
    promotionScoreThreshold: 4,
    scoringWeights: {
      compression: 0.8,
      timeliness: 0.9,
      connectivity: 0.9,
      conflictResolution: 1,
      abstraction: 1.1,
      goldenLabel: 1.2,
      transferability: 1.1,
    },
  },
  sandbox: {
    autoBoot: false,
    preferredRuntime: 'node',
    persistFiles: true,
  },
  assistant: {
    fanoutMode: 'parallel',
    allowLaneModelOverride: true,
  },
  mcpServers: DEFAULT_MCP_SERVERS,
  apiServer: {
    enabled: false,
    baseUrl: 'http://127.0.0.1:3850',
    authToken: '',
  },
  documents: {
    maxSearchResults: 5,
    maxDocumentPreviewLength: 240,
    enableVectorSearch: false,
    embeddingModel: 'text-embedding-v4',
    embeddingBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    embeddingApiKey: '',
    embeddingDimensions: 1024,
  },
  data: {
    minimalBackup: false,
  },
};

function readEnvString(key: string): string | undefined {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const value = env?.[key]?.trim();
  return value ? value : undefined;
}

function readEnvInteger(key: string): number | undefined {
  const value = readEnvString(key);
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readEmbeddingEnvironmentDefaults(): EmbeddingEnvironmentDefaults {
  return {
    apiKey: readEnvString('VITE_EMBEDDING_API_KEY'),
    model: readEnvString('VITE_EMBEDDING_MODEL'),
    baseUrl: readEnvString('VITE_EMBEDDING_BASE_URL'),
    dimensions: readEnvInteger('VITE_EMBEDDING_DIMENSIONS'),
  };
}

const LEGACY_CONFIG_KEY = 'agent_config_v3';
let lastKnownConfigApiSettings: ApiServerSettings = {
  enabled: true,
  baseUrl: DEFAULT_API_SERVER_BASE_URL,
  authToken: '',
};

function normalizeConfigBridgeSettings(value?: Partial<ApiServerSettings> | null): ApiServerSettings {
  return {
    enabled: true,
    baseUrl: value?.baseUrl?.trim() || DEFAULT_API_SERVER_BASE_URL,
    authToken: value?.authToken ?? '',
  };
}

function syncLastKnownConfigApiSettings(config: AgentConfig) {
  lastKnownConfigApiSettings = normalizeConfigBridgeSettings(config.apiServer);
}

function isDefaultConfig(config: AgentConfig) {
  return JSON.stringify(normalizeAgentConfig(config)) === JSON.stringify(normalizeAgentConfig(DEFAULT_CONFIG));
}

async function readLegacyAgentConfig() {
  const config = await localforage.getItem<AgentConfig>(LEGACY_CONFIG_KEY);
  return config ? normalizeAgentConfig(config) : null;
}

async function clearLegacyAgentConfig() {
  await localforage.removeItem(LEGACY_CONFIG_KEY);
}

export async function loadConfigWithMigration(
  dependencies: ConfigMigrationDependencies = {},
): Promise<AgentConfig> {
  const defaultConfig = normalizeAgentConfig(dependencies.defaultConfig ?? DEFAULT_CONFIG);
  const readLegacyConfig = dependencies.readLegacyConfig ?? readLegacyAgentConfig;
  const clearLegacyConfig = dependencies.clearLegacyConfig ?? clearLegacyAgentConfig;
  const readHostConfig = dependencies.readHostConfig ?? getProjectConfig;
  const writeHostConfig = dependencies.writeHostConfig ?? saveProjectConfig;
  const bootstrapSettings = normalizeConfigBridgeSettings(
    dependencies.bootstrapSettings ?? lastKnownConfigApiSettings,
  );
  const legacyConfig = await readLegacyConfig();

  try {
    const hostConfig = await readHostConfig(bootstrapSettings);
    if (!hostConfig) {
      const created = normalizeAgentConfig((await writeHostConfig(bootstrapSettings, legacyConfig ?? defaultConfig)) ?? (legacyConfig ?? defaultConfig));
      syncLastKnownConfigApiSettings(created);
      if (legacyConfig) {
        await clearLegacyConfig();
      }
      return created;
    }

    const normalizedHostConfig = normalizeAgentConfig(hostConfig);
    if (legacyConfig && isDefaultConfig(normalizedHostConfig)) {
      const migrated = normalizeAgentConfig((await writeHostConfig(bootstrapSettings, legacyConfig)) ?? legacyConfig);
      syncLastKnownConfigApiSettings(migrated);
      await clearLegacyConfig();
      return migrated;
    }

    syncLastKnownConfigApiSettings(normalizedHostConfig);
    if (legacyConfig) {
      await clearLegacyConfig();
    }
    return normalizedHostConfig;
  } catch (error) {
    if (legacyConfig) {
      syncLastKnownConfigApiSettings(legacyConfig);
      return legacyConfig;
    }
    console.warn('Failed to load file-backed config, falling back to defaults:', error);
    syncLastKnownConfigApiSettings(defaultConfig);
    return defaultConfig;
  }
}

export function resolveDocumentProcessingSettings(
  value?: Partial<DocumentProcessingSettings>,
  envDefaults: EmbeddingEnvironmentDefaults = readEmbeddingEnvironmentDefaults(),
): DocumentProcessingSettings {
  const merged: DocumentProcessingSettings = {
    ...DEFAULT_CONFIG.documents,
    ...(value ?? {}),
  };

  return {
    ...merged,
    embeddingApiKey: merged.embeddingApiKey.trim() || envDefaults.apiKey || '',
    embeddingModel: merged.embeddingModel.trim() || envDefaults.model || DEFAULT_CONFIG.documents.embeddingModel,
    embeddingBaseUrl:
      merged.embeddingBaseUrl.trim() || envDefaults.baseUrl || DEFAULT_CONFIG.documents.embeddingBaseUrl,
    embeddingDimensions:
      merged.embeddingDimensions || envDefaults.dimensions || DEFAULT_CONFIG.documents.embeddingDimensions,
  };
}

function normalizeStringArray(values?: string[]) {
  return values?.filter((value): value is string => Boolean(value && value.trim())) ?? [];
}

function mergeProvider(defaultProvider: ModelProvider, provider?: Partial<ModelProvider>): ModelProvider {
  return {
    ...defaultProvider,
    ...provider,
    protocol: provider?.protocol ?? inferProviderProtocol(provider, defaultProvider.protocol),
    models: normalizeStringArray(provider?.models).length
      ? normalizeStringArray(provider?.models)
      : defaultProvider.models,
  };
}

function inferProviderProtocol(
  provider: Partial<Pick<ModelProvider, 'id' | 'name' | 'protocol' | 'baseUrl' | 'type'>> | undefined,
  fallback: ProviderProtocol,
): ProviderProtocol {
  if (provider?.protocol) {
    return provider.protocol;
  }

  const normalizedIdentity = `${provider?.id ?? ''} ${provider?.name ?? ''}`.toLowerCase();
  if (/\bresponses\b/.test(normalizedIdentity)) {
    return 'openai_responses_compatible';
  }
  if (/\bchat\b/.test(normalizedIdentity)) {
    return 'openai_chat_compatible';
  }

  const normalizedBaseUrl = provider?.baseUrl?.trim().replace(/\/+$/, '').toLowerCase() ?? '';
  if (normalizedBaseUrl.includes('/api/v2/apps/protocols/compatible-mode/v1')) {
    return 'openai_responses_compatible';
  }
  if ((provider?.type ?? 'custom_openai') === 'anthropic') {
    return 'anthropic_native';
  }
  return fallback;
}

function normalizeProviders(rawProviders?: Partial<ModelProvider>[]): ModelProvider[] {
  const providerMap = new Map(DEFAULT_PROVIDERS.map((provider) => [provider.id, provider]));
  const customProviders: ModelProvider[] = [];

  (rawProviders ?? []).forEach((provider) => {
    if (!provider?.id) {
      return;
    }

    const base = providerMap.get(provider.id);
    if (base) {
      providerMap.set(provider.id, mergeProvider(base, provider));
      return;
    }

    customProviders.push({
      id: provider.id,
      name: provider.name ?? provider.id,
      enabled: provider.enabled ?? true,
      apiKey: provider.apiKey ?? '',
      baseUrl: provider.baseUrl,
      models: normalizeStringArray(provider.models),
      type: provider.type ?? 'custom_openai',
      protocol: inferProviderProtocol(
        provider,
        getDefaultProviderProtocol(provider.type ?? 'custom_openai'),
      ),
    });
  });

  return [...providerMap.values(), ...customProviders];
}

function mergeSearchProvider(
  defaultProvider: SearchProviderConfig,
  provider?: Partial<SearchProviderConfig>,
): SearchProviderConfig {
  return {
    ...defaultProvider,
    ...provider,
    apiKey: provider?.apiKey ?? defaultProvider.apiKey,
  };
}

function normalizeSearchProviders(rawProviders?: Partial<SearchProviderConfig>[]): SearchProviderConfig[] {
  const providerMap = new Map(DEFAULT_SEARCH_PROVIDERS.map((provider) => [provider.id, provider]));
  const customProviders: SearchProviderConfig[] = [];

  (rawProviders ?? []).forEach((provider, index) => {
    if (!provider) {
      return;
    }

    const id = provider.id || `search_custom_${index}`;
    const existing = providerMap.get(id);
    if (existing) {
      providerMap.set(id, mergeSearchProvider(existing, provider));
      return;
    }

    customProviders.push({
      id,
      name: provider.name ?? `Custom Search ${index + 1}`,
      type: provider.type ?? 'custom',
      enabled: provider.enabled ?? false,
      category: provider.category ?? 'api',
      description: provider.description ?? '',
      baseUrl: provider.baseUrl ?? '',
      apiKey: provider.apiKey ?? '',
      homepage: provider.homepage,
    });
  });

  return [...providerMap.values(), ...customProviders];
}

function normalizePositiveWeight(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function normalizeSearchWeights(value?: Partial<SearchWeights> | null): SearchWeights {
  return {
    lexicalWeight: normalizePositiveWeight(value?.lexicalWeight, DEFAULT_CONFIG.search.weights.lexicalWeight),
    vectorWeight: normalizePositiveWeight(value?.vectorWeight, DEFAULT_CONFIG.search.weights.vectorWeight),
    graphWeight: normalizePositiveWeight(value?.graphWeight, DEFAULT_CONFIG.search.weights.graphWeight),
    sourceTypeWeights: {
      skill_doc: normalizePositiveWeight(
        value?.sourceTypeWeights?.skill_doc,
        DEFAULT_CONFIG.search.weights.sourceTypeWeights.skill_doc,
      ),
      workspace_doc: normalizePositiveWeight(
        value?.sourceTypeWeights?.workspace_doc,
        DEFAULT_CONFIG.search.weights.sourceTypeWeights.workspace_doc,
      ),
      user_upload: normalizePositiveWeight(
        value?.sourceTypeWeights?.user_upload,
        DEFAULT_CONFIG.search.weights.sourceTypeWeights.user_upload,
      ),
      system_note: normalizePositiveWeight(
        value?.sourceTypeWeights?.system_note,
        DEFAULT_CONFIG.search.weights.sourceTypeWeights.system_note,
      ),
    },
  };
}

function normalizeMcpServers(rawServers?: Partial<McpServerConfig>[]): McpServerConfig[] {
  if (!rawServers?.length) {
    return DEFAULT_MCP_SERVERS;
  }

  return rawServers.map((server, index) => ({
    id: server.id || `mcp_${index}`,
    name: server.name || `MCP ${index + 1}`,
    url: server.url || '',
    description: server.description || '',
    enabled: server.enabled ?? false,
    transport: server.transport ?? 'streamable-http',
    command: server.command ?? '',
    args: server.args ?? '',
    headers: server.headers ?? '',
    source: server.source ?? 'custom',
    provider: server.provider ?? 'Custom',
    homepage: server.homepage,
  }));
}

function ensureActiveSelection(config: AgentConfig): AgentConfig {
  const enabledProviders = config.providers.filter((provider) => provider.enabled);
  const activeProvider =
    config.providers.find((provider) => provider.id === config.activeProviderId && provider.enabled) ??
    enabledProviders[0] ??
    config.providers[0];

  if (!activeProvider) {
    return config;
  }

  const activeModel = activeProvider.models.includes(config.activeModel)
    ? config.activeModel
    : activeProvider.models[0] ?? '';

  const searchProviders = config.search.providers;
  const enabledSearchProviders = searchProviders.filter((provider) => provider.enabled);
  const defaultSearchProvider =
    searchProviders.find((provider) => provider.id === config.search.defaultProviderId) ??
    enabledSearchProviders[0] ??
    searchProviders[0];

  return {
    ...config,
    activeProviderId: activeProvider.id,
    activeModel,
    search: {
      ...config.search,
      defaultProviderId: defaultSearchProvider?.id ?? '',
    },
  };
}

export function normalizeAgentConfig(value?: Partial<AgentConfig> | null): AgentConfig {
  const merged: AgentConfig = {
    ...DEFAULT_CONFIG,
    ...value,
    providers: normalizeProviders(value?.providers),
    general: {
      ...DEFAULT_CONFIG.general,
      ...(value?.general ?? {}),
    },
    theme: {
      ...DEFAULT_CONFIG.theme,
      ...(value?.theme ?? {}),
    },
    ui: {
      ...DEFAULT_CONFIG.ui,
      ...(value?.ui ?? {}),
    },
    search: {
      ...DEFAULT_CONFIG.search,
      ...(value?.search ?? {}),
      weights: normalizeSearchWeights(value?.search?.weights),
      providers: normalizeSearchProviders(value?.search?.providers),
    },
    memory: {
      ...DEFAULT_CONFIG.memory,
      ...(value?.memory ?? {}),
      scoringWeights: {
        ...DEFAULT_CONFIG.memory.scoringWeights,
        ...(value?.memory?.scoringWeights ?? {}),
      },
    },
    sandbox: {
      ...DEFAULT_CONFIG.sandbox,
      ...(value?.sandbox ?? {}),
    },
    assistant: {
      ...DEFAULT_CONFIG.assistant,
      ...(value?.assistant ?? {}),
    },
    mcpServers: normalizeMcpServers(value?.mcpServers),
    apiServer: {
      ...DEFAULT_CONFIG.apiServer,
      ...(value?.apiServer ?? {}),
    },
    documents: resolveDocumentProcessingSettings(value?.documents),
    data: {
      ...DEFAULT_CONFIG.data,
      ...(value?.data ?? {}),
    },
  };

  return ensureActiveSelection(merged);
}

export function getEnabledProviders(config: AgentConfig) {
  return config.providers.filter((provider) => provider.enabled);
}

function findEnabledProviderByModel(config: AgentConfig, model?: string | null) {
  if (!model) {
    return null;
  }

  return getEnabledProviders(config).find((provider) => provider.models.includes(model)) ?? null;
}

export function resolveModelSelection(config: AgentConfig, providerId?: string, model?: string) {
  const enabledProviders = getEnabledProviders(config);

  const explicitProvider =
    config.providers.find((provider) => provider.id === providerId && provider.enabled) ?? null;
  const inferredProviderFromModel = findEnabledProviderByModel(config, model);
  const activeProvider =
    config.providers.find((provider) => provider.id === config.activeProviderId && provider.enabled) ?? null;
  const inferredProviderFromActiveModel = findEnabledProviderByModel(config, config.activeModel);

  const selectedProvider =
    (explicitProvider && (!model || explicitProvider.models.includes(model)) ? explicitProvider : null) ??
    inferredProviderFromModel ??
    activeProvider ??
    inferredProviderFromActiveModel ??
    enabledProviders[0] ??
    config.providers[0];

  if (!selectedProvider) {
    throw new Error('No model providers are configured.');
  }

  const selectedModel =
    (model && selectedProvider.models.includes(model) ? model : null) ??
    (selectedProvider.models.includes(config.activeModel) ? config.activeModel : null) ??
    selectedProvider.models[0];

  return {
    provider: selectedProvider,
    model: selectedModel,
  };
}

export async function getAgentConfig(): Promise<AgentConfig> {
  return loadConfigWithMigration();
}

export async function saveAgentConfig(config: AgentConfig): Promise<void> {
  const normalized = normalizeAgentConfig(config);
  const saved = await saveProjectConfig(lastKnownConfigApiSettings, normalized);
  if (!saved) {
    throw new Error('The local API server is unavailable, so config.json could not be updated.');
  }
  syncLastKnownConfigApiSettings(normalized);
  await clearLegacyAgentConfig().catch(() => undefined);
}
