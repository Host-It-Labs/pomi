#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { loadEnvironment } from './local-env.mjs';

const separator = process.argv.indexOf('--');
const options = process.argv.slice(2, separator >= 0 ? separator : undefined);
const requestedCommand =
  separator >= 0 ? process.argv[separator + 1] : undefined;
const args = separator >= 0 ? process.argv.slice(separator + 2) : [];
const commands = {
  bash: 'bash',
  cargo: 'cargo',
  node: 'node',
  pnpm: 'pnpm',
  sh: 'sh',
};
const command = requestedCommand ? commands[requestedCommand] : undefined;
let profile;
let filePath;
let validOptions = true;

for (let index = 0; index < options.length; index += 1) {
  const option = options[index];
  if (option === '--profile' && options[index + 1]) {
    profile = options[++index];
  } else if (option === '--env-file' && options[index + 1]) {
    filePath = options[++index];
  } else {
    validOptions = false;
  }
}

if (!command || !validOptions || !profile) {
  process.stderr.write(
    `Usage: node scripts/run-with-local-env.mjs --profile local|automation|release [--env-file path] -- <${Object.keys(commands).join('|')}> [args...]\n`
  );
  process.exit(2);
}

const child = spawn(command, args, {
  stdio: 'inherit',
  env: loadEnvironment({
    environment: { ...process.env },
    profile,
    filePath,
  }),
});

child.on('error', error => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
