import assert from 'node:assert/strict';
import { test } from 'vitest';

import { RefineAssistantDebugLogs1774422000000 } from '../../migrations/1774422000000-refineAssistantDebugLogs';

test('debug log migration removes recordings and converts legacy kinds', async () => {
  const queries = [];
  await new RefineAssistantDebugLogs1774422000000().up({
    query(sql) {
      queries.push(sql);
      return Promise.resolve();
    },
  });
  const allQueries = queries.join('\n');

  assert.match(allQueries, /"kind" = 'taskDictation'/);
  assert.match(allQueries, /THEN 'taskCapture'/);
  assert.match(allQueries, /DROP COLUMN "audioBase64"/);
  assert.match(allQueries, /DROP COLUMN "audioMimeType"/);
  assert.match(allQueries, /DROP COLUMN "transcriptionOutput"/);
  assert.match(allQueries, /DROP COLUMN "parserOutput"/);
  assert.match(allQueries, /ADD "timings" jsonb/);
});
