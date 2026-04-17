export type MemoryScope = 'global' | 'daily' | 'session';
export type MemorySourceType =
  | 'manual'
  | 'conversation_log'
  | 'warm_summary'
  | 'cold_summary'
  | 'correction'
  | 'reflection'
  | 'promotion';
export type MemoryTier = 'hot' | 'warm' | 'cold';

export interface MemoryTierPolicy {
  hotRetentionDays?: number;
  warmRetentionDays?: number;
  coldRetentionDays?: number;
  coldMaxFiles?: number;
  protectedTopics?: string[];
}

export interface MemoryContextDocument {
  id: string;
  title: string;
  content: string;
  memoryScope: MemoryScope;
  sourceType: MemorySourceType;
  importanceScore: number;
  eventDate?: string | null;
  updatedAt: string;
}

export interface MemoryContextSectionEntry {
  key: string;
  label: string;
  content: string;
  memoryId?: string;
  memoryScope?: MemoryScope;
  sourceType?: MemorySourceType;
  eventDate?: string | null;
}

export interface MemoryContextSectionSnapshot {
  key: string;
  label: string;
  content: string;
  entries: MemoryContextSectionEntry[];
}

export interface MemoryContextSnapshot {
  content: string;
  sections: MemoryContextSectionSnapshot[];
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HOT_RETENTION_DAYS = 2;
const DEFAULT_WARM_RETENTION_DAYS = 15;
const OPEN_TASK_PATTERN =
  /(todo|待办|阻塞|deadline|due|follow-up|follow up|未完成|待处理|下一步|next step)/i;

const MEMORY_KEYWORD_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'be',
  'for',
  'from',
  'i',
  'in',
  'is',
  'it',
  'log',
  'memory',
  'of',
  'on',
  'or',
  'the',
  'to',
  'you',
  '你的',
  '了',
  '和',
  '把',
  '的',
  '在',
  '是',
  '还',
  '我',
  '你',
  '已',
  '将',
  '要',
]);

export function normalizeMemoryText(content: string) {
  return content.replace(/\s+/g, ' ').trim();
}

function sortMemoryDocuments(left: MemoryContextDocument, right: MemoryContextDocument) {
  return right.importanceScore - left.importanceScore || right.updatedAt.localeCompare(left.updatedAt);
}

type EffectiveDailySourceType = 'conversation_log' | 'warm_summary' | 'cold_summary';

const EFFECTIVE_DAILY_SOURCE_TYPES = new Set<EffectiveDailySourceType>([
  'conversation_log',
  'warm_summary',
  'cold_summary',
]);

function buildDailyTierTimestamp(eventDate: string) {
  return `${eventDate}T23:59:59.999Z`;
}

function getEffectiveDailySourcePriority(sourceType: EffectiveDailySourceType, tier: MemoryTier) {
  if (tier === 'hot') {
    return sourceType === 'conversation_log' ? 0 : Number.POSITIVE_INFINITY;
  }
  if (tier === 'warm') {
    return sourceType === 'warm_summary' ? 0 : sourceType === 'conversation_log' ? 1 : Number.POSITIVE_INFINITY;
  }
  return sourceType === 'cold_summary' ? 0 : sourceType === 'warm_summary' ? 1 : 2;
}

function compareEffectiveDailyDocuments<T extends MemoryContextDocument>(left: T, right: T) {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.importanceScore - left.importanceScore ||
    left.id.localeCompare(right.id)
  );
}

function compareEffectiveDailyDocumentsForTier<T extends MemoryContextDocument>(
  left: T,
  right: T,
  tier: MemoryTier,
) {
  return (
    getEffectiveDailySourcePriority(left.sourceType as EffectiveDailySourceType, tier) -
      getEffectiveDailySourcePriority(right.sourceType as EffectiveDailySourceType, tier) ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.importanceScore - left.importanceScore ||
    left.id.localeCompare(right.id)
  );
}

function isDeduplicatedDailyMemoryDocument(document: MemoryContextDocument) {
  return (
    document.memoryScope === 'daily' &&
    Boolean(document.eventDate) &&
    EFFECTIVE_DAILY_SOURCE_TYPES.has(document.sourceType as EffectiveDailySourceType)
  );
}

