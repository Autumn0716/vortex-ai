import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import {
  createWeeklyArchiveScheduler,
  readWeeklyArchiveState,
  resolveNextWeeklyArchiveRunAt,
  shouldRunWeeklyArchiveCatchup,
} from '../server/weekly-archive-automation';
import type { NightlyArchiveRunSummary, NightlyArchiveStatus } from '../server/nightly-memory-archive';

const tempRoots: string[] = [];

after(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function createTempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'flowagent-weekly-archive-'));
  tempRoots.push(root);
  return root;
}

function buildArchiveStatus(trigger: NightlyArchiveRunSummary['trigger']): NightlyArchiveStatus {
  const summary: NightlyArchiveRunSummary = {
    processedAgents: 2,
    successfulAgents: 2,
    failedAgents: 0,
    failures: [],
    llmScoredCount: 1,
    ruleFallbackCount: 1,
    promotedCount: 3,
    trigger,
    startedAt: '2026-04-19T04:00:00.000Z',
    completedAt: '2026-04-19T04:00:01.000Z',
  };
  return {
    settings: {
      enabled: true,
      time: '03:00',
      cronExpression: null,
      useLlmScoring: false,
    },
    state: {
      lastSuccessfulRunAt: summary.completedAt,
      lastSuccessfulRunDate: '2026-04-19',
      lastAttemptedRunAt: summary.completedAt,
      lastRunSummary: summary,
    },
    nextRunAt: null,
    catchUpDue: false,
    running: false,
  };
}

test('resolveNextWeeklyArchiveRunAt targets the next local Sunday 04:00', () => {
  const fridayNext = new Date(resolveNextWeeklyArchiveRunAt('2026-04-17T12:00:00.000Z'));
  assert.equal(fridayNext.getDay(), 0);
  assert.equal(fridayNext.getHours(), 4);
  assert.equal(fridayNext.getMinutes(), 0);

  const sundayAfter = new Date(resolveNextWeeklyArchiveRunAt('2026-04-19T05:00:00.000Z'));
  assert.equal(sundayAfter.getDay(), 0);
  assert.equal(sundayAfter.getHours(), 4);
  assert.ok(sundayAfter.getTime() > new Date('2026-04-19T05:00:00.000Z').getTime());
});

test('shouldRunWeeklyArchiveCatchup compares against the most recent Sunday run slot', () => {
  assert.equal(shouldRunWeeklyArchiveCatchup({ now: '2026-04-20T12:00:00.000Z' }), true);
  assert.equal(
    shouldRunWeeklyArchiveCatchup({
      now: '2026-04-20T12:00:00.000Z',
      lastSuccessfulRunAt: '2026-04-19T04:30:00.000Z',
    }),
    false,
  );
  assert.equal(
    shouldRunWeeklyArchiveCatchup({
      now: '2026-04-20T12:00:00.000Z',
      lastSuccessfulRunAt: '2026-04-12T04:30:00.000Z',
    }),
    true,
  );
});

test('weekly archive scheduler persists the wrapped nightly archive summary', async () => {
  const rootDir = await createTempRoot();
  const triggers: NightlyArchiveRunSummary['trigger'][] = [];
  const scheduler = createWeeklyArchiveScheduler({
    rootDir,
    now: () => '2026-04-20T12:00:00.000Z',
    runArchive: async (trigger) => {
      triggers.push(trigger);
      return buildArchiveStatus(trigger);
    },
    logger: {
      warn() {},
      error() {},
    },
  });

  const status = await scheduler.runNow('manual');
  const state = await readWeeklyArchiveState(rootDir);
  scheduler.stop();

  assert.deepEqual(triggers, ['manual']);
  assert.equal(status.state.lastRunSummary?.processedAgents, 2);
  assert.equal(state.lastRunSummary?.promotedCount, 3);
  assert.equal(status.catchUpDue, false);
});
