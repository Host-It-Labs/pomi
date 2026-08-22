#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { loadLocalEnvironment } from './local-env.mjs';

const separator = process.argv.indexOf('--');
const command = separator >= 0 ? process.argv[separator + 1] : undefined;
const args = separator >= 0 ? process.argv.slice(separator + 2) : [];

if (!command) {
  process.stderr.write(
    'Usage: node scripts/run-with-local-env.mjs -- <command> [args...]\n'
  );
  process.exit(2);
}

const child = spawn(command, args, {
  stdio: 'inherit',
  env: loadLocalEnvironment({ environment: { ...process.env } }),
});

child.on('error', error => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
