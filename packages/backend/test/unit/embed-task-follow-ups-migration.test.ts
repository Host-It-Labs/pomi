import assert from 'node:assert/strict';
import { test } from 'vitest';
import { EmbedTaskFollowUps1774468900000 } from '../../migrations/1774468900000-embedTaskFollowUps';

test('follow-up migration embeds definitions and keeps generated work contextual', async () => {
  const queries: string[] = [];
  const migration = new EmbedTaskFollowUps1774468900000();
  await migration.up({ query: async sql => void queries.push(sql) } as never);

  const sql = queries.join('\n');
  assert.match(sql, /ADD "followUpDefinition" jsonb/);
  assert.match(sql, /jsonb_build_object\(/);
  assert.match(sql, /'title', template\."title"/);
  assert.match(sql, /SET "itemKind" = 'followUpTemplate'/);
  assert.match(
    sql,
    /SET "followUpTaskId" = NULL\s+WHERE "followUpDefinition" IS NOT NULL/
  );
  assert.match(sql, /SET "itemKind" = 'followUp'/);
  assert.match(sql, /"itemKind" = 'followUp'/);
  assert.match(sql, /"itemKind" IN \('task', 'followUp'\)/);
});
