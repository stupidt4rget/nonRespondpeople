import { spawn } from 'node:child_process';
import process from 'node:process';

const isWindows = process.platform === 'win32';
const pnpm = isWindows ? 'pnpm.cmd' : 'pnpm';
const viteUrl = 'http://127.0.0.1:5173';
const backendPort = '3002';

const children = new Set();

function spawnChild(command, args, options = {}) {
  const child = spawn(
    isWindows ? [command, ...args].join(' ') : command,
    isWindows ? [] : args,
    {
      stdio: 'inherit',
      shell: isWindows,
      ...options,
      env: {
        ...process.env,
        ...options.env,
      },
    },
  );
  children.add(child);
  child.on('exit', () => {
    children.delete(child);
  });
  return child;
}

function stopChildren() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

async function waitForUrl(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

process.on('SIGINT', () => {
  stopChildren();
  process.exit(130);
});

process.on('SIGTERM', () => {
  stopChildren();
  process.exit(143);
});

const web = spawnChild(pnpm, ['--filter', '@roleagent/web', 'dev'], {
  env: {
    VITE_API_PROXY_TARGET: `http://127.0.0.1:${backendPort}`,
  },
});

web.on('exit', (code) => {
  stopChildren();
  process.exit(code ?? 1);
});

try {
  await waitForUrl(viteUrl, 60_000);
} catch (err) {
  stopChildren();
  console.error(err);
  process.exit(1);
}

const electron = spawnChild(pnpm, ['exec', 'electron', 'dist/main.js'], {
  env: {
    ROLEAGENT_DESKTOP_DEV: '1',
    ROLEAGENT_DESKTOP_DEV_URL: viteUrl,
    ROLEAGENT_DESKTOP_DEV_PORT: backendPort,
  },
});

electron.on('exit', (code) => {
  stopChildren();
  process.exit(code ?? 0);
});
