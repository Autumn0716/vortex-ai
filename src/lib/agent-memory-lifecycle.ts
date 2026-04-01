import { serializeMemoryMarkdown } from './agent-memory-files';
import {
  extractMemoryContentLines,
  extractMemoryKeywords,
  extractOpenMemoryTasksFromLines,
  scoreMemoryImportance,
  summarizeMemoryLines,
  resolveMemoryTier,
} from './agent-memory-model';

export type MemoryLifecycleTier = 'hot' | 'warm' | 'cold';

const DAILY_LINE_LIMIT = 5;
const WARM_SUMMARY_LINE_LIMIT = 4;
const COLD_SUMMARY_LINE_LIMIT = 2;

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
}) {
  const now = input.now ?? new Date().toISOString();
  const significantLines = collectSignificantDailyLines(input.sourceMarkdown);
  const openLoops = buildOpenLoopLines(input.date, input.sourceMarkdown, 4);
  const keywords = extractMemoryKeywords(significantLines.join('\n'), 8);
  const importance = scoreMemoryImportance(input.sourceMarkdown, 'conversation_log');

  return serializeMemoryMarkdown({
    frontmatter: {
      title: `${input.date} Warm Memory`,
      date: input.date,
      tier: 'warm',
      sourcePath: input.sourcePath,
      updatedAt: now,
      importance,
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
}) {
  const now = input.now ?? new Date().toISOString();
  const significantLines = collectSignificantDailyLines(input.sourceMarkdown);
  const keywords = extractMemoryKeywords(significantLines.join('\n'), 8);
  const openLoops = buildOpenLoopLines(input.date, input.sourceMarkdown, 2);
  const importance = scoreMemoryImportance(input.sourceMarkdown, 'conversation_log');

  return serializeMemoryMarkdown({
    frontmatter: {
      title: `${input.date} Cold Memory`,
      date: input.date,
      tier: 'cold',
      sourcePath: input.sourcePath,
      updatedAt: now,
      importance,
      keywords: keywords.join(', '),
    },
    body: [
      '## Summary',
      summarizeMemoryLines(significantLines, COLD_SUMMARY_LINE_LIMIT),
      '',
      '## Keywords',
      compactBulletList(keywords),
      '',
      '## Index',
      compactBulletList(buildIndexLines(significantLines, input.date)),
      '',
      '## Open Loops',
      compactBulletList(openLoops),
    ].join('\n'),
  });
}
