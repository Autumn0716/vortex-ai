import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { createProjectKnowledgeWatcher } from '../server/project-knowledge-store';

const tempRoots: string[] = [];

after(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function createTempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'flowagent-project-watch-'));
  tempRoots.push(root);
  return root;
}

test('project knowledge watcher emits updates when root docs or root skills change', async () => {
  const rootDir = await createTempRoot();
  await mkdir(path.join(rootDir, 'skills/debugging'), { recursive: true });
  await writeFile(path.join(rootDir, 'README.md'), '# Start\n\ninitial', 'utf8');
  await writeFile(path.join(rootDir, 'skills/debugging/SKILL.md'), '# Skill\n\ninitial', 'utf8');

  const watcher = createProjectKnowledgeWatcher(rootDir);
  const initial = await watcher.ready;
  const updates: string[] = [];

  const completion = new Promise<void>((resolve) => {
    const unsubscribe = watcher.subscribe((status) => {
      updates.push(status.version);
      if (updates.length >= 2) {
        unsubscribe();
        resolve();
      }
    });
  });

  await writeFile(path.join(rootDir, 'skills/debugging/SKILL.md'), '# Skill\n\nchanged', 'utf8');
  await completion;

  assert.equal(initial.documentCount, 2);
  assert.ok(updates.length >= 2);
  assert.notEqual(updates[0], updates[updates.length - 1]);
  watcher.stop();
});
