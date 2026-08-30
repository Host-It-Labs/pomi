import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';
import path from 'node:path';
import { Client } from 'pg';
import { test } from 'vitest';

const backendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const databaseUrl =
  process.env.DATABASE_URL ||
  `postgres://user:password@localhost:${process.env.POMI_DB_PORT || '5433'}/pomodoro`;
const username = 'copyme-integration';
const fixtureName = 'copyme-integration';

function runFixtureScript(scriptName: string): string {
  return execFileSync(
    process.execPath,
    [path.join(backendRoot, 'dist/scripts', scriptName)],
    {
      cwd: backendRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        POMI_COPYME_USERNAME: username,
        POMI_COPYME_PASSWORD: username,
        POMI_COPYME_FIXTURE_NAME: fixtureName,
      },
    }
  );
}

function seedCopyme(): string {
  return runFixtureScript('seed-copyme-user.js');
}

function ensureCopyme(): string {
  return runFixtureScript('ensure-copyme-user.js');
}

function reseedCopyme(): string {
  return runFixtureScript('reseed-copyme-user.js');
}

async function cleanIsolatedFixture(client: Client): Promise<void> {
  const users = await client.query(`SELECT id FROM users WHERE username = $1`, [
    username,
  ]);
  if (users.rows.length === 0) return;

  const [user] = users.rows;
  await client.query(`DELETE FROM assistant_debug_logs WHERE "userId" = $1`, [
    user.id,
  ]);
  await client.query(
    `DELETE FROM assistant_debug_settings WHERE "userId" = $1`,
    [user.id]
  );
  await client.query(
    `DELETE FROM development_fixture_markers WHERE "userId" = $1`,
    [user.id]
  );
  await client.query(`DELETE FROM task_events WHERE "userId" = $1`, [user.id]);
  await client.query(`DELETE FROM tasks WHERE "userId" = $1`, [user.id]);
  await client.query(`DELETE FROM statistics WHERE "userId" = $1`, [user.id]);
  await client.query(`DELETE FROM intentions WHERE "userId" = $1`, [user.id]);
  await client.query(`DELETE FROM preferences WHERE "userId" = $1`, [user.id]);
  await client.query(`DELETE FROM users WHERE id = $1`, [user.id]);
}

