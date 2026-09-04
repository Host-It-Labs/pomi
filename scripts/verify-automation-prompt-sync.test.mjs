import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  AUTOMATION_PROMPT_BACKUPS,
  automationPromptSyncProblems,
} from './verify-automation-prompt-sync.mjs';

const root = path.resolve(import.meta.dirname, '..');
const backupRoot = path.join(root, 'docs/agents/automations');

test('detects drift across all six installed Radar prompts', () => {
  const installedRoot = mkdtempSync(
    path.join(os.tmpdir(), 'pomi-automation-prompt-sync-')
  );
  try {
    for (const [automationId, backupName] of Object.entries(
      AUTOMATION_PROMPT_BACKUPS
    )) {
      const directory = path.join(installedRoot, automationId);
      mkdirSync(directory);
      const prompt = readFileSync(
        path.join(backupRoot, backupName),
        'utf8'
      ).trimEnd();
      writeFileSync(
        path.join(directory, 'automation.toml'),
        `version = 1\nid = ${JSON.stringify(automationId)}\nprompt = ${JSON.stringify(prompt)}\n`
      );
    }
    assert.deepEqual(
      automationPromptSyncProblems({ installedRoot, backupRoot }),
      []
    );

    const changedId = 'pomi-daily-security-ideas';
    const changedPath = path.join(installedRoot, changedId, 'automation.toml');
    writeFileSync(
      changedPath,
      readFileSync(changedPath, 'utf8').replace(
        'prompt = "',
        'prompt = "drift '
      )
    );
    assert.deepEqual(
      automationPromptSyncProblems({ installedRoot, backupRoot }),
      [`${changedId}: runtime prompt differs from backup.`]
    );

    const environmentId = 'pomi-parent-security-planning';
    const environmentPath = path.join(
      installedRoot,
      environmentId,
      'automation.toml'
    );
    writeFileSync(
      environmentPath,
      `${readFileSync(environmentPath, 'utf8')}local_environment_config_path = "/secret/profile"\n`
    );
    assert.deepEqual(
      automationPromptSyncProblems({ installedRoot, backupRoot }),
      [
        `${changedId}: runtime prompt differs from backup.`,
        `${environmentId}: secret-bearing task environment is attached.`,
      ]
    );
  } finally {
    rmSync(installedRoot, { recursive: true, force: true });
  }
});

test('rejects malformed escape-heavy prompts without regex backtracking', () => {
  const installedRoot = mkdtempSync(
    path.join(os.tmpdir(), 'pomi-automation-prompt-sync-')
  );
  try {
    const [automationId] = Object.keys(AUTOMATION_PROMPT_BACKUPS);
    const directory = path.join(installedRoot, automationId);
    mkdirSync(directory);
    writeFileSync(
      path.join(directory, 'automation.toml'),
      `version = 1\nprompt = "${'\\\\'.repeat(100_000)}!\n`
    );

    assert.deepEqual(automationPromptSyncProblems({ installedRoot }), [
      `${automationId}: Installed automation prompt is not a valid TOML string.`,
      ...Object.keys(AUTOMATION_PROMPT_BACKUPS)
        .slice(1)
        .map((id) => `${id}: installed automation is missing.`),
    ]);
  } finally {
    rmSync(installedRoot, { recursive: true, force: true });
  }
});