export function selectEffectiveMemoryDocuments<T extends MemoryContextDocument>(
  documents: T[],
  options: { now?: string; requireSourceDocument?: boolean; tierPolicy?: MemoryTierPolicy } = {},
): T[] {
  const now = options.now ?? new Date().toISOString();
  const requireSourceDocument = options.requireSourceDocument ?? false;
  const documentsByDate = new Map<string, T[]>();

  documents.forEach((document) => {
    if (!isDeduplicatedDailyMemoryDocument(document)) {
      return;
    }

    const eventDate = document.eventDate!;
    const existing = documentsByDate.get(eventDate) ?? [];
    existing.push(document);
    documentsByDate.set(eventDate, existing);
  });

  const effectiveDailyDocuments = new Map<string, T>();
  documentsByDate.forEach((dateDocuments, eventDate) => {
    if (requireSourceDocument && !dateDocuments.some((document) => document.sourceType === 'conversation_log')) {
      return;
    }

    const tier = resolveMemoryTier(buildDailyTierTimestamp(eventDate), now, options.tierPolicy);
    const eligible = dateDocuments.filter((document) =>
      Number.isFinite(getEffectiveDailySourcePriority(document.sourceType as EffectiveDailySourceType, tier)),
    );
    if (eligible.length === 0) {
      return;
    }

    const selected = eligible
      .slice()
      .sort((left, right) => compareEffectiveDailyDocumentsForTier(left, right, tier))[0];
    if (selected) {
      effectiveDailyDocuments.set(eventDate, selected);
    }
  });

  return documents.filter((document) => {
    if (!isDeduplicatedDailyMemoryDocument(document)) {
      return true;
    }

    return effectiveDailyDocuments.get(document.eventDate!) === document;
  });
}

export function extractMemoryContentLines(content: string) {
  const lines = content.split(/\r?\n/);
  const extracted: string[] = [];
  let inFrontmatter = false;
  let inFence = false;

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    if (index === 0 && trimmed === '---') {
      inFrontmatter = true;
      return;
    }
    if (inFrontmatter) {
      if (trimmed === '---') {
        inFrontmatter = false;
      }
      return;
    }

    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      return;
    }
    if (inFence) {
      return;
    }

    const normalized = normalizeMemoryText(line).replace(/^-+\s*/, '').trim();
    if (normalized && normalized !== '---' && !normalized.startsWith('#')) {
      extracted.push(normalized);
    }
  });

  return extracted;
}

function normalizeMemoryKeywordToken(token: string) {
  const normalized = token.trim().toLowerCase();
  if (normalized.length <= 1) {
    return '';
  }
  if (/^\d+$/.test(normalized)) {
    return '';
  }
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(normalized)) {
    return '';
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return '';
  }
  return normalized;
}

export function extractMemoryKeywords(content: string, limit = 8) {
  const frequencies = new Map<string, number>();

  extractMemoryContentLines(content).forEach((line) => {
    line.split(/[^A-Za-z0-9\u4e00-\u9fff]+/).forEach((token) => {
      const normalized = normalizeMemoryKeywordToken(token);
      if (!normalized || MEMORY_KEYWORD_STOP_WORDS.has(normalized)) {
        return;
      }

      frequencies.set(normalized, (frequencies.get(normalized) ?? 0) + 1);
    });
  });

  return [...frequencies.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([keyword]) => keyword);
}

export function summarizeMemoryLines(lines: string[], limit = 3) {
  const selected = lines
    .map((line) => normalizeMemoryText(line))
    .filter(Boolean)
    .slice(0, limit)
    .map((line) => line.replace(/^(\[\d{2}:\d{2}\]\s*)?/, '').trim())
    .filter(Boolean);

  if (selected.length === 0) {
    return 'No significant updates captured.';
  }

  return selected.join(' · ');
}

