import {
  extractMemoryContentLines,
  normalizeMemoryText,
} from './agent-memory-model';

export type MemoryPromotionCategory =
  | 'behavioral_patterns'
  | 'workflow_improvements'
  | 'tool_gotchas'
  | 'durable_facts';

export interface MemoryPromotionDecision {
  shouldPromote: boolean;
  category: MemoryPromotionCategory | null;
  entry: string;
}

const EXPLICIT_PROMOTION_PATTERN =
  /(记住|remember|长期记忆|长期保存|偏好|默认|总是|请始终|以后都|always|preference)/i;

const BEHAVIORAL_PATTERN =
  /(be concise|concise|avoid disclaimers|免责声明|言简意赅|简洁|输出风格|回答时|respond|reply|保持.*简短)/i;
const WORKFLOW_PATTERN =
  /(workflow|工作流|流程|步骤|先.*再|spawn sub-?agents|子代理|长任务|long tasks|review|验证|先查|先验证|拆分任务)/i;
const TOOL_GOTCHA_PATTERN =
  /(git push|auth|authentication|登录|token|api key|权限|permission|sqlite|port|vite|indexeddb|quota|需要先|坑|gotcha|trap)/i;
const DURABLE_FACT_PATTERN =
  /(默认|偏好|preference|总是|请始终|以后都|身份|role|负责人|项目状态|decision|重要决策|核心身份|language|中文输出)/i;

function stripPromotionLineNoise(line: string) {
  let normalized = normalizeMemoryText(line)
    .replace(/^\s*-\s*/, '')
    .replace(/^\[(\d{2}:\d{2})\]\s*/, '[$1] ')
    .trim();

  if (normalized.includes(' · ')) {
    normalized = normalized.replace(/^.*?[：:]\s*/, '').trim();
  }

  return normalized;
}

function classifyPromotionCategory(entry: string): MemoryPromotionCategory | null {
  if (BEHAVIORAL_PATTERN.test(entry)) {
    return 'behavioral_patterns';
  }
  if (WORKFLOW_PATTERN.test(entry)) {
    return 'workflow_improvements';
  }
  if (TOOL_GOTCHA_PATTERN.test(entry)) {
    return 'tool_gotchas';
  }
  if (DURABLE_FACT_PATTERN.test(entry)) {
    return 'durable_facts';
  }

  return null;
}

function normalizePromotionEntry(entry: string) {
  return normalizeMemoryText(entry)
    .toLowerCase()
    .replace(/^(记住|remember)\s*[:：-]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPromotionEntry(lines: string[]) {
  const explicitLine = lines.find((line) => EXPLICIT_PROMOTION_PATTERN.test(line));
  if (explicitLine) {
    return explicitLine.replace(/^(记住|remember)\s*[:：-]?\s*/i, '').trim();
  }

  const reusableLine = lines.find((line) => classifyPromotionCategory(line) !== null);
  return reusableLine ?? lines[0] ?? '';
}

export function buildRuleBasedPromotionDecision(input: {
  sourceMarkdown: string;
  importanceScore: number;
}): MemoryPromotionDecision {
  const lines = extractMemoryContentLines(input.sourceMarkdown)
    .map(stripPromotionLineNoise)
    .filter(Boolean);
  const entry = buildPromotionEntry(lines);
  const category = entry ? classifyPromotionCategory(entry) : null;
  const explicit = lines.some((line) => EXPLICIT_PROMOTION_PATTERN.test(line));
  const shouldPromote = explicit || (input.importanceScore >= 5 && category !== null);

  return {
    shouldPromote,
    category,
    entry,
  };
}

export function normalizePromotionCategory(value: string): MemoryPromotionCategory | null {
  const normalized = normalizeMemoryText(value).toLowerCase();
  switch (normalized) {
    case 'behavioral_patterns':
    case 'behavioral patterns':
    case 'behavior':
    case 'style':
      return 'behavioral_patterns';
    case 'workflow_improvements':
    case 'workflow improvements':
    case 'workflow':
      return 'workflow_improvements';
    case 'tool_gotchas':
    case 'tool gotchas':
    case 'gotchas':
    case 'tools':
      return 'tool_gotchas';
    case 'durable_facts':
    case 'durable facts':
    case 'facts':
    case 'preferences':
      return 'durable_facts';
    default:
      return null;
  }
}

export function normalizePromotionEntryFingerprint(entry: string) {
  return normalizePromotionEntry(entry)
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
