import type { ModelProvider } from './agent/config';

export interface ModelSeriesGroup {
  id: string;
  label: string;
  models: string[];
}

export interface ModelGroup {
  id: string;
  label: string;
  totalCount: number;
  series: ModelSeriesGroup[];
}

export interface ProviderGroup {
  id: string;
  label: string;
  description: string;
  totalCount: number;
  providers: ModelProvider[];
}

export const MODEL_FAMILY_DEFINITIONS = [
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

function normalizeModelGroupKey(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

export function getProviderProtocolMeta(provider: Pick<ModelProvider, 'protocol'>) {
  switch (provider.protocol) {
    case 'openai_responses_compatible':
      return {
        id: 'responses',
        label: 'Responses',
        description: '走 /responses，适合 Qwen 内置工具、MCP 与更完整的工具编排。',
      };
    case 'anthropic_native':
      return {
        id: 'anthropic',
        label: 'Anthropic',
        description: '走 Anthropic Messages 原生协议。',
      };
    case 'openai_chat_compatible':
    default:
      return {
        id: 'chat',
        label: 'OpenAI Compatible',
        description: '走 /chat/completions，适合常规兼容 OpenAI 的模型服务。',
      };
  }
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

export function classifyModelFamily(provider: ModelProvider, model: string) {
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

export function buildModelGroups(provider: ModelProvider, query: string) {
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

export function buildProviderGroups(providers: ModelProvider[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredProviders = providers.filter((provider) => {
    if (!normalizedQuery) {
      return true;
    }
    const protocolMeta = getProviderProtocolMeta(provider);
    return (
      provider.name.toLowerCase().includes(normalizedQuery) ||
      protocolMeta.label.toLowerCase().includes(normalizedQuery) ||
      protocolMeta.description.toLowerCase().includes(normalizedQuery)
    );
  });

  const grouped = new Map<
    string,
    {
      label: string;
      description: string;
      providers: ModelProvider[];
    }
  >();

  filteredProviders.forEach((provider) => {
    const protocolMeta = getProviderProtocolMeta(provider);
    const bucket = grouped.get(protocolMeta.id) ?? {
      label: protocolMeta.label,
      description: protocolMeta.description,
      providers: [],
    };
    bucket.providers.push(provider);
    grouped.set(protocolMeta.id, bucket);
  });

  const orderedIds = ['chat', 'responses', 'anthropic'];
  const groups = [...grouped.entries()]
    .map<ProviderGroup>(([id, entry]) => ({
      id,
      label: entry.label,
      description: entry.description,
      totalCount: entry.providers.length,
      providers: entry.providers,
    }))
    .sort((left, right) => {
      const leftRank = orderedIds.indexOf(left.id);
      const rightRank = orderedIds.indexOf(right.id);
      return (leftRank === -1 ? Number.MAX_SAFE_INTEGER : leftRank) -
        (rightRank === -1 ? Number.MAX_SAFE_INTEGER : rightRank);
    });

  return {
    totalCount: filteredProviders.length,
    groups,
  };
}
