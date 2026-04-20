import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { NightlyArchiveRunSummary } from './nightly-memory-archive';

export interface AgentTaskRunSummary {
  processedAgents: number;
  successfulAgents: number;
  failedAgents: number;
  failures: Array<{ agentSlug: string; message: string }>;
  taskId: string;
  agentSlug: string;
  instruction: string;
  trigger: NightlyArchiveRunSummary['trigger'];
  startedAt: string;
  completedAt: string;
}

export interface AgentTaskState {
  lastSuccessfulRunAt: string | null;
  lastSuccessfulRunDate: string | null;
  lastAttemptedRunAt: string | null;
  lastRunSummary: AgentTaskRunSummary | null;
}

export interface AgentTaskStatus {
  enabled: boolean;
  schedule: string;
  state: AgentTaskState;
  nextRunAt: string | null;
  catchUpDue: boolean;
  running: boolean;
}

export interface AgentTaskAutomationOptions {
  rootDir: string;
  now?: () => Date | string;
  logger?: Pick<Console, 'warn' | 'error'>;
}

export interface AgentTaskRunRequest {
  agentSlug?: string;
  instruction?: string;
}

const VORTEX_DIRNAME = '.vortex';
const STATE_FILENAME = 'agent-task-state.json';

const DEFAULT_AGENT_TASK_STATE: AgentTaskState = {
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

function normalizeAgentSlug(input?: string) {
  const normalized = (input ?? '').trim() || 'vortex-core';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(normalized)) {
    throw new Error('Agent slug must use letters, numbers, underscores, or hyphens.');
  }
  return normalized;
}

function normalizeInstruction(input?: string) {
  const instruction = (input ?? '').trim();
  if (!instruction) {
    throw new Error('Agent task instruction is required.');
  }
  if (instruction.length > 4000) {
    throw new Error('Agent task instruction is too long.');
  }
  return instruction;
}

function normalizeAgentTaskState(value?: Partial<AgentTaskState> | null): AgentTaskState {
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
    console.warn(`Failed to parse agent task state at ${filePath}; falling back to defaults.`);
    return null;
  }
}

export async function readAgentTaskState(rootDir: string) {
  const state = await readJsonFile<Partial<AgentTaskState>>(getStatePath(rootDir));
  return normalizeAgentTaskState(state);
}

async function writeAgentTaskState(rootDir: string, value: Partial<AgentTaskState>) {
  const next = normalizeAgentTaskState(value);
  await ensureStateDir(rootDir);
  await fs.writeFile(getStatePath(rootDir), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function formatLocalDate(input: Date) {
  return `${input.getFullYear()}-${String(input.getMonth() + 1).padStart(2, '0')}-${String(input.getDate()).padStart(2, '0')}`;
}

function formatLocalTime(input: Date) {
  return `${String(input.getHours()).padStart(2, '0')}:${String(input.getMinutes()).padStart(2, '0')}`;
}

function buildTaskId(now: Date) {
  return `agent_task_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildDailyTaskEntry(input: {
  taskId: string;
  now: Date;
  instruction: string;
}) {
  return [
    `- [${formatLocalTime(input.now)}] System: 自动化任务已入队。`,
    `  Turn: system_event`,
    `  Task State: queued`,
    `  Task ID: ${input.taskId}`,
    `  Instruction: ${input.instruction.replace(/\s+/g, ' ')}`,
  ].join('\n');
}

export function createAgentTaskAutomation(options: AgentTaskAutomationOptions) {
  const rootDir = path.resolve(options.rootDir);
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? console;
  let running = false;

  function resolveNowDate() {
    const value = now();
    return value instanceof Date ? value : new Date(value);
  }

  async function getStatus(): Promise<AgentTaskStatus> {
    return {
      enabled: true,
      schedule: '参数化手动触发',
      state: await readAgentTaskState(rootDir),
      nextRunAt: null,
      catchUpDue: false,
      running,
    };
  }

  async function runOnce(trigger: AgentTaskRunSummary['trigger'], request?: AgentTaskRunRequest) {
    const startedAtDate = resolveNowDate();
    const startedAt = startedAtDate.toISOString();
    const completedAtDate = resolveNowDate();
    const agentSlug = normalizeAgentSlug(request?.agentSlug);
    const instruction = normalizeInstruction(request?.instruction);
    const taskId = buildTaskId(startedAtDate);
    const failures: AgentTaskRunSummary['failures'] = [];

    try {
      const dailyDate = formatLocalDate(startedAtDate);
      const dailyPath = path.join(rootDir, 'memory', 'agents', agentSlug, 'daily', `${dailyDate}.md`);
      await fs.mkdir(path.dirname(dailyPath), { recursive: true });
      await fs.appendFile(dailyPath, `${buildDailyTaskEntry({ taskId, now: startedAtDate, instruction })}\n`, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to queue agent task.';
      failures.push({ agentSlug, message });
      logger.warn(`Agent task automation failed: ${message}`);
    }

    const completedAt = completedAtDate.toISOString();
    const summary: AgentTaskRunSummary = {
      processedAgents: 1,
      successfulAgents: failures.length === 0 ? 1 : 0,
      failedAgents: failures.length,
      failures,
      taskId,
      agentSlug,
      instruction,
      trigger,
      startedAt,
      completedAt,
    };

    const currentState = await readAgentTaskState(rootDir);
    await writeAgentTaskState(rootDir, {
      lastAttemptedRunAt: completedAt,
      lastSuccessfulRunAt: failures.length === 0 ? completedAt : currentState.lastSuccessfulRunAt,
      lastSuccessfulRunDate: failures.length === 0 ? formatLocalDate(new Date(completedAt)) : currentState.lastSuccessfulRunDate,
      lastRunSummary: summary,
    });

    return summary;
  }

  return {
    stop() {},
    async getStatus() {
      return getStatus();
    },
    async runNow(trigger: AgentTaskRunSummary['trigger'] = 'manual', request?: AgentTaskRunRequest) {
      try {
        running = true;
        await runOnce(trigger, request);
      } finally {
        running = false;
      }
      return getStatus();
    },
  };
}