function normalizeRetentionDays(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function normalizeMemoryTierPolicy(policy: MemoryTierPolicy = {}): Required<MemoryTierPolicy> {
  const hotRetentionDays = normalizeRetentionDays(policy.hotRetentionDays, DEFAULT_HOT_RETENTION_DAYS);
  const warmRetentionDays = Math.max(
    hotRetentionDays,
    normalizeRetentionDays(policy.warmRetentionDays, DEFAULT_WARM_RETENTION_DAYS),
  );
  const coldRetentionDays = normalizeRetentionDays(policy.coldRetentionDays, 0);
  const coldMaxFiles = normalizeRetentionDays(policy.coldMaxFiles, 0);

  return {
    hotRetentionDays,
    warmRetentionDays,
    coldRetentionDays,
    coldMaxFiles,
    protectedTopics: Array.isArray(policy.protectedTopics)
      ? policy.protectedTopics.map((topic) => topic.trim()).filter(Boolean)
      : [],
  };
}

export function resolveMemoryTier(
  updatedAt: string,
  now = new Date().toISOString(),
  policy?: MemoryTierPolicy,
): MemoryTier {
  const retention = normalizeMemoryTierPolicy(policy);
  const ageMs = Math.max(0, new Date(now).getTime() - new Date(updatedAt).getTime());
  const ageDays = ageMs / DAY_IN_MS;

  if (ageDays <= retention.hotRetentionDays) {
    return 'hot';
  }
  if (ageDays <= retention.warmRetentionDays) {
    return 'warm';
  }
  return 'cold';
}

export function shouldPromoteMemory(content: string, role: 'user' | 'assistant' | 'system' | 'tool'): boolean {
  if (role !== 'user') {
    return false;
  }

  const normalized = normalizeMemoryText(content).toLowerCase();
  if (!normalized) {
    return false;
  }

  return /(记住|remember|长期记忆|长期保存|偏好|默认|总是|请始终|以后都|always|preference)/i.test(normalized);
}

export function scoreMemoryImportance(content: string, sourceType: MemorySourceType): number {
  const normalized = normalizeMemoryText(content).toLowerCase();

  if (
    sourceType === 'promotion' ||
    sourceType === 'correction' ||
    /(记住|remember|默认|偏好|总是|请始终|重要决策|核心身份)/i.test(normalized)
  ) {
    return 5;
  }
  if (sourceType === 'reflection') {
    return 4;
  }
  if (/(deadline|due|todo|待办|风险|阻塞|urgent|紧急|决策)/i.test(normalized)) {
    return 4;
  }
  if (sourceType === 'conversation_log' || sourceType === 'warm_summary' || sourceType === 'cold_summary') {
    return 3;
  }
  return 2;
}

export function buildConversationMemoryEntry(input: {
  topicTitle: string;
  authorName: string;
  role?: 'user' | 'assistant' | 'system' | 'tool';
  createdAt: string;
  content: string;
  attachments?: Array<{ name: string; sizeBytes?: number }>;
  tools?: Array<{ name: string; status: 'running' | 'completed' | 'failed'; result?: string }>;
}): string {
  const timestamp = new Date(input.createdAt);
  const hh = `${timestamp.getHours()}`.padStart(2, '0');
  const mm = `${timestamp.getMinutes()}`.padStart(2, '0');
  const roleLabel =
    input.role === 'assistant'
      ? 'Assistant'
      : input.role === 'system'
        ? 'System'
        : input.role === 'tool'
          ? 'Tool'
          : 'User';
  const content = normalizeMemoryText(input.content);
  const lines = [`- [${hh}:${mm}] ${input.topicTitle} · ${roleLabel}(${input.authorName}): ${content}`];
  const turnType =
    input.role === 'assistant'
      ? 'assistant_response'
      : input.role === 'system'
        ? 'system_event'
        : input.role === 'tool'
          ? 'tool_event'
          : 'user_request';
  lines.push(`  - Turn: ${turnType}`);

  if (input.attachments?.length) {
    const attachmentSummary = input.attachments
      .slice(0, 3)
      .map((attachment) => {
        const sizeLabel =
          typeof attachment.sizeBytes === 'number' && Number.isFinite(attachment.sizeBytes)
            ? `${Math.max(1, Math.round(attachment.sizeBytes / 1024))}KB`
            : null;
        return sizeLabel ? `${attachment.name} (${sizeLabel})` : attachment.name;
      })
      .join(', ');
    const suffix = input.attachments.length > 3 ? ` 等 ${input.attachments.length} 个附件` : '';
    lines.push(`  - Attachments: ${attachmentSummary}${suffix}`);
  }

  if (input.tools?.length) {
    const toolSummary = input.tools
      .slice(0, 3)
      .map((tool) => {
        const resultPreview = normalizeMemoryText(tool.result ?? '').slice(0, 160);
        return resultPreview ? `${tool.name}[${tool.status}]: ${resultPreview}` : `${tool.name}[${tool.status}]`;
      })
      .join('; ');
    const suffix = input.tools.length > 3 ? `；其余 ${input.tools.length - 3} 个工具已省略` : '';
    lines.push(`  - Tools: ${toolSummary}${suffix}`);
  }

  if (/(todo|待办|阻塞|deadline|due|follow-up|follow up|未完成|待处理|下一步|next step)/i.test(content)) {
    lines.push('  - Signals: open_loop');
  }
  if (/(decision|决策|共识|已确认|resolved|最终)/i.test(content)) {
    lines.push('  - Signals: decision');
  }
  const taskStates: string[] = [];
  if (/(阻塞|卡住|失败|报错|无法|blocked|stuck|failed|error)/i.test(content)) {
    taskStates.push('blocked');
  }
  if (/(完成|已完成|通过|修复|落地|提交|done|resolved|fixed|shipped|committed)/i.test(content)) {
    taskStates.push('completed');
  }
  if (input.tools?.some((tool) => tool.status === 'failed')) {
    taskStates.push('tool_failed');
  }
  if (input.tools?.some((tool) => tool.status === 'running')) {
    taskStates.push('tool_running');
  }
  if (taskStates.length > 0) {
    lines.push(`  - Task State: ${[...new Set(taskStates)].join(', ')}`);
  }

  return lines.join('\n');
}

export function buildPromotionFingerprint(content: string): string {
  const normalized = normalizeMemoryText(content)
    .toLowerCase()
    .replace(/^(记住|remember)\s*[:：-]?\s*/i, '');
  let hash = 5381;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 33) ^ normalized.charCodeAt(index);
  }
  return `memory_${(hash >>> 0).toString(36)}`;
}

