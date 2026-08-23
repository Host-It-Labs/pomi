import { describe, expect, it, vi } from 'vitest';

import { AddStatisticsHistoryIndexes1774468100000 } from '../../migrations/1774468100000-addStatisticsHistoryIndexes';

describe('AddStatisticsHistoryIndexes1774468100000', () => {
  it('adds the completion-time and date indexes', async () => {
    const query = vi.fn(async () => undefined);
    const migration = new AddStatisticsHistoryIndexes1774468100000();

    await migration.up({ query } as never);

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      `CREATE INDEX "IDX_statistics_user_type_completed_at" ON "statistics" ("userId", "type", "completedAt")`,
      `CREATE INDEX "IDX_statistics_user_type_date" ON "statistics" ("userId", "type", "date")`,
    ]);
  });

  it('removes the indexes in reverse order', async () => {
    const query = vi.fn(async () => undefined);
    const migration = new AddStatisticsHistoryIndexes1774468100000();

    await migration.down({ query } as never);

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      `DROP INDEX "IDX_statistics_user_type_date"`,
      `DROP INDEX "IDX_statistics_user_type_completed_at"`,
    ]);
  });
});
