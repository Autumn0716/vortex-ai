import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import {
  exportAgentPackage,
  importAgentPackage,
} from '../server/agent-package-store';

const tempRoots: string[] = [];

after(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function createTempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'vortex-package-'));
  tempRoots.push(root);
  return root;
}

test('exportAgentPackage bundles config, agent memory markdown, and shared skills', async () => {
  const rootDir = await createTempRoot();
  await mkdir(path.join(rootDir, 'memory/agents/core/daily'), { recursive: true });
  await mkdir(path.join(rootDir, 'skills/review'), { recursive: true });
  await writeFile(path.join(rootDir, 'memory/agents/core/MEMORY.md'), '# Memory\n', 'utf8');
  await writeFile(path.join(rootDir, 'memory/agents/core/daily/2026-04-16.md'), '- Daily\n', 'utf8');
  await writeFile(path.join(rootDir, 'skills/review/SKILL.md'), '# Review Skill\n', 'utf8');

  const packageData = await exportAgentPackage({
    rootDir,
    agentSlug: 'core',
    now: '2026-04-16T10:00:00.000Z',
  });

  assert.equal(packageData.format, 'vortex.package');
  assert.equal(packageData.agentSlug, 'core');
  assert.equal(packageData.exportedAt, '2026-04-16T10:00:00.000Z');
  assert.deepEqual(
    packageData.memoryFiles.map((file) => file.path),
    ['memory/agents/core/daily/2026-04-16.md', 'memory/agents/core/MEMORY.md'],
  );
  assert.deepEqual(packageData.skillFiles.map((file) => file.path), ['skills/review/SKILL.md']);
});

test('importAgentPackage rewrites memory files to the target agent slug', async () => {
  const rootDir = await createTempRoot();
  const sourcePackage = await exportAgentPackage({
    rootDir,
    agentSlug: 'source',
    now: '2026-04-16T10:00:00.000Z',
  });
  sourcePackage.memoryFiles = [
    {
      path: 'memory/agents/source/MEMORY.md',
      content: '# Imported Memory\n',
    },
  ];
  sourcePackage.skillFiles = [
    {
      path: 'skills/imported/SKILL.md',
      content: '# Imported Skill\n',
    },
  ];

  const result = await importAgentPackage({
    rootDir,
    packageData: sourcePackage,
    targetAgentSlug: 'clone',
  });

  assert.equal(result.agentSlug, 'clone');
  assert.equal(result.memoryFileCount, 1);
  assert.equal(result.skillFileCount, 1);
  assert.equal(await readFile(path.join(rootDir, 'memory/agents/clone/MEMORY.md'), 'utf8'), '# Imported Memory\n');
  assert.equal(await readFile(path.join(rootDir, 'skills/imported/SKILL.md'), 'utf8'), '# Imported Skill\n');
});

test('importAgentPackage rejects unsafe paths', async () => {
  const rootDir = await createTempRoot();
  const packageData = await exportAgentPackage({ rootDir, agentSlug: 'source' });
  packageData.memoryFiles = [
    {
      path: 'memory/agents/source/../../evil.md',
      content: 'bad',
    },
  ];

  await assert.rejects(
    () => importAgentPackage({ rootDir, packageData }),
    /Invalid package file path/,
  );
});
