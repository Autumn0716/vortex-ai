import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type { NightlyArchiveRunSummary } from './nightly-memory-archive';

const execFileAsync = promisify(execFile);

export interface CodeReviewRunSummary {
  processedAgents: number;
  successfulAgents: number;
  failedAgents: number;
  failures: Array<{ agentSlug: string; message: string }>;
  changedFiles: string[];
  reviewNotes: string[];
  trigger: NightlyArchiveRunSummary['trigger'];
  startedAt: string;
  completedAt: string;
}

export interface CodeReviewState {
  lastSuccessfulRunAt: string | null;
  lastSuccessfulRunDate: string | null;
  lastAttemptedRunAt: string | null;
  lastRunSummary: CodeReviewRunSummary | null;
}

export interface CodeReviewStatus {
  enabled: boolean;
  schedule: string;
  state: CodeReviewState;
  nextRunAt: string | null;
  catchUpDue: boolean;
  running: boolean;
}

export interface CodeReviewAutomationOptions {
  rootDir: string;
  now?: () => Date | string;
  logger?: Pick<Console, 'warn' | 'error'>;
}

const VORTEX_DIRNAME = '.vortex';
const STATE_FILENAME = 'code-review-state.json';

const DEFAULT_CODE_REVIEW_STATE: CodeReviewState = {
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

function normalizeCodeReviewState(value?: Partial<CodeReviewState> | null): CodeReviewState {
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
    console.warn(`Failed to parse code review state at ${filePath}; falling back to defaults.`);
    return null;
  }
}

export async function readCodeReviewState(rootDir: string) {
  const state = await readJsonFile<Partial<CodeReviewState>>(getStatePath(rootDir));
  return normalizeCodeReviewState(state);
}

async function writeCodeReviewState(rootDir: string, value: Partial<CodeReviewState>) {
  const next = normalizeCodeReviewState(value);
  await ensureStateDir(rootDir);
  await fs.writeFile(getStatePath(rootDir), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function formatLocalDate(input: Date) {
  return `${input.getFullYear()}-${String(input.getMonth() + 1).padStart(2, '0')}-${String(input.getDate()).padStart(2, '0')}`;
}

async function runGit(rootDir: string, args: string[]) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: rootDir,
    maxBuffer: 1024 * 1024,
  });
  return stdout.toString();
}

function parseStatusFiles(statusOutput: string) {
  return statusOutput
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const renamed = line.match(/^.. (.+) -> (.+)$/);
      if (renamed) {
        return renamed[2]!;
      }
      return line.slice(3).trim();
    })
    .filter(Boolean);
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

export function buildCodeReviewNotes(changedFiles: string[]) {
  const notes: string[] = [];
  const codeFiles = changedFiles.filter((filePath) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs)$/i.test(filePath));
  const testFiles = changedFiles.filter((filePath) => /(^|\/)(tests?|__tests__)\/|\.test\.|\.spec\./i.test(filePath));
  const configFiles = changedFiles.filter((filePath) => /(package\.json|package-lock\.json|vite\.config|tsconfig|electron\/|server\/)/i.test(filePath));

  if (changedFiles.length === 0) {
    notes.push('No changed files detected for review.');
  }
  if (codeFiles.length > 0 && testFiles.length === 0) {
    notes.push('Code files changed without matching test file changes; verify coverage manually.');
  }
  if (configFiles.length > 0) {
    notes.push('Runtime or dependency configuration changed; run lint/build and relevant smoke tests before pushing.');
  }
  if (changedFiles.some((filePath) => filePath.endsWith('todo-list.md'))) {
    notes.push('todo-list.md changed; keep it local unless the change is intentionally versioned.');
  }
  if (notes.length === 0) {
    notes.push('Changed files include tests or low-risk documentation-only updates.');
  }

  return notes;
}

export function createCodeReviewAutomation(options: CodeReviewAutomationOptions) {
  const rootDir = path.resolve(options.rootDir);
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? console;
  let running = false;

  function resolveNowDate() {
    const value = now();
    return value instanceof Date ? value : new Date(value);
  }

  async function getStatus(): Promise<CodeReviewStatus> {
    return {
      enabled: true,
      schedule: 'git pre-push / 手动',
      state: await readCodeReviewState(rootDir),
      nextRunAt: null,
      catchUpDue: false,
      running,
    };
  }

  async function runOnce(trigger: CodeReviewRunSummary['trigger']) {
    const startedAt = resolveNowDate().toISOString();
    const failures: CodeReviewRunSummary['failures'] = [];
    let changedFiles: string[] = [];

    try {
      changedFiles = uniqueSorted(parseStatusFiles(await runGit(rootDir, ['status', '--short', '--untracked-files=all'])));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to inspect git status.';
      failures.push({ agentSlug: 'code-review', message });
      logger.warn(`Code review automation failed: ${message}`);
    }

    const completedAt = resolveNowDate().toISOString();
    const summary: CodeReviewRunSummary = {
      processedAgents: changedFiles.length,
      successfulAgents: failures.length === 0 ? 1 : 0,
      failedAgents: failures.length,
      failures,
      changedFiles,
      reviewNotes: failures.length === 0 ? buildCodeReviewNotes(changedFiles) : [],
      trigger,
      startedAt,
      completedAt,
    };

    const currentState = await readCodeReviewState(rootDir);
    await writeCodeReviewState(rootDir, {
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
    async runNow(trigger: CodeReviewRunSummary['trigger'] = 'manual') {
      try {
        running = true;
        await runOnce(trigger);
      } finally {
        running = false;
      }
      return getStatus();
    },
  };
}
