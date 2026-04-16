import { promises as fs } from 'node:fs';
import path from 'node:path';

import type {
  NightlyArchiveRunSummary,
  NightlyArchiveStatus,
} from './nightly-memory-archive';

export interface WeeklyArchiveState {
  lastSuccessfulRunAt: string | null;
  lastSuccessfulRunDate: string | null;
  lastAttemptedRunAt: string | null;
  lastRunSummary: NightlyArchiveRunSummary | null;
}

export interface WeeklyArchiveStatus {
  enabled: boolean;
  schedule: string;
  state: WeeklyArchiveState;
  nextRunAt: string;
  catchUpDue: boolean;
  running: boolean;
}

export interface WeeklyArchiveSchedulerOptions {
  rootDir: string;
  runArchive: (trigger: NightlyArchiveRunSummary['trigger']) => Promise<NightlyArchiveStatus>;
  now?: () => Date | string;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  logger?: Pick<Console, 'warn' | 'error'>;
}

const FLOWAGENT_DIRNAME = '.flowagent';
const STATE_FILENAME = 'weekly-archive-state.json';
const WEEKLY_ARCHIVE_SCHEDULE_DAY = 0;
const WEEKLY_ARCHIVE_SCHEDULE_TIME = '04:00';
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const DEFAULT_WEEKLY_ARCHIVE_STATE: WeeklyArchiveState = {
  lastSuccessfulRunAt: null,
  lastSuccessfulRunDate: null,
  lastAttemptedRunAt: null,
  lastRunSummary: null,
};

function getStatePath(rootDir: string) {
  return path.join(rootDir, FLOWAGENT_DIRNAME, STATE_FILENAME);
}

async function ensureStateDir(rootDir: string) {
  await fs.mkdir(path.join(rootDir, FLOWAGENT_DIRNAME), { recursive: true });
}

function normalizeWeeklyArchiveState(value?: Partial<WeeklyArchiveState> | null): WeeklyArchiveState {
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
    console.warn(`Failed to parse weekly archive state at ${filePath}; falling back to defaults.`);
    return null;
  }
}

export async function readWeeklyArchiveState(rootDir: string) {
  const state = await readJsonFile<Partial<WeeklyArchiveState>>(getStatePath(rootDir));
  return normalizeWeeklyArchiveState(state);
}

