import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  syncAgentMemoryLifecycleFromStore,
  type AgentMemoryFileStore,
  type AgentMemoryLifecycleResult,
} from '../src/lib/agent-memory-sync';
import type { AgentConfig } from '../src/lib/agent/config';
import type { MemoryImportanceAssessment } from '../src/lib/agent-memory-lifecycle';
import type { MemoryTierPolicy } from '../src/lib/agent-memory-model';
import { readProjectConfig } from './config-store';
import { walkDirectory } from './lib/fs-utils';
import { scoreMemoryImportanceWithModel } from './memory-importance-scorer';
import { syncPromotedMemoryFromSurrogates, type MemoryPromotionSyncResult } from './memory-promotion';

export interface NightlyArchiveSettings {
  enabled: boolean;
  time: string;
  cronExpression: string | null;
  useLlmScoring: boolean;
}

export interface NightlyArchiveRunSummary {
  processedAgents: number;
  successfulAgents: number;
  failedAgents: number;
  failures: Array<{ agentSlug: string; message: string }>;
  llmScoredCount: number;
  ruleFallbackCount: number;
  promotedCount: number;
  trigger: 'catchup' | 'scheduled' | 'manual';
  startedAt: string;
  completedAt: string;
}

export interface NightlyArchiveState {
  lastSuccessfulRunAt: string | null;
  lastSuccessfulRunDate: string | null;
  lastAttemptedRunAt: string | null;
  lastRunSummary: NightlyArchiveRunSummary | null;
}

export interface NightlyArchiveStatus {
  settings: NightlyArchiveSettings;
  state: NightlyArchiveState;
  nextRunAt: string | null;
  catchUpDue: boolean;
  running: boolean;
}

export interface NightlyMemoryArchiveSchedulerOptions {
  rootDir: string;
  now?: () => Date | string;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  listAgentSlugs?: (rootDir: string) => Promise<string[]>;
  createFileStore?: (rootDir: string) => AgentMemoryFileStore;
  runLifecycleSync?: (input: {
    agentSlug: string;
    fileStore: AgentMemoryFileStore;
    now: string;
    lifecyclePolicy?: MemoryTierPolicy;
    scoreImportance?: (input: {
      date: string;
      tier: 'warm' | 'cold';
      sourcePath: string;
      sourceMarkdown: string;
    }) => Promise<MemoryImportanceAssessment>;
  }) => Promise<AgentMemoryLifecycleResult>;
  runPromotionSync?: (input: {
    agentSlug: string;
    fileStore: AgentMemoryFileStore;
    now: string;
    promotionThreshold?: number;
  }) => Promise<MemoryPromotionSyncResult>;
  scoreImportanceWithModel?: (input: {
    config: AgentConfig;
    date: string;
    tier: 'warm' | 'cold';
    sourceMarkdown: string;
  }) => Promise<MemoryImportanceAssessment>;
}

const DEFAULT_NIGHTLY_ARCHIVE_SETTINGS: NightlyArchiveSettings = {
  enabled: false,
  time: '03:00',
  cronExpression: null,
  useLlmScoring: false,
};

const DEFAULT_NIGHTLY_ARCHIVE_STATE: NightlyArchiveState = {
  lastSuccessfulRunAt: null,
  lastSuccessfulRunDate: null,
  lastAttemptedRunAt: null,
  lastRunSummary: null,
};

const VORTEX_DIRNAME = '.vortex';
const SETTINGS_FILENAME = 'nightly-memory-archive-settings.json';
const STATE_FILENAME = 'nightly-memory-archive-state.json';

function getVortexDir(rootDir: string) {
  return path.resolve(rootDir, VORTEX_DIRNAME);
}

function getSettingsPath(rootDir: string) {
  return path.join(getVortexDir(rootDir), SETTINGS_FILENAME);
}

function getStatePath(rootDir: string) {
  return path.join(getVortexDir(rootDir), STATE_FILENAME);
}

