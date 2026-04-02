import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { type AgentConfig, resolveModelSelection } from '../src/lib/agent/config';
import {
  buildRuleBasedPromotionDecision,
  normalizePromotionCategory,
} from '../src/lib/agent-memory-promotion';
import type { MemoryImportanceAssessment } from '../src/lib/agent-memory-lifecycle';

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

function normalizeConflictStatus(value: unknown) {
  const normalized = coerceString(value).toLowerCase();
  if (normalized === 'latest_consensus' || normalized === 'conflict_detected' || normalized === 'stable') {
    return normalized;
  }
  return 'stable' as const;
}

function normalizeAbstractionLevel(value: unknown) {
  const normalized = coerceString(value).toLowerCase();
  if (normalized === 'principle' || normalized === 'pattern' || normalized === 'concrete') {
    return normalized;
  }
  return 'concrete' as const;
}

function normalizeTransferability(value: unknown) {
  const normalized = coerceString(value).toLowerCase();
  if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
    return normalized;
  }
  return 'medium' as const;
}

function normalizeDimensionScore(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return clampImportanceScore(numeric);
  }
  return clampImportanceScore(fallback);
}

function computePromotionScore(input: {
  config: AgentConfig;
  dimensionScores: {
    compression: number;
    timeliness: number;
    connectivity: number;
    conflictResolution: number;
    abstraction: number;
    goldenLabel: number;
    transferability: number;
  };
}) {
  const weights = input.config.memory.scoringWeights;
  const weightedTotal =
    input.dimensionScores.compression * weights.compression +
    input.dimensionScores.timeliness * weights.timeliness +
    input.dimensionScores.connectivity * weights.connectivity +
    input.dimensionScores.conflictResolution * weights.conflictResolution +
    input.dimensionScores.abstraction * weights.abstraction +
    input.dimensionScores.goldenLabel * weights.goldenLabel +
    input.dimensionScores.transferability * weights.transferability;
  const totalWeight =
    weights.compression +
    weights.timeliness +
    weights.connectivity +
    weights.conflictResolution +
    weights.abstraction +
    weights.goldenLabel +
    weights.transferability;

  if (totalWeight <= 0) {
    return 3;
  }

  return Math.max(1, Math.min(5, Number((weightedTotal / totalWeight).toFixed(2))));
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

function normalizeAssessment(value: unknown, fallbackTier: 'warm' | 'cold', config: AgentConfig): MemoryImportanceAssessment {
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

  const importanceScore = clampImportanceScore(rawScore);
  const dimensionPayload = payload.dimensionScores as Record<string, unknown> | undefined;
  const rulePromotionDecision = buildRuleBasedPromotionDecision({
    sourceMarkdown: coerceString(payload.sourceMarkdown),
    importanceScore,
  });
  const dimensionScores = {
    compression: normalizeDimensionScore(dimensionPayload?.compression, importanceScore),
    timeliness: normalizeDimensionScore(dimensionPayload?.timeliness, importanceScore),
    connectivity: normalizeDimensionScore(dimensionPayload?.connectivity, importanceScore),
    conflictResolution: normalizeDimensionScore(dimensionPayload?.conflictResolution, importanceScore),
    abstraction: normalizeDimensionScore(dimensionPayload?.abstraction, importanceScore),
    goldenLabel: normalizeDimensionScore(dimensionPayload?.goldenLabel, importanceScore),
    transferability: normalizeDimensionScore(dimensionPayload?.transferability, importanceScore),
  };

  return {
    importanceScore,
    promotionScore: computePromotionScore({
      config,
      dimensionScores,
    }),
    dimensionScores,
    reason,
    suggestedRetention: normalizeRetentionSuggestion(
      payload.suggestedRetention ?? payload.retentionSuggestion,
      fallbackTier,
    ),
    promoteSignals: normalizePromoteSignals(payload.promoteSignals),
    promotionDecision: {
      shouldPromote:
        typeof payload.shouldPromote === 'boolean' ? payload.shouldPromote : rulePromotionDecision.shouldPromote,
      category:
        normalizePromotionCategory(
          coerceString(payload.promotionCategory ?? payload.category ?? payload.memoryCategory),
        ) ?? rulePromotionDecision.category,
      entry: coerceString(payload.promotionEntry ?? payload.memoryEntry) || rulePromotionDecision.entry,
    },
    validityHint: coerceString(payload.validityHint ?? payload.validityWindow ?? payload.expiryHint) || 'stable',
    conflictStatus: normalizeConflictStatus(payload.conflictStatus),
    knowledgeLinks: normalizePromoteSignals(payload.knowledgeLinks).slice(0, 8),
    abstractionLevel: normalizeAbstractionLevel(payload.abstractionLevel),
    transferability: normalizeTransferability(payload.transferability),
    goldenLabel: coerceString(payload.goldenLabel ?? payload.userFeedbackLabel),
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
  weights: AgentConfig['memory']['scoringWeights'];
}) {
  return [
    'Score the following daily memory candidate for archival importance.',
    'Return only a JSON object with these keys:',
    '{',
    '  "importanceScore": 1-5 integer,',
    '  "dimensionScores": {',
    '    "compression": 1-5,',
    '    "timeliness": 1-5,',
    '    "connectivity": 1-5,',
    '    "conflictResolution": 1-5,',
    '    "abstraction": 1-5,',
    '    "goldenLabel": 1-5,',
    '    "transferability": 1-5',
    '  },',
    '  "reason": "short explanation",',
    '  "suggestedRetention": "warm" or "cold",',
    '  "promoteSignals": ["string", "..."],',
    '  "shouldPromote": true or false,',
    '  "promotionCategory": "behavioral_patterns" | "workflow_improvements" | "tool_gotchas" | "durable_facts",',
    '  "promotionEntry": "short reusable memory entry",',
    '  "validityHint": "stable" | "time-sensitive" | "version-sensitive" | "dated note",',
    '  "conflictStatus": "stable" | "latest_consensus" | "conflict_detected",',
    '  "knowledgeLinks": ["related concept", "..."],',
    '  "abstractionLevel": "concrete" | "pattern" | "principle",',
    '  "transferability": "low" | "medium" | "high",',
    '  "goldenLabel": "validated / rejected / preferred / deprecated / empty"',
    '}',
    'Do not wrap the JSON in markdown fences. Do not add commentary.',
    'Score with these criteria in mind:',
    '- Compression ratio: remove filler and repeated attempts, keep only reusable knowledge.',
    '- Timeliness: note if this depends on versions, dates, or temporary state.',
    '- Connectivity: prefer memories that can connect to multiple existing knowledge points.',
    '- Conflict resolution: prefer the newest resolved consensus over stale conflicting notes.',
    '- Abstraction: reward highly abstract experience that captures a durable pattern or principle.',
    '- Golden labels: reward memories reinforced by explicit user feedback or validated outcomes.',
    '- Transferability: reward knowledge that can apply across multiple future tasks or contexts.',
    `Archive date: ${input.date}`,
    `Current tier: ${input.tier}`,
    `Selected provider: ${input.providerLabel}`,
    `Selected model: ${input.modelLabel}`,
    'Current weight profile:',
    `- compression=${input.weights.compression}`,
    `- timeliness=${input.weights.timeliness}`,
    `- connectivity=${input.weights.connectivity}`,
    `- conflictResolution=${input.weights.conflictResolution}`,
    `- abstraction=${input.weights.abstraction}`,
    `- goldenLabel=${input.weights.goldenLabel}`,
    `- transferability=${input.weights.transferability}`,
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
    weights: input.config.memory.scoringWeights,
  });

  const rawResponse = input.invokeModel ? await input.invokeModel(prompt) : await invokeMemoryScoringModel({ config: input.config, prompt });
  const parsed =
    parseScorerJson(
      typeof rawResponse === 'string' ? rawResponse : JSON.stringify(rawResponse),
    ) as Record<string, unknown>;
  parsed.sourceMarkdown = input.sourceMarkdown;
  return normalizeAssessment(parsed, input.tier, input.config);
}
