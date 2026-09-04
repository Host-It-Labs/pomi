#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const AUTOMATION_PROMPT_BACKUPS = Object.freeze({
  'pomi-daily-feature-and-bug-requests': 'feature-bug.md',
  'pomi-daily-performance-ideas': 'performance.md',
  'pomi-daily-security-ideas': 'security.md',
  'pomi-parent-feature-and-bug-planning': 'feature-bug-parent.md',
  'pomi-parent-performance-planning': 'performance-parent.md',
  'pomi-parent-security-planning': 'security-parent.md',
});

const repositoryRoot = path.resolve(import.meta.dirname, '..');

function automationPrompt(contents) {
  const value = contents.match(/^prompt = ("(?:\\.|[^"])*")$/m)?.[1];
  if (!value) throw new Error('Installed automation prompt is missing.');
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('Installed automation prompt is not a valid TOML string.');
  }
}

export function automationPromptSyncProblems({
  installedRoot,
  backupRoot = path.join(repositoryRoot, 'docs/agents/automations'),
}) {
  const problems = [];
  for (const [automationId, backupName] of Object.entries(
    AUTOMATION_PROMPT_BACKUPS
  )) {
    const installedPath = path.join(
      installedRoot,
      automationId,
      'automation.toml'
    );
    const backupPath = path.join(backupRoot, backupName);
    if (!existsSync(installedPath)) {
      problems.push(`${automationId}: installed automation is missing.`);
      continue;
    }
    try {
      const installedContents = readFileSync(installedPath, 'utf8');
      const installed = automationPrompt(installedContents);
      const backup = readFileSync(backupPath, 'utf8').trimEnd();
      if (installed !== backup) {
        problems.push(`${automationId}: runtime prompt differs from backup.`);
      }
      if (/^local_environment_config_path\s*=/m.test(installedContents)) {
        problems.push(
          `${automationId}: secret-bearing task environment is attached.`
        );
      }
    } catch (error) {
      problems.push(
        `${automationId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return problems;
}

function main() {
  const rootFlag = process.argv.indexOf('--installed-root');
  const installedRoot =
    rootFlag >= 0 && process.argv[rootFlag + 1]
      ? path.resolve(process.argv[rootFlag + 1])
      : path.join(
          process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
          'automations'
        );
  const problems = automationPromptSyncProblems({ installedRoot });
  if (problems.length) {
    throw new Error(
      `Automation prompt drift detected:\n- ${problems.join('\n- ')}`
    );
  }
  process.stdout.write(
    '[pomi] all six installed Radar prompts match their backups.\n'
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
