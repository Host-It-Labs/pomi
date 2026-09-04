import { describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import { LiveActivityUpdateService } from '../../src/timer/live-activity-update.service';

describe('LiveActivityUpdateService', () => {
  it('handles failures from the complete asynchronous update task', async () => {
    const updates = new Subject<{ userId: string; timer: never }>();
    const failure = new Error('database unavailable');
    const error = vi.fn();
    const service = new LiveActivityUpdateService(
      { onTimerUpdate: updates } as never,
      {
        sendLiveActivityTimerUpdate: vi.fn(async () => {
          throw failure;
        }),
      } as never
    );
    Object.assign(service, { logger: { error } });

    service.onModuleInit();
    updates.next({ userId: 'user-1', timer: {} as never });

    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        'Failed to update Live Activity for user user-1:',
        failure
      )
    );
    service.onModuleDestroy();
    expect(updates.observed).toBe(false);
  });
});
