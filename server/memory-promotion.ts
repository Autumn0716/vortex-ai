import { buildAgentMemoryPaths, parseMemoryMarkdown } from '../src/lib/agent-memory-files';
import {
  normalizePromotionCategory,
  normalizePromotionEntryFingerprint,
  type MemoryPromotionCategory,
} from '../src/lib/agent-memory-promotion';
import type { AgentMemoryFileStore } from '../src/lib/agent-memory-sync';

export interface MemoryPromotionEntry {
  category: MemoryPromotionCategory;
  entry: string;
}

export interface MemoryPromotionSyncResult {
  scannedCandidates: number;
  promotedCount: number;
  updated: boolean;
}

const AUTO_BLOCK_START = '<!-- AUTO-PROMOTED-MEMORY:START -->';
const AUTO_BLOCK_END = '<!-- AUTO-PROMOTED-MEMORY:END -->';

const CATEGORY_LABELS: Record<MemoryPromotionCategory, string> = {
  behavioral_patterns: 'Behavioral Patterns',
  workflow_improvements: 'Workflow Improvements',
  tool_gotchas: 'Tool Gotchas',
  durable_facts: 'Durable Facts',
};

const CATEGORY_ORDER: MemoryPromotionCategory[] = [
  'behavioral_patterns',
  'workflow_improvements',
  'tool_gotchas',
  'durable_facts',
];

function coerceString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function coerceBoolean(value: unknown) {
  return value === true;
}

function coerceNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
}

function parsePromoteSignals(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }
  return value
    .split(',')
    .map((signal) => signal.trim())
    .filter(Boolean);
}

function splitAutoBlock(body: string) {
  const startIndex = body.indexOf(AUTO_BLOCK_START);
  const endIndex = body.indexOf(AUTO_BLOCK_END);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return {
      manualBody: body.trim(),
      autoBlock: '',
    };
  }

  const manualBody = `${body.slice(0, startIndex)}${body.slice(endIndex + AUTO_BLOCK_END.length)}`.trim();
  const autoBlock = body.slice(startIndex, endIndex + AUTO_BLOCK_END.length);
  return { manualBody, autoBlock };
}

