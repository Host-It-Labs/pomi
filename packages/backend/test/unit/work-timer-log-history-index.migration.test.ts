import { describe, expect, it, vi } from 'vitest';
import { SeekWorkTimerLogHistory1789038000000 } from '../../migrations/1789038000000-seekWorkTimerLogHistory';

describe('SeekWorkTimerLogHistory1789038000000', () => {
  it('adds and removes the user-scoped seek index', async () => {
    const query = vi.fn(async () => undefined);
    const migration = new SeekWorkTimerLogHistory1789038000000();

    await migration.up({ query } as never);
    expect(query).toHaveBeenLastCalledWith(
      'CREATE INDEX "IDX_statistics_user_completed_at_id" ON "statistics" ("userId", "completedAt" DESC, "id" DESC)'
    );

    await migration.down({ query } as never);
    expect(query).toHaveBeenLastCalledWith(
      'DROP INDEX "IDX_statistics_user_completed_at_id"'
    );
  });
});
