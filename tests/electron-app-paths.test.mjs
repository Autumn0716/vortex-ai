import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveElectronConfigImportSource, resolveElectronProjectRoot } from '../electron/app-paths.mjs';

const tempRoots = [];

test.after(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function createTempRoot(prefix) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

test('resolveElectronProjectRoot uses userData workspace in packaged mode', () => {
  const app = {
    isPackaged: true,
    getPath(name) {
      assert.equal(name, 'userData');
      return '/tmp/flowagent-userdata';
    },
  };

  assert.equal(
    resolveElectronProjectRoot(app, '/repo/source'),
    path.join('/tmp/flowagent-userdata', 'workspace'),
  );
});

test('resolveElectronConfigImportSource prefers explicit env, then cwd, then sourceRoot', async () => {
  const root = await createTempRoot('flowagent-electron-paths-');
  const explicitDir = path.join(root, 'explicit');
  const cwdDir = path.join(root, 'cwd');
  const sourceDir = path.join(root, 'source');
  await Promise.all([mkdir(explicitDir, { recursive: true }), mkdir(cwdDir, { recursive: true }), mkdir(sourceDir, { recursive: true })]);

  const explicitConfig = path.join(explicitDir, 'config.json');
  const cwdConfig = path.join(cwdDir, 'config.json');
  const sourceConfig = path.join(sourceDir, 'config.json');
  await writeFile(explicitConfig, '{}', 'utf8');
  await writeFile(cwdConfig, '{}', 'utf8');
  await writeFile(sourceConfig, '{}', 'utf8');

  const app = {
    isPackaged: true,
  };

  assert.equal(
    resolveElectronConfigImportSource(app, sourceDir, {
      cwd: cwdDir,
      env: {
        FLOWAGENT_DESKTOP_IMPORT_CONFIG: explicitConfig,
      },
    }),
    explicitConfig,
  );

  assert.equal(
    resolveElectronConfigImportSource(app, sourceDir, {
      cwd: cwdDir,
      env: {},
    }),
    cwdConfig,
  );

  await rm(cwdConfig, { force: true });
  assert.equal(
    resolveElectronConfigImportSource(app, sourceDir, {
      cwd: cwdDir,
      env: {},
    }),
    sourceConfig,
  );
});