test('copyme validates an isolated canonical fixture and keeps force rebuild explicit', async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await cleanIsolatedFixture(client);
    assert.match(await reseedCopyme(), /existing Copyme data will be deleted/);
    assert.match(await seedCopyme(), /Copyme user fixture is healthy/);
    assert.match(await ensureCopyme(), /Copyme user fixture is healthy/);

    const marker = await client.query(
      `SELECT m."fixtureName", m."seedVersion", m."credentialFingerprint", u.id, u."isAdmin"
       FROM development_fixture_markers m
       INNER JOIN users u ON u.id = m."userId"
       WHERE m."fixtureName" = $1`,
      [fixtureName]
    );
    assert.equal(marker.rows.length, 1);
    assert.equal(marker.rows[0].seedVersion, 11);
    assert.equal(marker.rows[0].isAdmin, true);
    assert.match(marker.rows[0].credentialFingerprint, /^[a-f0-9]{64}$/);
    const firstUserId = marker.rows[0].id;

    const preferences = await client.query(
      `SELECT p.*
       FROM preferences p
       INNER JOIN users u ON u.id = p."userId"
       WHERE u.username = $1`,
      [username]
    );
    assert.equal(preferences.rows.length, 1);
    const preference = preferences.rows[0];
    for (const key of [
      'assistantExtension',
      'assistantTaskTranscriptsEnabled',
      'autoStartBreak',
      'intentionExtension',
      'longBreakToBreakEnabled',
      'resetBreakOnFirstIntention',
      'resetLongBreakOnFirstIntention',
      'sessionShowEta',
      'sessionsExtension',
      'tasksExtension',
      'tasksDuringBreaks',
      'tasksShowInMinimizedTimer',
      'timerExtension',
      'undoAlerts',
      'vacationCoverageConfigured',
      'vacationExtension',
      'workTimerLogsExtension',
    ]) {
      assert.equal(preference[key], true, `${key} should be enabled`);
    }
    for (const key of [
      'globalShortcut',
      'keepScreenAwake',
      'notifications',
      'pushNotifications',
      'soundNotifications',
      'tasksShowVacationCovered',
    ]) {
      assert.equal(preference[key], false, `${key} should stay disabled`);
    }
    assert.equal(preference.taskDefaultDueDateMode, 'tomorrow');
    assert.equal(preference.taskDefaultSortMode, 'default');
    assert.deepEqual(preference.taskReminderPriorities, ['high', 'urgent']);
    assert.equal(preference.taskUrgentReminderRepeatEnabled, false);
    assert.equal(preference.taskUrgentReminderRepeatIntervalMinutes, 30);
    assert.equal(preference.assistantTaskTranscriptMinWords, 15);

    const debugState = await client.query(
      `SELECT s.enabled,
              (SELECT COUNT(*)::integer FROM assistant_debug_logs l WHERE l."userId" = s."userId") AS "logCount"
       FROM assistant_debug_settings s
       INNER JOIN users u ON u.id = s."userId"
       WHERE u.username = $1`,
      [username]
    );
    assert.deepEqual(debugState.rows, [{ enabled: true, logCount: 0 }]);

    const tasks = await client.query(
      `SELECT
         t.title,
         t.priority,
         t.status,
         t."timerType",
         t."customDuration",
         t."dueDate",
         t."dueTime",
         t."recurrenceRule",
         t."recurrenceInterval",
         t."manualOrderOverride",
         t."vacationEligible",
         parent.id AS "parentId",
         child.id AS "childId",
         child."parentIntentionId" AS "childParentId"
       FROM tasks t
       INNER JOIN users u ON u.id = t."userId"
       LEFT JOIN intentions parent
         ON parent."userId" = t."userId"
        AND parent.type = t."timerType"
        AND parent.slug = t."intentionSlug"
        AND parent."parentIntentionId" IS NULL
       LEFT JOIN intentions child
         ON child."userId" = t."userId"
        AND child.type = t."timerType"
        AND child.slug = t."subIntentionSlug"
       WHERE u.username = $1`,
      [username]
    );

    assert.ok(tasks.rows.length >= 50);
    assert.equal(
      new Set(tasks.rows.map(row => row.title)).size,
      tasks.rows.length
    );
    assert.deepEqual(
      new Set(tasks.rows.map(row => row.timerType)),
      new Set(['work', 'break', 'longBreak'])
    );
    assert.deepEqual(
      new Set(tasks.rows.map(row => row.priority)),
      new Set(['urgent', 'high', 'normal', 'low'])
    );
    assert.ok(tasks.rows.some(row => row.dueDate === null));
    assert.ok(tasks.rows.some(row => row.dueDate !== null));
    assert.ok(tasks.rows.some(row => row.dueTime === '19:00'));
    assert.ok(tasks.rows.some(row => row.dueTime === null));
    assert.ok(tasks.rows.some(row => row.recurrenceRule !== null));
    assert.ok(tasks.rows.some(row => Number(row.recurrenceInterval) % 1 !== 0));
    assert.ok(tasks.rows.some(row => row.manualOrderOverride === true));
    assert.ok(tasks.rows.some(row => row.vacationEligible === true));
    assert.deepEqual(
      tasks.rows
        .filter(row => row.customDuration !== null)
        .map(row => ({ title: row.title, customDuration: row.customDuration })),
      [{ title: 'Plan next feature slice', customDuration: 1_800_000 }]
    );
    assert.deepEqual(
      new Set(tasks.rows.map(row => row.status)),
      new Set(['active', 'completed', 'archived'])
    );

    for (const task of tasks.rows) {
      assert.ok(
        task.parentId,
        `${task.title} has no matching parent intention`
      );
      if (task.childId) {
        assert.equal(task.childParentId, task.parentId);
      }
    }

    const taskEvents = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE e."eventType" = 'created')::integer AS "createdCount",
         COUNT(*) FILTER (WHERE e."eventType" IN ('completed', 'archived'))::integer AS "lifecycleCount"
       FROM task_events e
       INNER JOIN users u ON u.id = e."userId"
       WHERE u.username = $1`,
      [username]
    );
    assert.equal(taskEvents.rows[0].createdCount, tasks.rows.length);
    assert.equal(
      taskEvents.rows[0].lifecycleCount,
      tasks.rows.filter(row => row.status !== 'active').length
    );

    const changedPasswordHash = await bcrypt.hash('not-copyme', 4);
    await client.query(`UPDATE users SET password = $1 WHERE id = $2`, [
      changedPasswordHash,
      firstUserId,
    ]);
    await client.query(
      `UPDATE preferences SET "undoAlerts" = false WHERE "userId" = $1`,
      [firstUserId]
    );
    await client.query(
      `DELETE FROM tasks WHERE "userId" = $1 AND title = 'Take a hydration break'`,
      [firstUserId]
    );
    await client.query(
      `DELETE FROM intentions WHERE "userId" = $1 AND type = 'break' AND slug = 'tea'`,
      [firstUserId]
    );
    await client.query(
      `DELETE FROM statistics WHERE id = (
         SELECT id FROM statistics WHERE "userId" = $1 LIMIT 1
       )`,
      [firstUserId]
    );

    const repairedOutput = await seedCopyme();
    assert.match(repairedOutput, /password does not match fixture credentials/);
    assert.match(
      repairedOutput,
      /preference undoAlerts does not match fixture/
    );
    assert.match(repairedOutput, /canonical intentions/);
    assert.match(repairedOutput, /canonical tasks/);
    assert.match(repairedOutput, /statistics counts do not match fixture/);
    const repaired = await client.query(
      `SELECT u.id, p."undoAlerts"
       FROM users u INNER JOIN preferences p ON p."userId" = u.id
       WHERE u.username = $1`,
      [username]
    );
    assert.notEqual(repaired.rows[0].id, firstUserId);
    assert.equal(repaired.rows[0].undoAlerts, true);

    assert.match(await seedCopyme(), /Copyme user fixture is healthy/);
    const preserved = await client.query(
      `SELECT id FROM users WHERE username = $1`,
      [username]
    );
    assert.equal(preserved.rows[0].id, repaired.rows[0].id);

    await client.query(
      `UPDATE development_fixture_markers SET "seedVersion" = 0 WHERE "fixtureName" = $1`,
      [fixtureName]
    );
    assert.match(await seedCopyme(), /fixture marker is missing or changed/);
    const automaticallyRebuilt = await client.query(
      `SELECT u.id, p."undoAlerts"
       FROM users u INNER JOIN preferences p ON p."userId" = u.id
       WHERE u.username = $1`,
      [username]
    );
    assert.notEqual(automaticallyRebuilt.rows[0].id, repaired.rows[0].id);
    assert.equal(automaticallyRebuilt.rows[0].undoAlerts, true);

    assert.match(await reseedCopyme(), /existing Copyme data will be deleted/);
    const rebuilt = await client.query(
      `SELECT u.id, p."undoAlerts"
       FROM users u INNER JOIN preferences p ON p."userId" = u.id
       WHERE u.username = $1`,
      [username]
    );
    assert.notEqual(rebuilt.rows[0].id, automaticallyRebuilt.rows[0].id);
    assert.equal(rebuilt.rows[0].undoAlerts, true);
  } finally {
    await cleanIsolatedFixture(client);
    await client.end();
  }
});
