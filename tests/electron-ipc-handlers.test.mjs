import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DESKTOP_RUNTIME_CAPABILITIES,
  createDesktopInfoPayload,
  registerFlowAgentDesktopHandlers,
} from '../electron/ipc-handlers.mjs';

test('createDesktopInfoPayload snapshots host metadata for the desktop bridge', () => {
  const hostState = {
    managed: true,
    status: 'ready',
    url: 'http://127.0.0.1:3850',
    rootDir: '/tmp/flowagent-workspace',
    configPath: '/tmp/flowagent-workspace/config.json',
    configImportedFrom: '/tmp/project/config.json',
    sourceRoot: '/repo/source',
    message: 'Imported config.json from /tmp/project/config.json.',
    startedAt: '2026-04-14T13:00:00.000Z',
    readyAt: '2026-04-14T13:00:02.000Z',
    pid: 4321,
    lastExitCode: null,
  };

  const payload = createDesktopInfoPayload({
    hostState,
    platform: 'darwin',
    versions: {
      electron: '41.1.1',
      chrome: '141.0.0.0',
      node: '25.8.2',
    },
  });

  assert.deepEqual(payload.capabilities, DESKTOP_RUNTIME_CAPABILITIES);
  assert.equal(payload.host.configPath, '/tmp/flowagent-workspace/config.json');
  assert.equal(payload.host.configImportedFrom, '/tmp/project/config.json');

  hostState.message = 'mutated';
  assert.equal(payload.host.message, 'Imported config.json from /tmp/project/config.json.');
});

test('registerFlowAgentDesktopHandlers wires desktop info and runtime diagnostics handlers', async () => {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
  };
  const hostState = {
    managed: true,
    status: 'ready',
    url: 'http://127.0.0.1:3850',
    rootDir: '/tmp/flowagent-workspace',
    configPath: '/tmp/flowagent-workspace/config.json',
    configImportedFrom: '/tmp/project/config.json',
    sourceRoot: '/repo/source',
    message: 'Host bridge is ready.',
    startedAt: '2026-04-14T13:00:00.000Z',
    readyAt: '2026-04-14T13:00:02.000Z',
    pid: 9876,
    lastExitCode: null,
  };

  registerFlowAgentDesktopHandlers({
    ipcMain,
    app: {
      getVersion() {
        return '0.0.0-test';
      },
    },
    getHostState: () => hostState,
    probeHostHealth: async () => ({
      reachable: true,
      latencyMs: 18,
      statusCode: 200,
    }),
    processInfo: {
      platform: 'darwin',
      versions: {
        electron: '41.1.1',
        chrome: '141.0.0.0',
        node: '25.8.2',
      },
      pid: 1234,
      uptime() {
        return 12.4;
      },
      memoryUsage() {
        return {
          rss: 1_000,
          heapUsed: 2_000,
          heapTotal: 3_000,
        };
      },
    },
    osModule: {
      totalmem() {
        return 16_000;
      },
      freemem() {
        return 6_000;
      },
      loadavg() {
        return [0.1, 0.2, 0.3];
      },
    },
  });

  assert.deepEqual([...handlers.keys()].sort(), ['flowagent:get-desktop-info', 'flowagent:get-runtime-diagnostics']);

  const desktopInfo = await handlers.get('flowagent:get-desktop-info')();
  assert.equal(desktopInfo.host.pid, 9876);
  assert.equal(desktopInfo.host.configImportedFrom, '/tmp/project/config.json');

  const diagnostics = await handlers.get('flowagent:get-runtime-diagnostics')();
  assert.equal(diagnostics.appVersion, '0.0.0-test');
  assert.equal(diagnostics.mainProcess.pid, 1234);
  assert.equal(diagnostics.mainProcess.uptimeSec, 12);
  assert.equal(diagnostics.host.reachable, true);
  assert.equal(diagnostics.host.latencyMs, 18);
  assert.equal(diagnostics.host.statusCode, 200);
  assert.equal(diagnostics.host.configPath, '/tmp/flowagent-workspace/config.json');
});