export function validateNightlyArchiveTime(value: string) {
  const normalized = value.trim();
  const match = normalized.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error('Nightly archive time must use HH:MM.');
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || hours < 0 || hours > 23 || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
    throw new Error('Nightly archive time is out of range.');
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function validateNightlyArchiveCronExpression(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  const match = normalized.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (!match) {
    throw new Error('Nightly archive cron must use "minute hour * * *".');
  }

  const minutes = Number(match[1]);
  const hours = Number(match[2]);
  if (!Number.isInteger(hours) || hours < 0 || hours > 23 || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
    throw new Error('Nightly archive cron time is out of range.');
  }

  return `${minutes} ${hours} * * *`;
}

export function normalizeNightlyArchiveCronExpression(value?: string | null) {
  if (typeof value !== 'string') {
    return null;
  }
  if (!value.trim()) {
    return null;
  }
  return validateNightlyArchiveCronExpression(value);
}

export function normalizeNightlyArchiveSettings(value?: Partial<NightlyArchiveSettings> | null): NightlyArchiveSettings {
  return {
    enabled: value?.enabled ?? DEFAULT_NIGHTLY_ARCHIVE_SETTINGS.enabled,
    time: validateNightlyArchiveTime(value?.time ?? DEFAULT_NIGHTLY_ARCHIVE_SETTINGS.time),
    cronExpression: normalizeNightlyArchiveCronExpression(value?.cronExpression),
    useLlmScoring: value?.useLlmScoring ?? DEFAULT_NIGHTLY_ARCHIVE_SETTINGS.useLlmScoring,
  };
}

function normalizeNightlyArchiveState(value?: Partial<NightlyArchiveState> | null): NightlyArchiveState {
  return {
    lastSuccessfulRunAt: value?.lastSuccessfulRunAt ?? null,
    lastSuccessfulRunDate: value?.lastSuccessfulRunDate ?? null,
    lastAttemptedRunAt: value?.lastAttemptedRunAt ?? null,
    lastRunSummary: value?.lastRunSummary ?? null,
  };
}

function parseTimeParts(scheduleTime: string) {
  const [hoursText, minutesText] = validateNightlyArchiveTime(scheduleTime).split(':');
  return {
    hours: Number(hoursText),
    minutes: Number(minutesText),
  };
}

export function resolveNightlyArchiveScheduleTime(settings: Pick<NightlyArchiveSettings, 'time' | 'cronExpression'>) {
  if (settings.cronExpression) {
    const [minutesText, hoursText] = validateNightlyArchiveCronExpression(settings.cronExpression).split(' ');
    return `${String(Number(hoursText)).padStart(2, '0')}:${String(Number(minutesText)).padStart(2, '0')}`;
  }
  return validateNightlyArchiveTime(settings.time);
}

export function formatNightlyArchiveSchedule(settings: Pick<NightlyArchiveSettings, 'time' | 'cronExpression'>) {
  return settings.cronExpression ? `cron ${settings.cronExpression}` : `每天 ${settings.time}`;
}

function buildScheduledLocalDate(baseDate: Date, scheduleTime: string) {
  const { hours, minutes } = parseTimeParts(scheduleTime);
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    hours,
    minutes,
    0,
    0,
  );
}

export function resolveNextNightlyRunAt(input: { now: string | Date; scheduleTime: string }) {
  const now = input.now instanceof Date ? input.now : new Date(input.now);
  const scheduledToday = buildScheduledLocalDate(now, input.scheduleTime);
  const nextRun = scheduledToday.getTime() > now.getTime()
    ? scheduledToday
    : new Date(scheduledToday.getTime() + 24 * 60 * 60 * 1000);
  return nextRun.toISOString();
}

function resolveMostRecentScheduledRunAt(input: { now: string | Date; scheduleTime: string }) {
  const now = input.now instanceof Date ? input.now : new Date(input.now);
  const scheduledToday = buildScheduledLocalDate(now, input.scheduleTime);
  if (scheduledToday.getTime() <= now.getTime()) {
    return scheduledToday.toISOString();
  }
  return new Date(scheduledToday.getTime() - 24 * 60 * 60 * 1000).toISOString();
}

export function shouldRunNightlyCatchup(input: {
  now: string | Date;
  scheduleTime: string;
  lastAttemptedRunAt?: string | null;
  lastSuccessfulRunAt?: string | null;
}) {
  const mostRecentScheduledRunAt = resolveMostRecentScheduledRunAt({
    now: input.now,
    scheduleTime: input.scheduleTime,
  });
  const reference = input.lastAttemptedRunAt ?? input.lastSuccessfulRunAt;
  if (!reference) {
    return true;
  }

  return new Date(reference).getTime() < new Date(mostRecentScheduledRunAt).getTime();
}

