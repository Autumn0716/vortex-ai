import { serializeMemoryMarkdown } from './agent-memory-files';
import {
  buildRuleBasedPromotionDecision,
  type MemoryPromotionDecision,
} from './agent-memory-promotion';
import {
  extractMemoryContentLines,
  extractMemoryKeywords,
  extractOpenMemoryTasksFromLines,
  scoreMemoryImportance,
  summarizeMemoryLines,
  resolveMemoryTier,
} from './agent-memory-model';

export type MemoryLifecycleTier = 'hot' | 'warm' | 'cold';

export interface MemoryImportanceAssessment {
  importanceScore: number;
  promotionScore: number;
  dimensionScores: {
    compression: number;
    timeliness: number;
    connectivity: number;
    conflictResolution: number;
    abstraction: number;
    goldenLabel: number;
    transferability: number;
  };
  reason: string;
  suggestedRetention: 'warm' | 'cold';
  promoteSignals: string[];
  promotionDecision: MemoryPromotionDecision;
  validityHint: string;
  conflictStatus: 'stable' | 'latest_consensus' | 'conflict_detected';
  knowledgeLinks: string[];
  abstractionLevel: 'concrete' | 'pattern' | 'principle';
  transferability: 'low' | 'medium' | 'high';
  goldenLabel: string;
  source: 'llm' | 'rules';
}

const DAILY_LINE_LIMIT = 5;
const WARM_SUMMARY_LINE_LIMIT = 4;
const COLD_SUMMARY_LINE_LIMIT = 1;
const COLD_KEYWORD_LIMIT = 6;

