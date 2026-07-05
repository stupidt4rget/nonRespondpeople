import { spawn } from 'node:child_process';
import process from 'node:process';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const isWindows = process.platform === 'win32';
const command = isWindows
  ? 'pnpm --filter @roleagent/server db:generate'
  : pnpm;
const args = isWindows ? [] : ['--filter', '@roleagent/server', 'db:generate'];

const child = spawn(command, args, {
  stdio: 'inherit',
  shell: isWindows,
  env: {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL ?? 'file:./dev.db',
  },
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
