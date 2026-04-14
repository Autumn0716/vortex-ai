import test from 'node:test';
import assert from 'node:assert/strict';

import { WEB_RUNTIME_CAPABILITIES, createRuntimeCapabilityProfile } from '../src/lib/runtime-capabilities';

test('createRuntimeCapabilityProfile returns web defaults when desktop info is missing', () => {
  assert.deepEqual(createRuntimeCapabilityProfile(null), WEB_RUNTIME_CAPABILITIES);
});

test('createRuntimeCapabilityProfile exposes desktop config path metadata', () => {
  const profile = createRuntimeCapabilityProfile({
    mode: 'electron',
    platform: 'darwin',
    versions: {
      electron: '41.1.1',
      chrome: '141.0.0.0',
      node: '25.8.2',
    },
    capabilities: {
      hostBridge: true,
      projectFiles: true,
      configFiles: true,
      memoryFiles: true,
      webContainerSandbox: true,
      hostShell: false,
      unrestrictedFilesystem: false,
    },
    host: {
      managed: true,
      status: 'ready',
      url: 'http://127.0.0.1:3850',
      rootDir: '/Users/demo/Library/Application Support/FlowAgent/workspace',
      configPath: '/Users/demo/Library/Application Support/FlowAgent/workspace/config.json',
      configImportedFrom: '/Users/demo/project/config.json',
      message: 'Imported config.json from /Users/demo/project/config.json.',
      startedAt: '2026-04-14T13:00:00.000Z',
      readyAt: '2026-04-14T13:00:02.000Z',
      pid: 12345,
      lastExitCode: null,
    },
  });

  assert.equal(profile.mode, 'electron');
  assert.equal(profile.hostBridge.available, true);
  assert.equal(
    profile.hostBridge.configPath,
    '/Users/demo/Library/Application Support/FlowAgent/workspace/config.json',
  );
  assert.equal(profile.hostBridge.message, 'Imported config.json from /Users/demo/project/config.json.');
});
