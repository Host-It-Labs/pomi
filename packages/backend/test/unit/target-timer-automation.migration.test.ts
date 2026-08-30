import { describe, expect, it, vi } from 'vitest';
import { TargetTimerAutomation1774469200000 } from '../../migrations/1774469200000-targetTimerAutomation';

describe('TargetTimerAutomation1774469200000', () => {
  it('adds targeted automation preferences and preserves prior long-break behavior', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    await new TargetTimerAutomation1774469200000().up({ query } as never);

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'ALTER TABLE "preferences" ADD "autoStartWork" boolean NOT NULL DEFAULT false',
      'ALTER TABLE "preferences" ADD "autoStartLongBreak" boolean NOT NULL DEFAULT false',
      'ALTER TABLE "preferences" ADD "resetWorkOnFirstIntention" boolean NOT NULL DEFAULT false',
      'UPDATE "preferences" SET "autoStartLongBreak" = "autoStartBreak"',
    ]);
  });
});
