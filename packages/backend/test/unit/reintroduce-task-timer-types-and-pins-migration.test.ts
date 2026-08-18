import assert from 'node:assert/strict';
import { test } from 'vitest';

import { ReintroduceTaskTimerTypesAndPins1774425000000 } from '../../migrations/1774425000000-reintroduceTaskTimerTypesAndPins';

test('Task timer types, pins, and capture preferences migrate reversibly', async () => {
  const migration = new ReintroduceTaskTimerTypesAndPins1774425000000();
  const upQueries = [];
  const downQueries = [];

  await migration.up({
    async query(statement) {
      upQueries.push(statement);
    },
  });
  await migration.down({
    async query(statement) {
      downQueries.push(statement);
    },
  });

  const up = upQueries.join('\n');
  const down = downQueries.join('\n');
  assert.match(up, /"tasks" ADD "timerType"[^\n]+DEFAULT 'work'/);
  assert.match(up, /"tasks" ADD "pinnedAt" TIMESTAMP NULL/);
  assert.match(up, /"task_events" ADD "timerTypeSnapshot"[^\n]+DEFAULT 'work'/);
  assert.match(up, /"preferences" ADD "tasksDuringBreaks"[^\n]+DEFAULT false/);
  assert.match(up, /"taskDefaultDueDateMode"[^\n]+DEFAULT 'tomorrow'/);
  assert.match(up, /"taskDefaultDueDateDays"[^\n]+DEFAULT 1/);
  assert.match(down, /DROP COLUMN "taskDefaultDueDateDays"/);
  assert.match(down, /DROP COLUMN "timerType"/);
});
