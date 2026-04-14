import { app, BrowserWindow, shell } from 'electron';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const preloadPath = path.join(__dirname, 'preload.mjs');
const rendererUrl = process.env.FLOWAGENT_RENDERER_URL?.trim() ?? '';
const shouldManageHost = process.env.FLOWAGENT_ELECTRON_MANAGE_HOST !== 'false';
const hostPort = Number(process.env.FLOWAGENT_API_PORT ?? 3850);
const hostUrl = `http://127.0.0.1:${hostPort}`;
let hostProcess = null;

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

async function ensureHostBridge() {
  if (!shouldManageHost) {
    return;
  }

  if (await isPortOpen(hostPort)) {
    return;
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  hostProcess = spawn(npmCommand, ['run', 'api-server'], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      FLOWAGENT_PROJECT_ROOT: projectRoot,
      FLOWAGENT_DESKTOP: '1',
    },
  });

  hostProcess.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`FlowAgent host bridge exited with code ${code}`);
    }
    hostProcess = null;
  });

  await waitForUrl(`${hostUrl}/health`);
}

function createMainWindow() {
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

  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadURL(pathToFileURL(path.join(projectRoot, 'dist/index.html')).toString());
  }

  if (process.env.FLOWAGENT_ELECTRON_DEVTOOLS === 'true') {
    window.webContents.openDevTools({ mode: 'detach' });
  }

  return window;
}

app.setName('FlowAgent');

app.whenReady().then(async () => {
  await ensureHostBridge();
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
