import assert from 'node:assert/strict';
import { test } from 'vitest';

import { RemoveAssistantReasoningSettings1774430000000 } from '../../migrations/1774430000000-removeAssistantReasoningSettings';

test('assistant reasoning migration removes legacy settings columns', async () => {
  const queries = [];
  await new RemoveAssistantReasoningSettings1774430000000().up({
    query(sql) {
      queries.push(sql);
      return Promise.resolve();
    },
  });

  const allQueries = queries.join('\n');
  assert.match(allQueries, /DROP COLUMN "reasoningBaseEffort"/);
  assert.match(allQueries, /DROP COLUMN "reasoningEscalatedEffort"/);
  assert.match(allQueries, /DROP COLUMN "reasoningAutoEscalationEnabled"/);
});
