import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { walkDirectory } from '../server/lib/fs-utils';

test('walkDirectory returns nested files without directory entries', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'vortex-fs-utils-'));
  await mkdir(path.join(rootDir, 'nested/deeper'), { recursive: true });
  await writeFile(path.join(rootDir, 'root.md'), 'root', 'utf8');
  await writeFile(path.join(rootDir, 'nested/child.md'), 'child', 'utf8');
  await writeFile(path.join(rootDir, 'nested/deeper/grandchild.txt'), 'grandchild', 'utf8');

  const relativePaths = (await walkDirectory(rootDir))
    .map((filePath) => path.relative(rootDir, filePath).replace(/\\/g, '/'))
    .sort();

  assert.deepEqual(relativePaths, ['nested/child.md', 'nested/deeper/grandchild.txt', 'root.md']);
});
