import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { type AgentConfig, resolveModelSelection } from '../src/lib/agent/config';

export interface MemoryImportanceAssessment {
  importanceScore: number;
  reason: string;
  suggestedRetention: 'warm' | 'cold';
  promoteSignals: string[];
  source: 'llm';
}

export interface ScoreMemoryImportanceInput {
  config: AgentConfig;
  date: string;
  tier: 'warm' | 'cold';
  sourceMarkdown: string;
  invokeModel?: (prompt: string) => Promise<string>;
}

const SCORER_SYSTEM_PROMPT =
  'You score daily memory candidates for archival importance. Return only strict JSON and nothing else.';

function clampImportanceScore(value: number) {
  if (!Number.isFinite(value)) {
    throw new Error('Memory scorer returned an invalid importanceScore.');
  }
  return Math.min(5, Math.max(1, Math.round(value)));
}

function coerceString(value: unknown) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function normalizePromoteSignals(value: unknown) {
  const rawSignals =
    Array.isArray(value) ? value : typeof value === 'string' && value.trim() ? value.split(/[\r\n,]+/) : [];

  return [...new Set(rawSignals.map((signal) => coerceString(signal)).filter(Boolean))].slice(0, 12);
}

function normalizeRetentionSuggestion(value: unknown, fallback: 'warm' | 'cold') {
  const normalized = coerceString(value).toLowerCase();
  if (normalized === 'warm' || normalized === 'cold') {
    return normalized;
  }
  return fallback;
}

function extractJsonCandidate(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  const braceSlice = firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1).trim() : '';

  return [trimmed, fenced, braceSlice].filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
}

function parseScorerJson(raw: string) {
  const candidates = extractJsonCandidate(raw);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(`Memory scorer returned invalid JSON: ${raw.trim().slice(0, 300)}`);
}

function normalizeAssessment(value: unknown, fallbackTier: 'warm' | 'cold'): MemoryImportanceAssessment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Memory scorer returned a non-object JSON payload.');
  }

  const payload = value as Record<string, unknown>;
  const rawScore = Number(payload.importanceScore ?? payload.score);
  if (!Number.isFinite(rawScore)) {
    throw new Error('Memory scorer response is missing a valid importanceScore.');
  }

  const reason = coerceString(payload.reason ?? payload.importanceReason);
  if (!reason) {
    throw new Error('Memory scorer response is missing a reason.');
  }

  return {
    importanceScore: clampImportanceScore(rawScore),
    reason,
    suggestedRetention: normalizeRetentionSuggestion(
      payload.suggestedRetention ?? payload.retentionSuggestion,
      fallbackTier,
    ),
    promoteSignals: normalizePromoteSignals(payload.promoteSignals),
    source: 'llm',
  };
}

function extractMessageText(response: unknown) {
  if (typeof response === 'string') {
    return response;
  }

  if (response && typeof response === 'object') {
    const content = (response as { content?: unknown }).content;
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map((chunk) => {
          if (typeof chunk === 'string') {
            return chunk;
          }
          if (chunk && typeof chunk === 'object') {
            const text = (chunk as { text?: unknown }).text;
            if (typeof text === 'string') {
              return text;
            }
            const chunkContent = (chunk as { content?: unknown }).content;
            if (typeof chunkContent === 'string') {
              return chunkContent;
            }
          }
          return '';
        })
        .join('')
        .trim();
    }
  }

  return '';
}

function buildScoringPrompt(input: {
  date: string;
  tier: 'warm' | 'cold';
  sourceMarkdown: string;
  providerLabel: string;
  modelLabel: string;
}) {
  return [
    'Score the following daily memory candidate for archival importance.',
    'Return only a JSON object with these keys:',
    '{',
    '  "importanceScore": 1-5 integer,',
    '  "reason": "short explanation",',
    '  "suggestedRetention": "warm" or "cold",',
    '  "promoteSignals": ["string", "..."]',
    '}',
    'Do not wrap the JSON in markdown fences. Do not add commentary.',
    `Archive date: ${input.date}`,
    `Current tier: ${input.tier}`,
    `Selected provider: ${input.providerLabel}`,
    `Selected model: ${input.modelLabel}`,
    'Source markdown:',
    '<<<SOURCE',
    input.sourceMarkdown.trim(),
    'SOURCE>>>',
  ].join('\n');
}

async function invokeMemoryScoringModel(input: {
  config: AgentConfig;
  prompt: string;
}) {
  const { provider, model: resolvedModel } = resolveModelSelection(input.config);
  if (!resolvedModel) {
    throw new Error(`No model is configured for provider ${provider.name}.`);
  }

  if (provider.type === 'openai' || provider.type === 'custom_openai') {
    if (!provider.apiKey) {
      throw new Error(`${provider.name} API key is missing. Please configure it in Settings.`);
    }

    const llm = new ChatOpenAI({
      apiKey: provider.apiKey,
      modelName: resolvedModel,
      temperature: 0,
      configuration: provider.baseUrl ? { baseURL: provider.baseUrl } : undefined,
    });
    const response = await llm.invoke([new SystemMessage(SCORER_SYSTEM_PROMPT), new HumanMessage(input.prompt)]);
    return extractMessageText(response);
  }

  if (provider.type === 'anthropic') {
    if (!provider.apiKey) {
      throw new Error(`${provider.name} API key is missing. Please configure it in Settings.`);
    }

    const llm = new ChatAnthropic({
      apiKey: provider.apiKey,
      modelName: resolvedModel,
      temperature: 0,
      clientOptions: provider.baseUrl ? { baseURL: provider.baseUrl } : undefined,
    });
    const response = await llm.invoke([new SystemMessage(SCORER_SYSTEM_PROMPT), new HumanMessage(input.prompt)]);
    return extractMessageText(response);
  }

  throw new Error(`Unsupported provider type: ${provider.type}`);
}

export async function scoreMemoryImportanceWithModel(
  input: ScoreMemoryImportanceInput,
): Promise<MemoryImportanceAssessment> {
  const { provider, model: resolvedModel } = resolveModelSelection(input.config);
  if (!resolvedModel) {
    throw new Error(`No model is configured for provider ${provider.name}.`);
  }

  const prompt = buildScoringPrompt({
    date: input.date,
    tier: input.tier,
    sourceMarkdown: input.sourceMarkdown,
    providerLabel: `${provider.id} (${provider.type})`,
    modelLabel: resolvedModel,
  });

  const rawResponse = input.invokeModel ? await input.invokeModel(prompt) : await invokeMemoryScoringModel({ config: input.config, prompt });
  const parsed = parseScorerJson(rawResponse);
  return normalizeAssessment(parsed, input.tier);
}
