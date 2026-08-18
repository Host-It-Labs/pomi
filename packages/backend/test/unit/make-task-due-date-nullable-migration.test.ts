import assert from 'node:assert/strict';
import { test } from 'vitest';

import { MakeTaskDueDateNullable1774407000000 } from '../../migrations/1774407000000-makeTaskDueDateNullable';

test('nullable due date migration rollback does not rewrite rows or set NOT NULL', async () => {
  const migration = new MakeTaskDueDateNullable1774407000000();
  const queries = [];

  await migration.down({
    async query(statement) {
      queries.push(statement);
    },
  });

  assert.deepEqual(queries, []);
});
