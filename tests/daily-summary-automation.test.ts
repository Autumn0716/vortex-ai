import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import {
  buildDailySummaryBlock,
  createDailySummaryScheduler,
  resolveDailySummaryTargetDate,
  stripDailySummaryBlock,
  upsertDailySummaryBlock,
} from '../server/daily-summary-automation';

const tempRoots: string[] = [];

after(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function createTempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'flowagent-daily-summary-'));
  tempRoots.push(root);
  return root;
}

test('daily summary block is deterministic and replaceable', () => {
  const sourceMarkdown = [
    '- [09:00] You: 需要继续做自动化。',
    '- [09:30] Assistant: 已完成 cron 设置。',
    '- [10:00] TODO 接入昨日会话摘要。',
  ].join('\n');

  const first = upsertDailySummaryBlock({
    date: '2026-04-15',
    sourceMarkdown,
    now: '2026-04-16T08:00:00.000Z',
  });
  const second = upsertDailySummaryBlock({
    date: '2026-04-15',
    sourceMarkdown: first,
    now: '2026-04-16T09:00:00.000Z',
  });

  assert.match(buildDailySummaryBlock({ date: '2026-04-15', sourceMarkdown, now: '2026-04-16T08:00:00.000Z' }), /Summary:/);
  assert.equal((second.match(/flowagent:daily-summary:start/g) ?? []).length, 1);
  assert.equal(stripDailySummaryBlock(second).includes('Auto Daily Summary'), false);
  assert.match(second, /TODO 接入昨日会话摘要/);
});

test('daily summary scheduler writes yesterday summary and catch-up state', async () => {
  const rootDir = await createTempRoot();
  await mkdir(path.join(rootDir, 'memory/agents/core/daily'), { recursive: true });
  await writeFile(
    path.join(rootDir, 'memory/agents/core/daily/2026-04-15.md'),
    '- [09:00] You: 需要继续做自动化。\n- [10:00] TODO 接入昨日会话摘要。',
    'utf8',
  );

  const scheduler = createDailySummaryScheduler({
    rootDir,
    now: () => '2026-04-16T09:00:00.000Z',
    logger: {
      warn() {},
      error() {},
    },
  });
  await scheduler.start();

  const dailyFile = await readFile(path.join(rootDir, 'memory/agents/core/daily/2026-04-15.md'), 'utf8');
  const status = await scheduler.getStatus();

  scheduler.stop();
  assert.equal(resolveDailySummaryTargetDate('2026-04-16T09:00:00.000Z'), '2026-04-15');
  assert.match(dailyFile, /flowagent:daily-summary:start/);
  assert.equal(status.state.lastRunSummary?.targetDate, '2026-04-15');
  assert.equal(status.state.lastRunSummary?.updatedFiles, 1);
  assert.equal(status.catchUpDue, false);
});
