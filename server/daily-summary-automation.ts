import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  extractMemoryContentLines,
  extractMemoryKeywords,
  extractOpenMemoryTasksFromLines,
  summarizeMemoryLines,
} from '../src/lib/agent-memory-model';
import {
  createFilesystemAgentMemoryFileStore,
  listAgentSlugsFromMemoryRoot,
  resolveNextNightlyRunAt,
  shouldRunNightlyCatchup,
  type NightlyArchiveRunSummary,
} from './nightly-memory-archive';

export interface DailySummaryRunSummary {
  processedAgents: number;
  updatedFiles: number;
  skippedFiles: number;
  failedAgents: number;
  failures: Array<{ agentSlug: string; message: string }>;
  targetDate: string;
  trigger: NightlyArchiveRunSummary['trigger'];
  startedAt: string;
  completedAt: string;
}

export interface DailySummaryState {
  lastSuccessfulRunAt: string | null;
  lastSuccessfulRunDate: string | null;
  lastAttemptedRunAt: string | null;
  lastRunSummary: DailySummaryRunSummary | null;
}

export interface DailySummaryStatus {
  enabled: boolean;
  schedule: string;
  state: DailySummaryState;
  nextRunAt: string;
  catchUpDue: boolean;
  running: boolean;
}

export interface DailySummarySchedulerOptions {
  rootDir: string;
  now?: () => Date | string;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  logger?: Pick<Console, 'warn' | 'error'>;
}

const DAILY_SUMMARY_SCHEDULE_TIME = '08:00';
const VORTEX_DIRNAME = '.vortex';
const STATE_FILENAME = 'daily-summary-state.json';
const SUMMARY_START = '<!-- vortex:daily-summary:start -->';
const SUMMARY_END = '<!-- vortex:daily-summary:end -->';

const DEFAULT_DAILY_SUMMARY_STATE: DailySummaryState = {
  lastSuccessfulRunAt: null,
  lastSuccessfulRunDate: null,
  lastAttemptedRunAt: null,
  lastRunSummary: null,
};

function getStatePath(rootDir: string) {
  return path.join(rootDir, VORTEX_DIRNAME, STATE_FILENAME);
}

async function ensureStateDir(rootDir: string) {
  await fs.mkdir(path.join(rootDir, VORTEX_DIRNAME), { recursive: true });
}

function normalizeDailySummaryState(value?: Partial<DailySummaryState> | null): DailySummaryState {
  return {
    lastSuccessfulRunAt: value?.lastSuccessfulRunAt ?? null,
    lastSuccessfulRunDate: value?.lastSuccessfulRunDate ?? null,
    lastAttemptedRunAt: value?.lastAttemptedRunAt ?? null,
    lastRunSummary: value?.lastRunSummary ?? null,
  };
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  const raw = await fs.readFile(filePath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  });
  if (raw === null) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    console.warn(`Failed to parse daily summary state at ${filePath}; falling back to defaults.`);
    return null;
  }
}

export async function readDailySummaryState(rootDir: string) {
  const state = await readJsonFile<Partial<DailySummaryState>>(getStatePath(rootDir));
  return normalizeDailySummaryState(state);
}