function stripDailyLineNoise(line: string) {
  return line
    .replace(/^\s*-\s*/, '')
    .replace(/^\[(\d{2}:\d{2})\]\s*/, '[$1] ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactBulletList(items: string[]) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- None';
}

function clampImportanceScore(value: number) {
  return Math.max(1, Math.min(5, Math.round(value)));
}

function extractPromoteSignals(sourceMarkdown: string) {
  const normalized = sourceMarkdown.toLowerCase();
  const signals: string[] = [];

  if (/(偏好|preference|默认|always|总是)/i.test(normalized)) {
    signals.push('preference');
  }
  if (/(重要决策|decision|方案|project state|项目状态)/i.test(normalized)) {
    signals.push('decision');
  }
  if (/(核心身份|身份|role|owner|负责人)/i.test(normalized)) {
    signals.push('identity');
  }

  return Array.from(new Set(signals));
}

export function buildRuleBasedMemoryAssessment(input: {
  tier: 'warm' | 'cold';
  sourceMarkdown: string;
}): MemoryImportanceAssessment {
  const importanceScore = clampImportanceScore(scoreMemoryImportance(input.sourceMarkdown, 'conversation_log'));
  const dimensionScores = {
    compression: importanceScore,
    timeliness: /(\d{4}-\d{2}-\d{2}|版本|version|today|yesterday|上个月|去年)/i.test(input.sourceMarkdown) ? 4 : 3,
    connectivity: extractMemoryKeywords(input.sourceMarkdown, 4).length >= 2 ? 4 : 3,
    conflictResolution: /(最新|current|最终|共识|resolved|已确认)/i.test(input.sourceMarkdown)
      ? 5
      : /(冲突|conflict|不一致|矛盾)/i.test(input.sourceMarkdown)
        ? 2
        : 3,
    abstraction: /(原则|pattern|模式|workflow|工作流|最好|避免|总是|原则)/i.test(input.sourceMarkdown) ? 4 : 3,
    goldenLabel: /(\bcorrect\b|已验证|proved|有效|works|通过验证)/i.test(input.sourceMarkdown) ? 5 : 2,
    transferability: /(workflow|工作流|pattern|模式|tool|工具|流程|步骤)/i.test(input.sourceMarkdown) ? 5 : 3,
  };
  return {
    importanceScore,
    promotionScore: importanceScore,
    dimensionScores,
    reason: 'Fallback deterministic score from source content heuristics.',
    suggestedRetention: input.tier,
    promoteSignals: extractPromoteSignals(input.sourceMarkdown),
    promotionDecision: buildRuleBasedPromotionDecision({
      sourceMarkdown: input.sourceMarkdown,
      importanceScore,
    }),
    validityHint: /(\d{4}-\d{2}-\d{2}|版本|version|today|yesterday|上个月|去年)/i.test(input.sourceMarkdown)
      ? 'time-sensitive'
      : 'stable',
    conflictStatus: /(最新|current|最终|共识|resolved|已确认)/i.test(input.sourceMarkdown)
      ? 'latest_consensus'
      : /(冲突|conflict|不一致|矛盾)/i.test(input.sourceMarkdown)
        ? 'conflict_detected'
        : 'stable',
    knowledgeLinks: extractMemoryKeywords(input.sourceMarkdown, 4),
    abstractionLevel: /(原则|pattern|模式|workflow|工作流|最好|避免|总是|原则)/i.test(input.sourceMarkdown)
      ? 'pattern'
      : 'concrete',
    transferability: /(workflow|工作流|pattern|模式|tool|工具|流程|步骤)/i.test(input.sourceMarkdown) ? 'high' : 'medium',
    goldenLabel: /(\bcorrect\b|已验证|proved|有效|works|通过验证)/i.test(input.sourceMarkdown) ? 'validated' : '',
    source: 'rules',
  };
}

function collectSignificantDailyLines(sourceMarkdown: string) {
  const sourceLines = extractMemoryContentLines(sourceMarkdown).map(stripDailyLineNoise);
  const ranked = sourceLines
    .map((line, index) => {
      const importanceScore = scoreMemoryImportance(line, 'conversation_log');
      const isOpenLoop = /(todo|待办|阻塞|deadline|due|follow-up|follow up|未完成|待处理|下一步|next step)/i.test(line);
      const earlyLineBonus = index < 3 ? 1 : 0;

      return {
        line,
        index,
        score: importanceScore + (isOpenLoop ? 2 : 0) + earlyLineBonus,
      };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const selectedIndices = new Set<number>();
  const selectedLines: string[] = [];

  ranked.forEach(({ line, index }) => {
    if (selectedLines.length >= DAILY_LINE_LIMIT || selectedIndices.has(index)) {
      return;
    }
    selectedIndices.add(index);
    selectedLines.push(line);
  });

  return sourceLines
    .map((line, index) => ({ line, index }))
    .filter(({ index }) => selectedIndices.has(index))
    .map(({ line }) => line);
}

function buildOpenLoopLines(date: string, sourceMarkdown: string, limit: number) {
  return extractOpenMemoryTasksFromLines(extractMemoryContentLines(sourceMarkdown), {
    title: `${date} Daily Memory`,
    limit,
  });
}

function buildIndexLines(sourceLines: string[], date: string) {
  return sourceLines.slice(0, 4).map((line, index) => `${date}#${index + 1}: ${line.slice(0, 96)}`);
}

export function resolveLifecycleTier(date: string, now = new Date().toISOString()): MemoryLifecycleTier {
  const endOfDateIso = `${date}T23:59:59.999Z`;
  return resolveMemoryTier(endOfDateIso, now);
}

export function buildWarmMemorySurrogate(input: {
  date: string;
  sourcePath: string;
  sourceMarkdown: string;
  now?: string;
  assessment?: MemoryImportanceAssessment;
}) {
  const now = input.now ?? new Date().toISOString();
  const significantLines = collectSignificantDailyLines(input.sourceMarkdown);
  const openLoops = buildOpenLoopLines(input.date, input.sourceMarkdown, 4);
  const keywords = extractMemoryKeywords(significantLines.join('\n'), 8);
  const assessment = input.assessment ?? buildRuleBasedMemoryAssessment({
    tier: 'warm',
    sourceMarkdown: input.sourceMarkdown,
  });

  return serializeMemoryMarkdown({
    frontmatter: {
      title: `${input.date} Warm Memory`,
      date: input.date,
      dimensionAbstraction: assessment.dimensionScores.abstraction,
      dimensionCompression: assessment.dimensionScores.compression,
      dimensionConflictResolution: assessment.dimensionScores.conflictResolution,
      dimensionConnectivity: assessment.dimensionScores.connectivity,
      dimensionGoldenLabel: assessment.dimensionScores.goldenLabel,
      dimensionTimeliness: assessment.dimensionScores.timeliness,
      dimensionTransferability: assessment.dimensionScores.transferability,
      tier: 'warm',
      sourcePath: input.sourcePath,
      updatedAt: now,
      importance: clampImportanceScore(assessment.importanceScore),
      importanceReason: assessment.reason,
      importanceSource: assessment.source,
      abstractionLevel: assessment.abstractionLevel,
      conflictStatus: assessment.conflictStatus,
      goldenLabel: assessment.goldenLabel,
      knowledgeLinks: assessment.knowledgeLinks.join(', '),
      promotionCategory: assessment.promotionDecision.category ?? '',
      promotionEntry: assessment.promotionDecision.entry,
      promotionScore: assessment.promotionScore,
      shouldPromote: assessment.promotionDecision.shouldPromote,
      retentionSuggestion: assessment.suggestedRetention,
      promoteSignals: assessment.promoteSignals.join(', '),
      transferability: assessment.transferability,
      validityHint: assessment.validityHint,
      keywords: keywords.join(', '),
    },
    body: [
      '## Summary',
      summarizeMemoryLines(significantLines, WARM_SUMMARY_LINE_LIMIT),
      '',
      '## Key Fragments',
      compactBulletList(significantLines.slice(0, WARM_SUMMARY_LINE_LIMIT)),
      '',
      '## Open Loops',
      compactBulletList(openLoops),
      '',
      '## Keywords',
      compactBulletList(keywords),
    ].join('\n'),
  });
}

export function buildColdMemorySurrogate(input: {
  date: string;
  sourcePath: string;
  sourceMarkdown: string;
  now?: string;
  assessment?: MemoryImportanceAssessment;
}) {
  const now = input.now ?? new Date().toISOString();
  const significantLines = collectSignificantDailyLines(input.sourceMarkdown);
  const keywords = extractMemoryKeywords(significantLines.join('\n'), COLD_KEYWORD_LIMIT);
  const assessment = input.assessment ?? buildRuleBasedMemoryAssessment({
    tier: 'cold',
    sourceMarkdown: input.sourceMarkdown,
  });

  return serializeMemoryMarkdown({
    frontmatter: {
      title: `${input.date} Cold Memory`,
      date: input.date,
      dimensionAbstraction: assessment.dimensionScores.abstraction,
      dimensionCompression: assessment.dimensionScores.compression,
      dimensionConflictResolution: assessment.dimensionScores.conflictResolution,
      dimensionConnectivity: assessment.dimensionScores.connectivity,
      dimensionGoldenLabel: assessment.dimensionScores.goldenLabel,
      dimensionTimeliness: assessment.dimensionScores.timeliness,
      dimensionTransferability: assessment.dimensionScores.transferability,
      tier: 'cold',
      sourcePath: input.sourcePath,
      updatedAt: now,
      importance: clampImportanceScore(assessment.importanceScore),
      importanceReason: assessment.reason,
      importanceSource: assessment.source,
      abstractionLevel: assessment.abstractionLevel,
      conflictStatus: assessment.conflictStatus,
      goldenLabel: assessment.goldenLabel,
      knowledgeLinks: assessment.knowledgeLinks.join(', '),
      promotionCategory: assessment.promotionDecision.category ?? '',
      promotionEntry: assessment.promotionDecision.entry,
      promotionScore: assessment.promotionScore,
      shouldPromote: assessment.promotionDecision.shouldPromote,
      retentionSuggestion: assessment.suggestedRetention,
      promoteSignals: assessment.promoteSignals.join(', '),
      transferability: assessment.transferability,
      validityHint: assessment.validityHint,
      keywords: keywords.join(', '),
    },
    body: [
      '## Summary',
      summarizeMemoryLines(significantLines, COLD_SUMMARY_LINE_LIMIT),
      '',
      '## Keywords',
      compactBulletList(keywords),
    ].join('\n'),
  });
}
