import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, test } from 'node:test';

import {
  createNightlyMemoryArchiveScheduler,
  readNightlyArchiveSettings,
  readNightlyArchiveState,
  resolveNextNightlyRunAt,
  shouldRunNightlyCatchup,
  validateNightlyArchiveTime,
  writeNightlyArchiveSettings,
  writeNightlyArchiveState,
  type NightlyArchiveSettings,
} from '../server/nightly-memory-archive';
import { type AgentMemoryFileStore } from '../src/lib/agent-memory-sync';

const tempRoots: string[] = [];

after(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function createTempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'flowagent-nightly-'));
  tempRoots.push(root);
  return root;
}

function formatLocalDate(input: string | Date) {
  const date = new Date(input);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

class InMemoryNightlyFileStore implements AgentMemoryFileStore {
  writes: string[] = [];
  deletes: string[] = [];

  constructor(private readonly files = new Map<string, string>()) {}

  async listPaths(prefix: string) {
    return [...this.files.keys()].filter((filePath) => filePath.startsWith(prefix)).sort();
  }

  async readText(filePath: string) {
    return this.files.get(filePath) ?? null;
  }

  async writeText(filePath: string, content: string) {
    this.writes.push(filePath);
    this.files.set(filePath, content);
  }

  async deleteText(filePath: string) {
    this.deletes.push(filePath);
    this.files.delete(filePath);
  }
}

test('validateNightlyArchiveTime accepts stable HH:MM values and rejects invalid inputs', () => {
  assert.equal(validateNightlyArchiveTime('03:00'), '03:00');
  assert.throws(() => validateNightlyArchiveTime('3:00'), /HH:MM/);
  assert.throws(() => validateNightlyArchiveTime('24:00'), /out of range/);
});

test('resolveNextNightlyRunAt and shouldRunNightlyCatchup use the configured local schedule', () => {
  const now = '2026-04-02T10:00:00.000Z';
  const nextRunAt = resolveNextNightlyRunAt({ now, scheduleTime: '03:00' });
  const nextDate = new Date(nextRunAt);

  assert.equal(nextDate.getHours(), 3);
  assert.equal(nextDate.getMinutes(), 0);
  assert.ok(nextDate.getTime() > new Date(now).getTime());

  assert.equal(
    shouldRunNightlyCatchup({
      now,
      scheduleTime: '03:00',
      lastSuccessfulRunAt: '2026-04-01T00:00:00.000Z',
    }),
    true,
  );
  assert.equal(
    shouldRunNightlyCatchup({
      now,
      scheduleTime: '03:00',
      lastSuccessfulRunAt: now,
    }),
    false,
  );
});

test('readNightlyArchiveState and readNightlyArchiveSettings return defaults when files are missing', async () => {
  const rootDir = await createTempRoot();

  assert.deepEqual(await readNightlyArchiveState(rootDir), {
    lastSuccessfulRunAt: null,
    lastSuccessfulRunDate: null,
    lastAttemptedRunAt: null,
    lastRunSummary: null,
  });
  assert.deepEqual(await readNightlyArchiveSettings(rootDir), {
    enabled: false,
    time: '03:00',
    useLlmScoring: false,
  });
});

test('readNightlyArchiveState and readNightlyArchiveSettings warn and return defaults when files are malformed', async () => {
  const rootDir = await createTempRoot();
  await mkdir(path.join(rootDir, '.flowagent'), { recursive: true });
  await writeFile(path.join(rootDir, '.flowagent/nightly-memory-archive-settings.json'), '{"enabled": ', 'utf8');
  await writeFile(path.join(rootDir, '.flowagent/nightly-memory-archive-state.json'), '{"lastSuccessfulRunAt": ', 'utf8');

  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (message?: unknown) => {
    warnings.push(String(message ?? ''));
  };

  try {
    assert.deepEqual(await readNightlyArchiveSettings(rootDir), {
      enabled: false,
      time: '03:00',
      useLlmScoring: false,
    });
    assert.deepEqual(await readNightlyArchiveState(rootDir), {
      lastSuccessfulRunAt: null,
      lastSuccessfulRunDate: null,
      lastAttemptedRunAt: null,
      lastRunSummary: null,
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 2);
  assert.match(warnings[0] ?? '', /Failed to parse nightly archive file at/);
  assert.match(warnings[0] ?? '', /nightly-memory-archive-settings\.json/);
  assert.match(warnings[1] ?? '', /nightly-memory-archive-state\.json/);
});

test('writeNightlyArchiveSettings and writeNightlyArchiveState persist project-local .flowagent files', async () => {
  const rootDir = await createTempRoot();
  const settings: NightlyArchiveSettings = { enabled: false, time: '04:15', useLlmScoring: true };

  await writeNightlyArchiveSettings(rootDir, settings);
  await writeNightlyArchiveState(rootDir, {
    lastSuccessfulRunAt: '2026-04-01T03:00:00.000Z',
    lastSuccessfulRunDate: '2026-04-01',
    lastAttemptedRunAt: '2026-04-01T03:00:00.000Z',
    lastRunSummary: null,
  });

  assert.deepEqual(await readNightlyArchiveSettings(rootDir), settings);
  assert.deepEqual(await readNightlyArchiveState(rootDir), {
    lastSuccessfulRunAt: '2026-04-01T03:00:00.000Z',
    lastSuccessfulRunDate: '2026-04-01',
    lastAttemptedRunAt: '2026-04-01T03:00:00.000Z',
    lastRunSummary: null,
  });

  assert.match(await readFile(path.join(rootDir, '.flowagent/nightly-memory-archive-settings.json'), 'utf8'), /"time": "04:15"/);
});

test('nightly scheduler startup catch-up generates warm and cold surrogates from file-backed agent directories', async () => {
  const rootDir = await createTempRoot();
  await mkdir(path.join(rootDir, 'memory/agents/alpha/daily'), { recursive: true });
  await mkdir(path.join(rootDir, 'memory/agents/beta/daily'), { recursive: true });

  await writeFile(
    path.join(rootDir, 'memory/agents/alpha/daily/2026-04-10.md'),
    '# Alpha\n\n- TODO finish warm summary.',
    'utf8',
  );
  await writeFile(
    path.join(rootDir, 'memory/agents/beta/daily/2026-03-01.md'),
    '# Beta\n\n- TODO archive this colder file.',
    'utf8',
  );
  await writeNightlyArchiveState(rootDir, {
    lastSuccessfulRunAt: '2026-04-01T00:00:00.000Z',
    lastSuccessfulRunDate: '2026-04-01',
    lastAttemptedRunAt: '2026-04-01T00:00:00.000Z',
    lastRunSummary: null,
  });
  await writeNightlyArchiveSettings(rootDir, {
    enabled: true,
    time: '03:00',
    useLlmScoring: false,
  });

  const scheduler = createNightlyMemoryArchiveScheduler({
    rootDir,
    now: () => '2026-04-20T12:00:00.000Z',
  });
  await scheduler.start();

  const alphaWarm = await readFile(path.join(rootDir, 'memory/agents/alpha/daily/2026-04-10.warm.md'), 'utf8');
  const betaCold = await readFile(path.join(rootDir, 'memory/agents/beta/daily/2026-03-01.cold.md'), 'utf8');
  const status = await scheduler.getStatus();

  assert.match(alphaWarm, /tier: "warm"/);
  assert.match(betaCold, /tier: "cold"/);
  assert.equal(status.state.lastSuccessfulRunAt !== null, true);
  assert.equal(status.state.lastRunSummary?.failedAgents ?? 1, 0);
  assert.equal(status.state.lastRunSummary?.promotedCount ?? 0, 0);
  assert.equal(status.state.lastRunSummary?.llmScoredCount ?? 0, 0);
  assert.equal(status.state.lastRunSummary?.ruleFallbackCount ?? 0, 0);
  assert.equal(status.catchUpDue, false);
  assert.equal(status.nextRunAt !== null, true);
});

test('nightly scheduler continues when one agent fails and still processes the others', async () => {
  const rootDir = await createTempRoot();
  const fileStore = new InMemoryNightlyFileStore(
    new Map([
      ['memory/agents/good/daily/2026-04-10.md', '# Good\n\n- TODO keep going.'],
      ['memory/agents/bad/daily/2026-04-10.md', '# Bad\n\n- TODO trigger a failure.'],
    ]),
  );

  const scheduler = createNightlyMemoryArchiveScheduler({
    rootDir,
    now: () => '2026-04-20T12:00:00.000Z',
    createFileStore: () => fileStore,
    listAgentSlugs: async () => ['good', 'bad'],
  });

  await writeNightlyArchiveSettings(rootDir, {
    enabled: false,
    time: '03:00',
    useLlmScoring: false,
  });

  const badStore = fileStore as InMemoryNightlyFileStore;
  const originalListPaths = badStore.listPaths.bind(badStore);
  badStore.listPaths = async (prefix: string) => {
    if (prefix.includes('/bad/')) {
      throw new Error('bad agent failed');
    }
    return originalListPaths(prefix);
  };

  const status = await scheduler.runNow();

  assert.equal(status.state.lastRunSummary?.processedAgents, 2);
  assert.equal(status.state.lastRunSummary?.failedAgents, 1);
  assert.ok(status.state.lastRunSummary?.failures.some((failure) => failure.agentSlug === 'bad'));
  assert.match((await badStore.readText('memory/agents/good/daily/2026-04-10.warm.md')) ?? '', /tier: "warm"/);
  assert.equal(await badStore.readText('memory/agents/bad/daily/2026-04-10.warm.md'), null);
});

test('nightly scheduler promotes reusable memory entries into MEMORY.md', async () => {
  const rootDir = await createTempRoot();
  await mkdir(path.join(rootDir, 'memory/agents/core/daily'), { recursive: true });
  await writeFile(
    path.join(rootDir, 'memory/agents/core/daily/2026-04-10.md'),
    '# Core\n\n- 记住：言简意赅，避免免责声明。',
    'utf8',
  );
  await writeNightlyArchiveSettings(rootDir, {
    enabled: true,
    time: '03:00',
    useLlmScoring: false,
  });

  const scheduler = createNightlyMemoryArchiveScheduler({
    rootDir,
    now: () => '2026-04-20T12:00:00.000Z',
  });
  await scheduler.start();

  const memoryMarkdown = await readFile(path.join(rootDir, 'memory/agents/core/MEMORY.md'), 'utf8');
  const status = await scheduler.getStatus();

  assert.match(memoryMarkdown, /## Learned Patterns/);
  assert.match(memoryMarkdown, /### Behavioral Patterns/);
  assert.match(memoryMarkdown, /- 言简意赅，避免免责声明。/);
  assert.equal((status.state.lastRunSummary?.promotedCount ?? 0) >= 1, true);
});