export function buildMemoryPromotionTitle(content: string): string {
  return (
    normalizeMemoryText(content)
      .replace(/^(记住|remember)\s*[:：-]?\s*/i, '')
      .slice(0, 64)
      .trim() || 'Promoted Memory'
  );
}

function renderMemoryLine(document: MemoryContextDocument, maxLength: number) {
  const preview = normalizeMemoryText(document.content).slice(0, maxLength);
  return `- ${document.title}: ${preview}`;
}

function extractMemoryLines(document: MemoryContextDocument) {
  return extractMemoryContentLines(document.content);
}

export function extractOpenMemoryTasksFromLines(
  lines: string[],
  options: { title?: string; limit?: number; seen?: Set<string> } = {},
): string[] {
  const title = options.title ?? 'Memory';
  const limit = options.limit ?? 4;
  const seen = options.seen ?? new Set<string>();
  const tasks: string[] = [];

  lines.forEach((line) => {
    if (tasks.length >= limit || !OPEN_TASK_PATTERN.test(line)) {
      return;
    }

    const normalizedLine = line.slice(0, 220);
    const fingerprint = normalizedLine.toLowerCase();
    if (seen.has(fingerprint)) {
      return;
    }

    seen.add(fingerprint);
    tasks.push(`${title}: ${normalizedLine}`);
  });

  return tasks;
}

export function extractOpenMemoryTasks(
  documents: MemoryContextDocument[],
  options: { now?: string; limit?: number; tierPolicy?: MemoryTierPolicy } = {},
): string[] {
  const now = options.now ?? new Date().toISOString();
  const limit = options.limit ?? 4;
  const seen = new Set<string>();

  const candidates = documents
    .filter((document) => document.memoryScope !== 'global')
    .filter((document) => resolveMemoryTier(document.updatedAt, now, options.tierPolicy) !== 'cold')
    .sort(sortMemoryDocuments);

  const tasks: string[] = [];
  candidates.forEach((document) => {
    tasks.push(
      ...extractOpenMemoryTasksFromLines(extractMemoryLines(document), {
        title: document.title,
        limit: limit - tasks.length,
        seen,
      }),
    );
  });

  return tasks;
}

