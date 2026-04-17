import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import {
  createAgentTaskAutomation,
  readAgentTaskState,
} from '../server/agent-task-automation';

const tempRoots: string[] = [];

after(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function createTempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'flowagent-agent-task-'));
  tempRoots.push(root);
  return root;
}

test('agent task automation appends parameterized work to the agent daily log', async () => {
  const rootDir = await createTempRoot();
  const automation = createAgentTaskAutomation({
    rootDir,
    now: () => '2026-04-17T08:30:00.000Z',
    logger: {
      warn() {},
      error() {},
    },
  });

  const status = await automation.runNow('manual', {
    agentSlug: 'core',
    instruction: '整理昨天的 RAG 质量评分。',
  });
  const state = await readAgentTaskState(rootDir);
  const daily = await readFile(path.join(rootDir, 'memory/agents/core/daily/2026-04-17.md'), 'utf8');

  assert.equal(status.state.lastRunSummary?.agentSlug, 'core');
  assert.equal(status.state.lastRunSummary?.failedAgents, 0);
  assert.equal(state.lastSuccessfulRunDate, '2026-04-17');
  assert.match(daily, /Task State: queued/);
  assert.match(daily, /整理昨天的 RAG 质量评分/);
});

test('agent task automation rejects empty instructions', async () => {
  const rootDir = await createTempRoot();
  const automation = createAgentTaskAutomation({
    rootDir,
    now: () => '2026-04-17T08:30:00.000Z',
  });

  await assert.rejects(() => automation.runNow('manual', { agentSlug: 'core', instruction: '' }), /instruction is required/);
});
