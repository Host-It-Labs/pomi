import assert from 'node:assert/strict';
import { test } from 'vitest';

import { AddAssistantTaskTranscripts1774428000000 } from '../../migrations/1774428000000-addAssistantTaskTranscripts';

test('assistant task transcript migration adds fields and switches the new reasoning default', async () => {
  const queries = [];
  const migration = new AddAssistantTaskTranscripts1774428000000();
  const queryRunner = {
    query: async query => {
      queries.push(query);
    },
  };

  await migration.up(queryRunner);
  assert.match(queries[0], /ALTER TABLE "tasks" ADD "sourceTranscript" text/);
  assert.match(queries[1], /assistantTaskTranscriptsEnabled.*DEFAULT false/);
  assert.match(queries[2], /assistantTaskTranscriptMinWords.*DEFAULT 15/);
  assert.match(queries[3], /reasoningBaseEffort.*DEFAULT 'minimal'/);

  queries.length = 0;
  await migration.down(queryRunner);
  assert.equal(queries.length, 4);
  assert.match(queries[0], /reasoningBaseEffort.*DEFAULT 'low'/);
  assert.match(queries[3], /DROP COLUMN "sourceTranscript"/);
});