async function ensureVortexDir(rootDir: string) {
  await fs.mkdir(getVortexDir(rootDir), { recursive: true });
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
    console.warn(`Failed to parse nightly archive file at ${filePath}; falling back to defaults.`);
    return null;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

export async function readNightlyArchiveSettings(rootDir: string) {
  const settings = await readJsonFile<Partial<NightlyArchiveSettings>>(getSettingsPath(rootDir));
  return normalizeNightlyArchiveSettings(settings);
}

export async function writeNightlyArchiveSettings(rootDir: string, value: Partial<NightlyArchiveSettings>) {
  const next = normalizeNightlyArchiveSettings(value);
  await ensureVortexDir(rootDir);
  await writeJsonFile(getSettingsPath(rootDir), next);
  return next;
}

export async function readNightlyArchiveState(rootDir: string) {
  const state = await readJsonFile<Partial<NightlyArchiveState>>(getStatePath(rootDir));
  return normalizeNightlyArchiveState(state);
}

export async function writeNightlyArchiveState(rootDir: string, value: Partial<NightlyArchiveState>) {
  const next = normalizeNightlyArchiveState(value);
  await ensureVortexDir(rootDir);
  await writeJsonFile(getStatePath(rootDir), next);
  return next;
}

export async function listAgentSlugsFromMemoryRoot(rootDir: string) {
  const agentsDir = path.resolve(rootDir, 'memory/agents');
  const entries = await fs.readdir(agentsDir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return [] as Array<{ name: string; isDirectory: () => boolean }>;
    }
    throw error;
  });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function createFilesystemAgentMemoryFileStore(rootDir: string): AgentMemoryFileStore {
  return {
    async listPaths(prefix: string) {
      const absolutePrefix = path.resolve(rootDir, prefix);
      const stat = await fs.stat(absolutePrefix).catch(() => null);
      if (!stat) {
        return [];
      }
      if (stat.isFile()) {
        return [prefix.replace(/\\/g, '/')];
      }
      const files = await walkDirectory(absolutePrefix);
      return files
        .filter((filePath) => filePath.endsWith('.md'))
        .map((filePath) => path.relative(rootDir, filePath).replace(/\\/g, '/'))
        .sort();
    },
    async readText(filePath: string) {
      const absolutePath = path.resolve(rootDir, filePath);
      return fs.readFile(absolutePath, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          return null;
        }
        throw error;
      });
    },
    async writeText(filePath: string, content: string) {
      const absolutePath = path.resolve(rootDir, filePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf8');
    },
    async deleteText(filePath: string) {
      const absolutePath = path.resolve(rootDir, filePath);
      await fs.unlink(absolutePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          return;
        }
        throw error;
      });
    },
  };
}