async function writeDailySummaryState(rootDir: string, value: Partial<DailySummaryState>) {
  const next = normalizeDailySummaryState(value);
  await ensureStateDir(rootDir);
  await fs.writeFile(getStatePath(rootDir), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function formatLocalDate(input: Date) {
  return `${input.getFullYear()}-${String(input.getMonth() + 1).padStart(2, '0')}-${String(input.getDate()).padStart(2, '0')}`;
}

export function resolveDailySummaryTargetDate(now: string | Date) {
  const date = now instanceof Date ? new Date(now) : new Date(now);
  date.setDate(date.getDate() - 1);
  return formatLocalDate(date);
}

export function stripDailySummaryBlock(markdown: string) {
  const pattern = new RegExp(`\\n?${SUMMARY_START}[\\s\\S]*?${SUMMARY_END}\\n?`, 'g');
  return markdown.replace(pattern, '\n').trimEnd();
}

export function buildDailySummaryBlock(input: {
  date: string;
  sourceMarkdown: string;
  now: string;
}) {
  const sourceMarkdown = stripDailySummaryBlock(input.sourceMarkdown);
  const lines = extractMemoryContentLines(sourceMarkdown);
  const summary = summarizeMemoryLines(lines, 4);
  const openLoops = extractOpenMemoryTasksFromLines(lines, {
    title: `${input.date} Daily Memory`,
    limit: 4,
  });
  const keywords = extractMemoryKeywords(lines.join('\n'), 8);

  return [
    SUMMARY_START,
    '## Auto Daily Summary',
    `Updated: ${input.now}`,
    '',
    `- Summary: ${summary}`,
    '- Open Loops:',
    ...(openLoops.length > 0 ? openLoops.map((line) => `  - ${line}`) : ['  - None']),
    '- Keywords:',
    ...(keywords.length > 0 ? keywords.map((keyword) => `  - ${keyword}`) : ['  - None']),
    SUMMARY_END,
  ].join('\n');
}

export function upsertDailySummaryBlock(input: {
  date: string;
  sourceMarkdown: string;
  now: string;
}) {
  const sourceMarkdown = stripDailySummaryBlock(input.sourceMarkdown);
  const block = buildDailySummaryBlock({
    date: input.date,
    sourceMarkdown,
    now: input.now,
  });
  return `${sourceMarkdown.trimEnd()}\n\n${block}\n`;
}

export function createDailySummaryScheduler(options: DailySummarySchedulerOptions) {
  const rootDir = path.resolve(options.rootDir);
  const now = options.now ?? (() => new Date());
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const logger = options.logger ?? console;
  const fileStore = createFilesystemAgentMemoryFileStore(rootDir);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let started = false;

  function resolveNowDate() {
    const value = now();
    return value instanceof Date ? value : new Date(value);
  }

  function clearScheduledRun() {
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
  }

  async function getStatus(): Promise<DailySummaryStatus> {
    const state = await readDailySummaryState(rootDir);
    const currentNow = resolveNowDate();
    return {
      enabled: true,
      schedule: `每天 ${DAILY_SUMMARY_SCHEDULE_TIME}`,
      state,
      nextRunAt: resolveNextNightlyRunAt({ now: currentNow, scheduleTime: DAILY_SUMMARY_SCHEDULE_TIME }),
      catchUpDue: shouldRunNightlyCatchup({
        now: currentNow,
        scheduleTime: DAILY_SUMMARY_SCHEDULE_TIME,
        lastAttemptedRunAt: state.lastAttemptedRunAt,
        lastSuccessfulRunAt: state.lastSuccessfulRunAt,
      }),
      running,
    };
  }

  async function runOnce(trigger: DailySummaryRunSummary['trigger']) {
    const runStartedAt = resolveNowDate().toISOString();
    const targetDate = resolveDailySummaryTargetDate(runStartedAt);
    const agentSlugs = await listAgentSlugsFromMemoryRoot(rootDir);
    const failures: DailySummaryRunSummary['failures'] = [];
    let updatedFiles = 0;
    let skippedFiles = 0;

    for (const agentSlug of agentSlugs) {
      const dailyPath = `memory/agents/${agentSlug}/daily/${targetDate}.md`;
      try {
        const sourceMarkdown = await fileStore.readText(dailyPath);
        if (!sourceMarkdown?.trim()) {
          skippedFiles += 1;
          continue;
        }
        await fileStore.writeText(
          dailyPath,
          upsertDailySummaryBlock({
            date: targetDate,
            sourceMarkdown,
            now: runStartedAt,
          }),
        );
        updatedFiles += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Daily summary failed.';
        failures.push({ agentSlug, message });
        logger.warn(`Daily summary failed for ${agentSlug}: ${message}`);
      }
    }

    const summary: DailySummaryRunSummary = {
      processedAgents: agentSlugs.length,
      updatedFiles,
      skippedFiles,
      failedAgents: failures.length,
      failures,
      targetDate,
      trigger,
      startedAt: runStartedAt,
      completedAt: resolveNowDate().toISOString(),
    };

    const currentState = await readDailySummaryState(rootDir);
    await writeDailySummaryState(rootDir, {
      lastAttemptedRunAt: summary.completedAt,
      lastSuccessfulRunAt: failures.length === 0 ? summary.completedAt : currentState.lastSuccessfulRunAt,
      lastSuccessfulRunDate: failures.length === 0 ? targetDate : currentState.lastSuccessfulRunDate,
      lastRunSummary: summary,
    });

    return summary;
  }

  async function scheduleNextRun() {
    clearScheduledRun();
    const currentNow = resolveNowDate();
    const nextRunAt = new Date(resolveNextNightlyRunAt({ now: currentNow, scheduleTime: DAILY_SUMMARY_SCHEDULE_TIME }));
    const delay = Math.max(1000, nextRunAt.getTime() - currentNow.getTime());
    timer = setTimer(async () => {
      try {
        running = true;
        await runOnce('scheduled');
      } catch (error) {
        logger.error('Daily summary scheduled run failed:', error);
      } finally {
        running = false;
        await scheduleNextRun();
      }
    }, delay);
    timer.unref?.();
  }

  return {
    async start() {
      if (started) {
        return;
      }
      started = true;
      const state = await readDailySummaryState(rootDir);
      if (shouldRunNightlyCatchup({
        now: resolveNowDate(),
        scheduleTime: DAILY_SUMMARY_SCHEDULE_TIME,
        lastAttemptedRunAt: state.lastAttemptedRunAt,
        lastSuccessfulRunAt: state.lastSuccessfulRunAt,
      })) {
        try {
          running = true;
          await runOnce('catchup');
        } catch (error) {
          logger.error('Daily summary catch-up run failed:', error);
        } finally {
          running = false;
        }
      }
      await scheduleNextRun();
    },
    stop() {
      started = false;
      clearScheduledRun();
    },
    async getStatus() {
      return getStatus();
    },
    async runNow(trigger: DailySummaryRunSummary['trigger'] = 'manual') {
      try {
        running = true;
        await runOnce(trigger);
      } finally {
        running = false;
        await scheduleNextRun();
      }
      return getStatus();
    },
  };
}