async function writeWeeklyArchiveState(rootDir: string, value: Partial<WeeklyArchiveState>) {
  const next = normalizeWeeklyArchiveState(value);
  await ensureStateDir(rootDir);
  await fs.writeFile(getStatePath(rootDir), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function parseScheduleTime() {
  const [hoursText, minutesText] = WEEKLY_ARCHIVE_SCHEDULE_TIME.split(':');
  return {
    hours: Number(hoursText),
    minutes: Number(minutesText),
  };
}

function buildScheduledLocalDate(baseDate: Date, dayOfWeek: number) {
  const { hours, minutes } = parseScheduleTime();
  const scheduledDate = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    hours,
    minutes,
    0,
    0,
  );
  const daysUntilTarget = (dayOfWeek - scheduledDate.getDay() + 7) % 7;
  scheduledDate.setDate(scheduledDate.getDate() + daysUntilTarget);
  return scheduledDate;
}

function formatLocalDate(input: Date) {
  return `${input.getFullYear()}-${String(input.getMonth() + 1).padStart(2, '0')}-${String(input.getDate()).padStart(2, '0')}`;
}

export function resolveNextWeeklyArchiveRunAt(now: string | Date) {
  const currentNow = now instanceof Date ? now : new Date(now);
  const scheduledThisWeek = buildScheduledLocalDate(currentNow, WEEKLY_ARCHIVE_SCHEDULE_DAY);
  const nextRun =
    scheduledThisWeek.getTime() > currentNow.getTime()
      ? scheduledThisWeek
      : new Date(scheduledThisWeek.getTime() + 7 * DAY_IN_MS);
  return nextRun.toISOString();
}

function resolveMostRecentWeeklyArchiveRunAt(now: string | Date) {
  const currentNow = now instanceof Date ? now : new Date(now);
  const scheduledThisWeek = buildScheduledLocalDate(currentNow, WEEKLY_ARCHIVE_SCHEDULE_DAY);
  if (scheduledThisWeek.getTime() <= currentNow.getTime()) {
    return scheduledThisWeek.toISOString();
  }
  return new Date(scheduledThisWeek.getTime() - 7 * DAY_IN_MS).toISOString();
}

export function shouldRunWeeklyArchiveCatchup(input: {
  now: string | Date;
  lastAttemptedRunAt?: string | null;
  lastSuccessfulRunAt?: string | null;
}) {
  const mostRecentScheduledRunAt = resolveMostRecentWeeklyArchiveRunAt(input.now);
  const reference = input.lastAttemptedRunAt ?? input.lastSuccessfulRunAt;
  if (!reference) {
    return true;
  }
  return new Date(reference).getTime() < new Date(mostRecentScheduledRunAt).getTime();
}

export function createWeeklyArchiveScheduler(options: WeeklyArchiveSchedulerOptions) {
  const rootDir = path.resolve(options.rootDir);
  const now = options.now ?? (() => new Date());
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const logger = options.logger ?? console;
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

  async function getStatus(): Promise<WeeklyArchiveStatus> {
    const state = await readWeeklyArchiveState(rootDir);
    const currentNow = resolveNowDate();
    return {
      enabled: true,
      schedule: `每周日 ${WEEKLY_ARCHIVE_SCHEDULE_TIME}`,
      state,
      nextRunAt: resolveNextWeeklyArchiveRunAt(currentNow),
      catchUpDue: shouldRunWeeklyArchiveCatchup({
        now: currentNow,
        lastAttemptedRunAt: state.lastAttemptedRunAt,
        lastSuccessfulRunAt: state.lastSuccessfulRunAt,
      }),
      running,
    };
  }

  async function runOnce(trigger: NightlyArchiveRunSummary['trigger']) {
    const archiveStatus = await options.runArchive(trigger);
    const archiveSummary = archiveStatus.state.lastRunSummary;
    const completedAt = archiveSummary?.completedAt ?? resolveNowDate().toISOString();
    const failedAgents = archiveSummary?.failedAgents ?? 0;
    const currentState = await readWeeklyArchiveState(rootDir);
    await writeWeeklyArchiveState(rootDir, {
      lastAttemptedRunAt: completedAt,
      lastSuccessfulRunAt: failedAgents === 0 ? completedAt : currentState.lastSuccessfulRunAt,
      lastSuccessfulRunDate: failedAgents === 0 ? formatLocalDate(new Date(completedAt)) : currentState.lastSuccessfulRunDate,
      lastRunSummary: archiveSummary,
    });
    return archiveSummary;
  }

  async function scheduleNextRun() {
    clearScheduledRun();
    const currentNow = resolveNowDate();
    const nextRunAt = new Date(resolveNextWeeklyArchiveRunAt(currentNow));
    const delay = Math.max(1000, nextRunAt.getTime() - currentNow.getTime());
    timer = setTimer(async () => {
      try {
        running = true;
        await runOnce('scheduled');
      } catch (error) {
        logger.error('Weekly archive scheduled run failed:', error);
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
      const state = await readWeeklyArchiveState(rootDir);
      if (shouldRunWeeklyArchiveCatchup({
        now: resolveNowDate(),
        lastAttemptedRunAt: state.lastAttemptedRunAt,
        lastSuccessfulRunAt: state.lastSuccessfulRunAt,
      })) {
        try {
          running = true;
          await runOnce('catchup');
        } catch (error) {
          logger.error('Weekly archive catch-up run failed:', error);
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
    async runNow(trigger: NightlyArchiveRunSummary['trigger'] = 'manual') {
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
