import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  resolveElectronConfigImportSource,
  resolveElectronProjectRoot,
  resolveElectronRendererEntry,
} from './app-paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(__dirname, '..');
const preloadPath = path.join(__dirname, 'preload.mjs');
const shouldManageHost = process.env.FLOWAGENT_ELECTRON_MANAGE_HOST !== 'false';
const hostPort = Number(process.env.FLOWAGENT_API_PORT ?? 3850);
const hostUrl = `http://127.0.0.1:${hostPort}`;
let hostProcess = null;
const hostState = {
  managed: shouldManageHost,
  status: shouldManageHost ? 'starting' : 'external',
  url: hostUrl,
  rootDir: '',
  configPath: '',
  configImportedFrom: '',
  sourceRoot,
  message: '',
  startedAt: null,
  readyAt: null,
  pid: null,
  lastExitCode: null,
};

function updateHostState(next) {
  Object.assign(hostState, next);
}

function resolveBundledHostEntryPath() {
  if (!app.isPackaged) {
    return path.join(sourceRoot, 'dist-host', 'api-server.mjs');
  }
  return path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-host', 'api-server.mjs');
}

function resolveHostWorkingDirectory(projectRoot) {
  if (!app.isPackaged) {
    return sourceRoot;
  }
  return process.resourcesPath || projectRoot;
}

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function waitForUrl(url, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch {
      // Keep waiting while the host boots.
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return false;
}

async function probeHostHealth() {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${hostUrl}/health`);
    return {
      reachable: response.ok,
      latencyMs: Date.now() - startedAt,
      statusCode: response.status,
    };
  } catch (error) {
    return {
      reachable: false,
      latencyMs: Date.now() - startedAt,
      statusCode: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function maybeBootstrapProjectConfig(projectRoot) {
  const targetConfigPath = path.join(projectRoot, 'config.json');
  updateHostState({ configPath: targetConfigPath });
  try {
    await stat(targetConfigPath);
    return;
  } catch {
    // Only import when the target config does not exist yet.
  }

  const sourceConfigPath = resolveElectronConfigImportSource(app, sourceRoot);
  if (!sourceConfigPath || path.resolve(sourceConfigPath) === path.resolve(targetConfigPath)) {
    return;
  }

  await mkdir(projectRoot, { recursive: true });
  await copyFile(sourceConfigPath, targetConfigPath);
  updateHostState({
    configImportedFrom: sourceConfigPath,
    message: `Imported config.json from ${sourceConfigPath}.`,
  });
}

async function ensureHostBridge() {
  const projectRoot = resolveElectronProjectRoot(app, sourceRoot);
  fs.mkdirSync(projectRoot, { recursive: true });
  updateHostState({ rootDir: projectRoot });
  await maybeBootstrapProjectConfig(projectRoot);

  if (!shouldManageHost) {
    updateHostState({
      managed: false,
      status: 'external',
      message: 'Host bridge is managed by the development runner.',
    });
    return;
  }

  if (await isPortOpen(hostPort)) {
    updateHostState({
      status: 'ready',
      message: 'Reusing an existing host bridge.',
      readyAt: new Date().toISOString(),
    });
    return;
  }

  const bundledHostEntryPath = resolveBundledHostEntryPath();
  const hostWorkingDirectory = resolveHostWorkingDirectory(projectRoot);
  const usesBundledHost = fs.existsSync(bundledHostEntryPath);
  const tsxCliPath = path.join(sourceRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const serverEntryPath = path.join(sourceRoot, 'server', 'api-server.ts');
  const hostArgs = usesBundledHost ? [bundledHostEntryPath] : [tsxCliPath, serverEntryPath];
  updateHostState({
    status: 'starting',
    message: usesBundledHost
      ? 'Starting the bundled FlowAgent host bridge.'
      : 'Starting the local FlowAgent host bridge.',
    startedAt: new Date().toISOString(),
  });
  hostProcess = spawn(process.execPath, hostArgs, {
    cwd: hostWorkingDirectory,
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      FLOWAGENT_PROJECT_ROOT: projectRoot,
      FLOWAGENT_DESKTOP: '1',
    },
  });
  updateHostState({
    pid: hostProcess.pid ?? null,
    lastExitCode: null,
  });

  hostProcess.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`FlowAgent host bridge exited with code ${code}`);
      updateHostState({
        status: 'failed',
        message: `Host bridge exited with code ${code}.`,
        pid: null,
        lastExitCode: code,
      });
    } else {
      updateHostState({
        status: 'stopped',
        message: 'Host bridge stopped.',
        pid: null,
        lastExitCode: code ?? 0,
      });
    }
    hostProcess = null;
  });

  const ready = await waitForUrl(`${hostUrl}/health`);
  updateHostState(
    ready
      ? {
          status: 'ready',
          message: 'Host bridge is ready.',
          readyAt: new Date().toISOString(),
        }
      : {
          status: 'failed',
          message: `Host bridge did not become ready at ${hostUrl}.`,
        },
  );
}

function createMainWindow() {
  const rendererEntry = resolveElectronRendererEntry(app, sourceRoot);
  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1040,
    minHeight: 720,
    title: 'FlowAgent',
    backgroundColor: '#05050A',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (rendererEntry.type === 'url') {
    void window.loadURL(rendererEntry.value);
  } else {
    void window.loadURL(pathToFileURL(rendererEntry.value).toString());
  }

  if (process.env.FLOWAGENT_ELECTRON_DEVTOOLS === 'true') {
    window.webContents.openDevTools({ mode: 'detach' });
  }

  return window;
}

app.setName('FlowAgent');

ipcMain.handle('flowagent:get-desktop-info', () => ({
  mode: 'electron',
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
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
  host: { ...hostState },
}));

ipcMain.handle('flowagent:get-runtime-diagnostics', async () => {
  const hostProbe = await probeHostHealth();
  const memoryUsage = process.memoryUsage();

  return {
    appVersion: app.getVersion(),
    platform: process.platform,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
    mainProcess: {
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      rssBytes: memoryUsage.rss,
      heapUsedBytes: memoryUsage.heapUsed,
      heapTotalBytes: memoryUsage.heapTotal,
    },
    system: {
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
      loadAverage: os.loadavg(),
    },
    host: {
      ...hostState,
      reachable: hostProbe.reachable,
      latencyMs: hostProbe.latencyMs,
      statusCode: hostProbe.statusCode,
      error: hostProbe.error ?? '',
    },
  };
});

app.whenReady().then(async () => {
  try {
    await ensureHostBridge();
  } catch (error) {
    console.error('Failed to start FlowAgent host bridge:', error);
    updateHostState({
      status: 'failed',
      message: error instanceof Error ? error.message : 'Failed to start host bridge.',
    });
  }

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (hostProcess && !hostProcess.killed) {
    hostProcess.kill('SIGTERM');
  }
});