function parseExistingPromotions(autoBlock: string) {
  const entries: MemoryPromotionEntry[] = [];
  let currentCategory: MemoryPromotionCategory | null = null;

  autoBlock.split(/\r?\n/).forEach((line) => {
    const headingMatch = line.match(/^###\s+(.+?)\s*$/);
    if (headingMatch) {
      const normalizedCategory = Object.entries(CATEGORY_LABELS).find(([, label]) => label === headingMatch[1]);
      currentCategory = (normalizedCategory?.[0] as MemoryPromotionCategory | undefined) ?? null;
      return;
    }

    if (!currentCategory) {
      return;
    }

    const bulletMatch = line.match(/^- (.+)$/);
    if (!bulletMatch) {
      return;
    }

    const entry = bulletMatch[1]!.trim();
    if (!entry) {
      return;
    }

    entries.push({
      category: currentCategory,
      entry,
    });
  });

  return entries;
}

function renderAutoBlock(entries: MemoryPromotionEntry[]) {
  const grouped = new Map<MemoryPromotionCategory, string[]>();
  entries.forEach((entry) => {
    const list = grouped.get(entry.category) ?? [];
    list.push(entry.entry);
    grouped.set(entry.category, list);
  });

  const sections = CATEGORY_ORDER.flatMap((category) => {
    const items = [...new Set((grouped.get(category) ?? []).map((entry) => entry.trim()).filter(Boolean))].sort((left, right) =>
      left.localeCompare(right),
    );
    if (items.length === 0) {
      return [];
    }

    return [
      `### ${CATEGORY_LABELS[category]}`,
      ...items.map((entry) => `- ${entry}`),
      '',
    ];
  });

  if (sections.length === 0) {
    return '';
  }

  return [AUTO_BLOCK_START, '## Learned Patterns', '', ...sections.slice(0, -1), AUTO_BLOCK_END].join('\n').trim();
}

function mergePromotionsIntoMemoryMarkdown(input: {
  currentMarkdown: string | null;
  promotedEntries: MemoryPromotionEntry[];
  now: string;
}) {
  const parsed = parseMemoryMarkdown(input.currentMarkdown ?? '');
  const frontmatter = { ...parsed.frontmatter };
  const { manualBody, autoBlock } = splitAutoBlock(parsed.body);
  const mergedEntries = [...parseExistingPromotions(autoBlock), ...input.promotedEntries];
  const deduped = new Map<string, MemoryPromotionEntry>();

  mergedEntries.forEach((entry) => {
    const fingerprint = `${entry.category}:${normalizePromotionEntryFingerprint(entry.entry)}`;
    if (!fingerprint.endsWith(':')) {
      deduped.set(fingerprint, entry);
    }
  });

  const renderedAutoBlock = renderAutoBlock([...deduped.values()]);
  const body = [manualBody, renderedAutoBlock].filter(Boolean).join('\n\n').trim();
  frontmatter.title = coerceString(frontmatter.title) || 'Agent Memory';
  frontmatter.updatedAt = input.now;

  const nextMarkdown = body
    ? `---\n${Object.entries(frontmatter)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, value]) => `${key}: ${typeof value === 'string' ? JSON.stringify(value) : String(value)}`)
        .join('\n')}\n---\n\n${body}`
    : '';

  return {
    nextMarkdown,
    updated: nextMarkdown !== (input.currentMarkdown ?? ''),
    promotedCount: input.promotedEntries.length,
  };
}

function selectPromotionEntries(markdown: string) {
  const { frontmatter } = parseMemoryMarkdown(markdown);
  const category = normalizePromotionCategory(coerceString(frontmatter.promotionCategory));
  const entry = coerceString(frontmatter.promotionEntry);
  const shouldPromote = coerceBoolean(frontmatter.shouldPromote);
  const importance = coerceNumber(frontmatter.importance);
  const promotionScore = coerceNumber(frontmatter.promotionScore);
  const promoteSignals = parsePromoteSignals(frontmatter.promoteSignals);
  const abstractionLevel = coerceString(frontmatter.abstractionLevel).toLowerCase();
  const transferability = coerceString(frontmatter.transferability).toLowerCase();
  const goldenLabel = coerceString(frontmatter.goldenLabel).toLowerCase();

  if (!entry || !category) {
    return null;
  }

  return {
    category,
    entry,
    shouldPromote,
    importance: Number.isFinite(importance) ? importance : 0,
    promotionScore: Number.isFinite(promotionScore) ? promotionScore : 0,
    hasPromoteSignals: promoteSignals.length > 0,
    abstractionLevel,
    transferability,
    goldenLabel,
  };
}

export async function syncPromotedMemoryFromSurrogates(input: {
  agentSlug: string;
  fileStore: AgentMemoryFileStore;
  now?: string;
  promotionThreshold?: number;
}) {
  const now = input.now ?? new Date().toISOString();
  const promotionThreshold = input.promotionThreshold ?? 4;
  const paths = buildAgentMemoryPaths(input.agentSlug, now.slice(0, 10));
  const surrogatePaths = (await input.fileStore.listPaths(paths.dailyDir))
    .filter((filePath) => filePath.endsWith('.warm.md') || filePath.endsWith('.cold.md'))
    .sort();
  const rawCandidates = (
    await Promise.all(
      surrogatePaths.map(async (filePath) => {
        const markdown = await input.fileStore.readText(filePath);
        return markdown ? selectPromotionEntries(markdown) : null;
      }),
    )
  ).filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
  const counts = new Map<string, number>();

  rawCandidates.forEach((candidate) => {
    const key = normalizePromotionEntryFingerprint(candidate.entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  const promotedEntries = rawCandidates
    .filter((candidate) => {
      const repeats = counts.get(normalizePromotionEntryFingerprint(candidate.entry)) ?? 0;
      const hasGoldenLabel = ['validated', 'preferred', 'accepted', 'approved'].includes(candidate.goldenLabel);
      const broadlyTransferable =
        (candidate.abstractionLevel === 'pattern' || candidate.abstractionLevel === 'principle') &&
        candidate.transferability === 'high';

      return (
        candidate.shouldPromote ||
        repeats >= 2 ||
        candidate.promotionScore >= promotionThreshold ||
        (candidate.importance >= 5 && candidate.hasPromoteSignals) ||
        hasGoldenLabel ||
        broadlyTransferable
      );
    })
    .map<MemoryPromotionEntry>((candidate) => ({
      category: candidate.category,
      entry: candidate.entry,
    }));

  if (promotedEntries.length === 0) {
    return {
      scannedCandidates: rawCandidates.length,
      promotedCount: 0,
      updated: false,
    } satisfies MemoryPromotionSyncResult;
  }

  const currentMarkdown = await input.fileStore.readText(paths.memoryFile);
  const merged = mergePromotionsIntoMemoryMarkdown({
    currentMarkdown,
    promotedEntries,
    now,
  });

  if (merged.updated) {
    await input.fileStore.writeText(paths.memoryFile, merged.nextMarkdown);
  }

  return {
    scannedCandidates: rawCandidates.length,
    promotedCount: merged.promotedCount,
    updated: merged.updated,
  } satisfies MemoryPromotionSyncResult;
}
