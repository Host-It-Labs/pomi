import assert from 'node:assert/strict';
import { test } from 'vitest';
import { EmbedTaskFollowUps1774468900000 } from '../../migrations/1774468900000-embedTaskFollowUps';

test('follow-up migration embeds definitions and keeps generated work contextual', async () => {
  const upQueries: string[] = [];
  const downQueries: string[] = [];
  const migration = new EmbedTaskFollowUps1774468900000();
  await migration.up({ query: async sql => void upQueries.push(sql) } as never);
  await migration.down({
    query: async sql => void downQueries.push(sql),
  } as never);

  const upSql = upQueries.join('\n');
  assert.match(upSql, /ADD "followUpDefinition" jsonb/);
  assert.match(upSql, /ADD "followUpTaskIdBeforeEmbedding" uuid/);
  assert.match(upSql, /jsonb_build_object\(/);
  assert.match(upSql, /'title', template\."title"/);
  assert.match(
    upSql,
    /SET "followUpTaskIdBeforeEmbedding" = "followUpTaskId"\s+WHERE "followUpDefinition" IS NOT NULL/
  );
  assert.match(upSql, /SET "itemKind" = 'followUpTemplate'/);
  assert.match(
    upSql,
    /SET "followUpTaskId" = NULL\s+WHERE "followUpDefinition" IS NOT NULL/
  );
  assert.match(upSql, /SET "itemKind" = 'followUp'/);
  assert.match(upSql, /"itemKind" = 'followUp'/);
  assert.match(upSql, /"itemKind" IN \('task', 'followUp'\)/);

  const downSql = downQueries.join('\n');
  assert.match(
    downSql,
    /SET "followUpTaskId" = "followUpTaskIdBeforeEmbedding"\s+WHERE "followUpTaskIdBeforeEmbedding" IS NOT NULL/
  );
  assert.match(downSql, /DROP COLUMN "followUpDefinition"/);
  assert.match(downSql, /DROP COLUMN "followUpTaskIdBeforeEmbedding"/);
});
