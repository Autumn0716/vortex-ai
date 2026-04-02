import { spawn } from 'node:child_process';
import net from 'node:net';

const children = [];
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function start(label, command, args) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code) => {
    if (code && code !== 0) {
      process.exitCode = code;
    }
  });

  children.push({ label, child });
  return child;
}

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => {
      resolve(false);
    });
  });
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

if (await isPortOpen(3850)) {
  console.log('Reusing existing api-server on http://127.0.0.1:3850');
} else {
  start('api-server', npmCommand, ['run', 'api-server']);
}

start('vite', npmCommand, ['run', 'dev:web']);