export function formatLayeredMemoryContext(
  documents: MemoryContextDocument[],
  options: { now?: string; includeRecentMemorySnapshot?: boolean; tierPolicy?: MemoryTierPolicy } = {},
): string {
  return buildLayeredMemoryContextSnapshot(documents, options).content;
}

export function buildLayeredMemoryContextSnapshot(
  documents: MemoryContextDocument[],
  options: { now?: string; includeRecentMemorySnapshot?: boolean; tierPolicy?: MemoryTierPolicy } = {},
): MemoryContextSnapshot {
  if (documents.length === 0) {
    return {
      content: '',
      sections: [],
    };
  }

  const now = options.now ?? new Date().toISOString();
  const includeRecentMemorySnapshot = options.includeRecentMemorySnapshot ?? true;
  const globalDocs = documents
    .filter((document) => document.memoryScope === 'global')
    .filter((document) => document.sourceType !== 'correction' && document.sourceType !== 'reflection')
    .sort(sortMemoryDocuments);
  const tieredDocs = documents.filter((document) => document.memoryScope !== 'global');
  const hotDocs = tieredDocs
    .filter((document) => resolveMemoryTier(document.updatedAt, now, options.tierPolicy) === 'hot')
    .sort(sortMemoryDocuments);
  const warmDocs = tieredDocs
    .filter((document) => resolveMemoryTier(document.updatedAt, now, options.tierPolicy) === 'warm')
    .sort(sortMemoryDocuments);
  const coldDocs = tieredDocs
    .filter((document) => resolveMemoryTier(document.updatedAt, now, options.tierPolicy) === 'cold')
    .sort(sortMemoryDocuments);
  const openTasks = includeRecentMemorySnapshot
    ? extractOpenMemoryTasks(documents, { now, tierPolicy: options.tierPolicy })
    : [];
  const recentSnapshotDocs = includeRecentMemorySnapshot ? [...hotDocs.slice(0, 3), ...warmDocs.slice(0, 2)] : [];

  const sections: MemoryContextSectionSnapshot[] = [];

  const pushDocumentSection = (
    key: string,
    label: string,
    sectionDocuments: MemoryContextDocument[],
    maxLength: number,
  ) => {
    if (!sectionDocuments.length) {
      return;
    }
    const entries = sectionDocuments.map((document) => ({
      key: `${key}:${document.id}`,
      label: document.title,
      content: renderMemoryLine(document, maxLength),
      memoryId: document.id,
      memoryScope: document.memoryScope,
      sourceType: document.sourceType,
      eventDate: document.eventDate,
    }));
    sections.push({
      key,
      label,
      content: `${label}:\n${entries.map((entry) => entry.content).join('\n')}`,
      entries,
    });
  };

  pushDocumentSection('global', 'Long-term memory', globalDocs.slice(0, 6), 240);
  pushDocumentSection(
    'recent_snapshot',
    'Recent memory snapshot',
    recentSnapshotDocs,
    220,
  );
  if (openTasks.length > 0) {
    const entries = openTasks.map((task, index) => ({
      key: `open_loop:${index}`,
      label: task.split(':')[0] || `Open loop ${index + 1}`,
      content: `- ${task}`,
    }));
    sections.push({
      key: 'open_loops',
      label: 'Open loops',
      content: `Open loops:\n${entries.map((entry) => entry.content).join('\n')}`,
      entries,
    });
  }
  pushDocumentSection('hot', 'Hot memory', hotDocs.slice(0, 4), 320);
  pushDocumentSection('warm', 'Warm memory', warmDocs.slice(0, 3), 180);
  pushDocumentSection('cold', 'Cold memory', coldDocs.slice(0, 2), 120);

  return {
    content: sections.map((section) => section.content).join('\n\n'),
    sections,
  };
}