export function createNightlyMemoryArchiveScheduler(options: NightlyMemoryArchiveSchedulerOptions) {
  const rootDir = path.resolve(options.rootDir);
  const now = options.now ?? (() => new Date());
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const logger = options.logger ?? console;
  const listAgentSlugs = options.listAgentSlugs ?? listAgentSlugsFromMemoryRoot;
  const createFileStore = options.createFileStore ?? createFilesystemAgentMemoryFileStore;
  const scoreWithModel = options.scoreImportanceWithModel ?? scoreMemoryImportanceWithModel;
  const runPromotionSync = options.runPromotionSync ?? syncPromotedMemoryFromSurrogates;
  const runLifecycleSync =
    options.runLifecycleSync ??
    (async (input: {
      agentSlug: string;
      fileStore: AgentMemoryFileStore;
      now: string;
      lifecyclePolicy?: MemoryTierPolicy;
      scoreImportance?: (input: {
        date: string;
        tier: 'warm' | 'cold';
        sourcePath: string;
        sourceMarkdown: string;
      }) => Promise<MemoryImportanceAssessment>;
    }) =>
      syncAgentMemoryLifecycleFromStore({
        agentSlug: input.agentSlug,
        fileStore: input.fileStore,
        now: input.now,
        lifecyclePolicy: input.lifecyclePolicy,
        scoreImportance: input.scoreImportance,
      }));

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let started = false;

  function resolveNowDate() {
    const value = now();
    return value instanceof Date ? value : new Date(value);
  }

  async function getStatus(): Promise<NightlyArchiveStatus> {
    const settings = await readNightlyArchiveSettings(rootDir);
    const state = await readNightlyArchiveState(rootDir);
    const currentNow = resolveNowDate();
    const scheduleTime = resolveNightlyArchiveScheduleTime(settings);
    return {
      settings,
      state,
      nextRunAt: settings.enabled ? resolveNextNightlyRunAt({ now: currentNow, scheduleTime }) : null,
      catchUpDue: settings.enabled
        ? shouldRunNightlyCatchup({
            now: currentNow,
            scheduleTime,
            lastAttemptedRunAt: state.lastAttemptedRunAt,
            lastSuccessfulRunAt: state.lastSuccessfulRunAt,
          })
        : false,
      running,
    };
  }

  function clearScheduledRun() {
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
  }

  async function runOnce(trigger: NightlyArchiveRunSummary['trigger']) {
    const runStartedAt = resolveNowDate().toISOString();
    const fileStore = createFileStore(rootDir);
    const agentSlugs = await listAgentSlugs(rootDir);
    const failures: NightlyArchiveRunSummary['failures'] = [];
    let successfulAgents = 0;
    let llmScoredCount = 0;
    let ruleFallbackCount = 0;
    let promotedCount = 0;
    const settings = await readNightlyArchiveSettings(rootDir);
    const projectConfig = await readProjectConfig(rootDir).catch((error) => {
      logger.warn(
        `Nightly archive could not read project config; using default memory lifecycle windows. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    });
    const lifecyclePolicy = projectConfig
      ? {
          hotRetentionDays: projectConfig.memory.hotRetentionDays,
          warmRetentionDays: projectConfig.memory.warmRetentionDays,
          coldRetentionDays: projectConfig.memory.coldRetentionDays,
          coldMaxFiles: projectConfig.memory.coldMaxFiles,
          protectedTopics: projectConfig.memory.protectedTopics,
        }
      : undefined;

    for (const agentSlug of agentSlugs) {
      try {
        const result = await runLifecycleSync({
          agentSlug,
          fileStore,
          now: runStartedAt,
          lifecyclePolicy,
          scoreImportance:
            settings.useLlmScoring && projectConfig
              ? (input) =>
                  scoreWithModel({
                    config: projectConfig,
                    date: input.date,
                    tier: input.tier,
                    sourceMarkdown: input.sourceMarkdown,
                  })
              : undefined,
        });
        llmScoredCount += result.scoring?.llmScoredCount ?? 0;
        ruleFallbackCount += result.scoring?.ruleFallbackCount ?? 0;
        const promotionResult = await runPromotionSync({
          agentSlug,
          fileStore,
          now: runStartedAt,
          promotionThreshold: projectConfig?.memory.promotionScoreThreshold,
        });
        promotedCount += promotionResult.promotedCount;
        if (result.failures.length === 0) {
          successfulAgents += 1;
        } else {
          failures.push(
            ...result.failures.map((failure) => ({
              agentSlug,
              message: failure.message,
            })),
          );
          logger.warn(`Nightly archive completed for ${agentSlug} with ${result.failures.length} lifecycle failures.`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Nightly archive failed.';
        failures.push({ agentSlug, message });
        logger.warn(`Nightly archive failed for ${agentSlug}: ${message}`);
      }
    }

    const summary: NightlyArchiveRunSummary = {
      processedAgents: agentSlugs.length,
      successfulAgents,
      failedAgents: failures.length,
      failures,
      llmScoredCount,
      ruleFallbackCount,
      promotedCount,
      trigger,
      startedAt: runStartedAt,
      completedAt: resolveNowDate().toISOString(),
    };

    await writeNightlyArchiveState(rootDir, {
      lastAttemptedRunAt: summary.completedAt,
      lastSuccessfulRunAt: failures.length === 0 ? summary.completedAt : (await readNightlyArchiveState(rootDir)).lastSuccessfulRunAt,
      lastSuccessfulRunDate:
        failures.length === 0 ? summary.completedAt.slice(0, 10) : (await readNightlyArchiveState(rootDir)).lastSuccessfulRunDate,
      lastRunSummary: summary,
    });

    return summary;
  }

  async function scheduleNextRun() {
    clearScheduledRun();
    const settings = await readNightlyArchiveSettings(rootDir);
    if (!settings.enabled) {
      return;
    }

    const currentNow = resolveNowDate();
    const nextRunAt = new Date(resolveNextNightlyRunAt({ now: currentNow, scheduleTime: resolveNightlyArchiveScheduleTime(settings) }));
    const delay = Math.max(1000, nextRunAt.getTime() - currentNow.getTime());
    timer = setTimer(async () => {
      try {
        running = true;
        await runOnce('scheduled');
      } catch (error) {
        logger.error('Nightly archive scheduled run failed:', error);
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
      const settings = await readNightlyArchiveSettings(rootDir);
      const state = await readNightlyArchiveState(rootDir);
      const scheduleTime = resolveNightlyArchiveScheduleTime(settings);

      if (settings.enabled && shouldRunNightlyCatchup({
        now: resolveNowDate(),
        scheduleTime,
        lastAttemptedRunAt: state.lastAttemptedRunAt,
        lastSuccessfulRunAt: state.lastSuccessfulRunAt,
      })) {
        try {
          running = true;
          await runOnce('catchup');
        } catch (error) {
          logger.error('Nightly archive catch-up run failed:', error);
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
    async updateSettings(value: Partial<NightlyArchiveSettings>) {
      const current = await readNightlyArchiveSettings(rootDir);
      const next = await writeNightlyArchiveSettings(rootDir, {
        ...current,
        ...value,
      });

      if (next.enabled && shouldRunNightlyCatchup({
        now: resolveNowDate(),
        scheduleTime: resolveNightlyArchiveScheduleTime(next),
        lastAttemptedRunAt: (await readNightlyArchiveState(rootDir)).lastAttemptedRunAt,
        lastSuccessfulRunAt: (await readNightlyArchiveState(rootDir)).lastSuccessfulRunAt,
      })) {
        try {
          running = true;
          await runOnce('catchup');
        } catch (error) {
          logger.error('Nightly archive catch-up after settings update failed:', error);
        } finally {
          running = false;
        }
      }

      await scheduleNextRun();
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
