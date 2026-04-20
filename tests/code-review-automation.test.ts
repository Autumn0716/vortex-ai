import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { promisify } from 'node:util';

import {
  buildCodeReviewNotes,
  createCodeReviewAutomation,
  readCodeReviewState,
} from '../server/code-review-automation';

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];

after(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function createTempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'vortex-code-review-'));
  tempRoots.push(root);
  return root;
}

test('buildCodeReviewNotes flags code changes without tests', () => {
  assert.deepEqual(buildCodeReviewNotes(['src/app.ts']), [
    'Code files changed without matching test file changes; verify coverage manually.',
  ]);
  assert.ok(buildCodeReviewNotes(['src/app.ts', 'tests/app.test.ts']).some((note) => /low-risk|tests/i.test(note)));
  assert.ok(buildCodeReviewNotes(['todo-list.md']).some((note) => note.includes('todo-list.md')));
});

test('code review automation records git status files and notes', async () => {
  const rootDir = await createTempRoot();
  await execFileAsync('git', ['init'], { cwd: rootDir });
  await mkdir(path.join(rootDir, 'src'), { recursive: true });
  await writeFile(path.join(rootDir, 'src/app.ts'), 'export const value = 1;\n', 'utf8');

  const automation = createCodeReviewAutomation({
    rootDir,
    now: () => '2026-04-16T10:00:00.000Z',
    logger: {
      warn() {},
      error() {},
    },
  });
  const status = await automation.runNow('manual');
  const state = await readCodeReviewState(rootDir);

  assert.equal(status.state.lastRunSummary?.trigger, 'manual');
  assert.deepEqual(status.state.lastRunSummary?.changedFiles, ['src/app.ts']);
  assert.match(status.state.lastRunSummary?.reviewNotes.join('\n') ?? '', /without matching test/);
  assert.equal(state.lastSuccessfulRunDate, '2026-04-16');
});
