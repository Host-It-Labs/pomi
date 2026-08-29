import { describe, expect, it, vi } from 'vitest';
import { UnifyBreakAutoStart1774469000000 } from '../../migrations/1774469000000-unifyBreakAutoStart';

describe('UnifyBreakAutoStart migration', () => {
  it('adds reset preferences and preserves either legacy auto-start setting', async () => {
    const query = vi.fn(async () => undefined);
    await new UnifyBreakAutoStart1774469000000().up({ query } as never);

    expect(query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining(
        '"autoStartBreak" = "autoStartBreak" OR "sessionLongBreakAutoStart"'
      )
    );
    expect(query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('DROP COLUMN "sessionLongBreakAutoStart"')
    );
  });

  it('recreates the retired column on rollback from the shared setting', async () => {
    const query = vi.fn(async () => undefined);
    await new UnifyBreakAutoStart1774469000000().down({ query } as never);

    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('"sessionLongBreakAutoStart" = "autoStartBreak"')
    );
    expect(query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('DROP COLUMN "resetBreakOnFirstIntention"')
    );
  });
});
