import assert from 'node:assert/strict';
import { test } from 'vitest';

import { RetainSubIntentionsAndNormalizeTasks1774421000000 } from '../../migrations/1774421000000-retainSubIntentionsAndNormalizeTasks';

test('task normalization keeps sub-intentions and cleans parent-only log labels', async () => {
  const migration = new RetainSubIntentionsAndNormalizeTasks1774421000000();
  const queries = [];

  await migration.up({
    async query(statement) {
      queries.push(statement);
    },
  });

  const allQueries = queries.join('\n');
  const invalidSelectionQuery = queries.find(statement =>
    statement.includes('invalid_parent_selections')
  );

  assert.ok(invalidSelectionQuery);
  assert.match(invalidSelectionQuery, /parent\."parentIntentionId" IS NULL/);
  assert.match(invalidSelectionQuery, /child\."isArchived" = false/);
  assert.match(invalidSelectionQuery, /"subIntentions" ->> parent\."slug"/);
  assert.match(invalidSelectionQuery, /normaliz(?:ed|ing)_statistics/);
  assert.match(allQueries, /DELETE FROM "statistics" statistic/);
  assert.match(allQueries, /jsonb_object_agg\(entry\.key, entry\.value\)/);
  assert.match(allQueries, /GREATEST\(0, parent\."usageCount"/);

  assert.match(allQueries, /SET "subIntentionSlug" =/);
  assert.match(allQueries, /SET "subIntentionSlugSnapshot" =/);
  assert.match(
    allQueries,
    /SET\s+"intentionSlug" = NULL,\s+"subIntentionSlug" = NULL/
  );
  assert.match(allQueries, /parent\."type" = 'work'/);
  assert.match(allQueries, /child\."isArchived" = false/);
  assert.match(allQueries, /DROP COLUMN "timerType"/);
  assert.match(allQueries, /DROP COLUMN "timerTypeSnapshot"/);
  assert.match(allQueries, /DROP COLUMN "tasksBreakTasks"/);

  assert.doesNotMatch(allQueries, /DELETE FROM "intentions"/);
  assert.doesNotMatch(allQueries, /DROP COLUMN "parentIntentionId"/);
  assert.doesNotMatch(allQueries, /DROP COLUMN "subIntentions"/);
  assert.doesNotMatch(allQueries, /DROP COLUMN "subIntentionSlug"/);
  assert.doesNotMatch(allQueries, /DROP COLUMN "intentionSubIntentions"/);
});
