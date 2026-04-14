import { spawn } from 'node:child_process';
import net from 'node:net';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];

function start(label, command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: process.env,
    ...options,
  });
  children.push({ label, child });
  child.on('exit', (code) => {
    if (code && code !== 0) {
      process.exitCode = code;
    }
  });
  return child;
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

async function waitForRendererPort(timeoutMs = 45_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (let port = 3000; port <= 3010; port += 1) {
      if (await isPortOpen(port)) {
        return port;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error('Timed out waiting for the Vite renderer.');
}

function shutdown(signal = 'SIGTERM') {
  children.forEach(({ child }) => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}

process.on('SIGINT', () => {
  shutdown('SIGINT');
  process.exit();
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
  process.exit();
});

start('dev-all', process.execPath, ['scripts/dev-all.mjs']);
const rendererPort = await waitForRendererPort();
const rendererUrl = `http://127.0.0.1:${rendererPort}`;

console.log(`Opening FlowAgent desktop renderer at ${rendererUrl}`);

start('electron', npmCommand, ['exec', 'electron', 'electron/main.mjs'], {
  env: {
    ...process.env,
    FLOWAGENT_RENDERER_URL: rendererUrl,
    FLOWAGENT_ELECTRON_MANAGE_HOST: 'false',
  },
});
