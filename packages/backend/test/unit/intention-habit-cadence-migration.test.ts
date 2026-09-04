import { describe, expect, it, vi } from 'vitest';
import { AddIntentionHabitCadence1774469400000 } from '../../migrations/1774469400000-addIntentionHabitCadence';

describe('AddIntentionHabitCadence1774469400000', () => {
  it('backfills existing habits to daily cadence', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new AddIntentionHabitCadence1774469400000().up({ query } as never);

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('ADD "habitCadence"')
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      `UPDATE "intentions" SET "habitCadence" = 'daily' WHERE "isHabit" = true`
    );
  });
});
