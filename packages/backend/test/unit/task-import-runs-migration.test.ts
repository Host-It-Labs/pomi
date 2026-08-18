import assert from 'node:assert/strict';
import { test } from 'vitest';
import { AddTaskImportRuns1774467300000 } from '../../migrations/1774467300000-addTaskImportRuns';

test('Task import runs migration creates durable user-owned history', async () => {
  const queries: string[] = [];
  const migration = new AddTaskImportRuns1774467300000();
  await migration.up({ query: async sql => void queries.push(sql) } as never);
  const sql = queries.join('\n');
  assert.match(sql, /CREATE TABLE "task_import_runs"/);
  assert.match(sql, /"importedCount" integer NOT NULL/);
  assert.match(sql, /REFERENCES "users"\("id"\) ON DELETE CASCADE/);
  assert.match(sql, /IDX_task_import_runs_user_created/);
  assert.match(sql, /INSERT INTO "task_import_runs"/);
  assert.match(sql, /"importSource" IS NOT NULL/);
});
