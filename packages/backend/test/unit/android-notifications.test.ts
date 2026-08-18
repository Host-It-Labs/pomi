import {
  ANDROID_NOTIFICATION_CHANNEL_IDS,
  TIMER_STATUSES,
  TIMER_TYPES,
} from '@pomi/shared';
import * as admin from 'firebase-admin';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationService } from '../../src/notifications/notifications.service';
import { TimerCountdownService } from '../../src/timer/timer-countdown.service';

type Payload = {
  android: {
    priority: string;
    notification: { channelId: string; tag?: string };
  };
  data?: { notificationId?: string };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function createNotificationService() {
  const fcmPayloads: Payload[] = [];
  vi.spyOn(admin, 'messaging').mockReturnValue({
    send: async (payload: Payload) => {
      fcmPayloads.push(payload);
      return 'message-id';
    },
  } as never);
  const service = new NotificationService(
    { get: (_key: string, fallback: unknown) => fallback } as never,
    {
      findUserById: async () => ({ fcmToken: 'fcm-token', apnToken: null }),
      clearPushToken: async () => undefined,
    } as never
  );
  Object.assign(service, { fcmApp: {}, apnProvider: null });
  return { service, fcmPayloads };
}

function createTimer(overrides: Record<string, unknown>) {
  return {
    id: 'timer-1',
    type: TIMER_TYPES.WORK,
    sessionPosition: 1,
    sessionTotal: 3,
    ...overrides,
  };
}

describe('Android timer notifications', () => {
  it('always sends high-priority FCM payloads', async () => {
    const { service, fcmPayloads } = createNotificationService();
    await service.sendTimerWarningNotification(
      createTimer({}) as never,
      'user-1',
      5
    );
    await service.sendTimerCompletedNotification(
      createTimer({ type: TIMER_TYPES.WORK }) as never,
      'user-1',
      5,
      false
    );
    await service.sendTimerCompletedNotification(
      createTimer({ type: TIMER_TYPES.BREAK }) as never,
      'user-1',
      4,
      false
    );
    await service.sendPausedTimerReminderNotification(
      createTimer({}) as never,
      'user-1'
    );
    await service.sendLongBreakDetectedNotification(
      createTimer({}) as never,
      'user-1'
    );

    expect(fcmPayloads).toHaveLength(5);
    expect(fcmPayloads.map(payload => payload.android.priority)).toEqual(
      Array(5).fill('high')
    );
  });

  it('uses v3 native-sound channel IDs', async () => {
    const { service, fcmPayloads } = createNotificationService();
    await service.sendTimerWarningNotification(
      createTimer({}) as never,
      'user-1',
      5
    );
    for (const [type, sessionEnd] of [
      [TIMER_TYPES.WORK, false],
      [TIMER_TYPES.BREAK, false],
      [TIMER_TYPES.WORK, true],
    ] as const) {
      await service.sendTimerCompletedNotification(
        createTimer({ type }) as never,
        'user-1',
        5,
        sessionEnd
      );
    }

    const channelIds = fcmPayloads.map(
      payload => payload.android.notification.channelId
    );
    expect(channelIds).toEqual([
      ANDROID_NOTIFICATION_CHANNEL_IDS.WARNINGS,
      ANDROID_NOTIFICATION_CHANNEL_IDS.WORK_COMPLETE,
      ANDROID_NOTIFICATION_CHANNEL_IDS.BREAK_COMPLETE,
      ANDROID_NOTIFICATION_CHANNEL_IDS.SESSION_END,
    ]);
    expect(channelIds.every(channelId => channelId.endsWith('_v3'))).toBe(true);
  });

  it('adds stable provider IDs for durable completion delivery', async () => {
    const { service, fcmPayloads } = createNotificationService();

    await service.sendDurableTimerCompletedNotification(
      createTimer({ type: TIMER_TYPES.WORK }) as never,
      'user-1',
      5,
      false,
      'timer-completed:timer-1'
    );

    expect(fcmPayloads[0].android.notification.tag).toBe(
      'timer-completed:timer-1'
    );
    expect(fcmPayloads[0].data?.notificationId).toBe('timer-completed:timer-1');
  });

  it('retries durable delivery while legacy delivery remains best effort', async () => {
    const { service } = createNotificationService();
    vi.mocked(admin.messaging).mockReturnValue({
      send: vi.fn(async () => {
        throw new Error('provider down');
      }),
    } as never);

    await expect(
      service.sendTimerCompletedNotification(
        createTimer({ type: TIMER_TYPES.WORK }) as never,
        'user-1',
        5,
        false
      )
    ).resolves.toBeUndefined();
    await expect(
      service.sendDurableTimerCompletedNotification(
        createTimer({ type: TIMER_TYPES.WORK }) as never,
        'user-1',
        5,
        false,
        'timer-completed:timer-1'
      )
    ).rejects.toThrow('provider down');
  });

  it('retries durable delivery when the user token has no matching provider', async () => {
    const service = new NotificationService(
      { get: (_key: string, fallback: unknown) => fallback } as never,
      {
        findUserById: async () => ({ fcmToken: null, apnToken: 'apn-token' }),
        clearPushToken: async () => undefined,
      } as never
    );
    Object.assign(service, { fcmApp: {}, apnProvider: null });

    await expect(
      service.sendDurableTimerCompletedNotification(
        createTimer({ type: TIMER_TYPES.WORK }) as never,
        'user-1',
        5,
        false,
        'timer-completed:timer-1'
      )
    ).rejects.toThrow('Notification provider unavailable: APNs');
  });

  it('retries APNs payload failures without clearing a valid token', async () => {
    const clearPushToken = vi.fn(async () => undefined);
    const service = new NotificationService(
      { get: (_key: string, fallback: unknown) => fallback } as never,
      {
        findUserById: async () => ({ fcmToken: null, apnToken: 'apn-token' }),
        clearPushToken,
      } as never
    );
    Object.assign(service, {
      fcmApp: null,
      apnProvider: {
        send: vi.fn(async () => ({
          failed: [{ status: 400, response: { reason: 'PayloadTooLarge' } }],
        })),
      },
    });

    await expect(
      service.sendDurableTimerCompletedNotification(
        createTimer({ type: TIMER_TYPES.WORK }) as never,
        'user-1',
        5,
        false,
        'timer-completed:timer-1'
      )
    ).rejects.toThrow('APNs delivery failed');
    expect(clearPushToken).not.toHaveBeenCalled();
  });

  it('clears an explicitly invalid APNs token without retrying', async () => {
    const clearPushToken = vi.fn(async () => undefined);
    const service = new NotificationService(
      { get: (_key: string, fallback: unknown) => fallback } as never,
      {
        findUserById: async () => ({ fcmToken: null, apnToken: 'apn-token' }),
        clearPushToken,
      } as never
    );
    Object.assign(service, {
      fcmApp: null,
      apnProvider: {
        send: vi.fn(async () => ({
          failed: [{ status: 400, response: { reason: 'BadDeviceToken' } }],
        })),
      },
    });

    await expect(
      service.sendDurableTimerCompletedNotification(
        createTimer({ type: TIMER_TYPES.WORK }) as never,
        'user-1',
        5,
        false,
        'timer-completed:timer-1'
      )
    ).resolves.toBeUndefined();
    expect(clearPushToken).toHaveBeenCalledWith('user-1', 'ios');
  });

  it('does not warn for extension timers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T18:00:00.000Z'));
    const timer = {
      id: 'extension-timer-1',
      scheduleRevision: 'extension-revision-1',
      isExtension: true,
      userId: 'user-1',
      startTime: Date.now(),
      duration: 5 * 60_000,
      remainingTime: 5 * 60_000,
      type: TIMER_TYPES.WORK,
      status: TIMER_STATUSES.RUNNING,
    };
    const emitTimerWarning = vi.fn();
    const service = new TimerCountdownService(
      {
        getPreferences: async () => ({
          notifyBeforeTime: 5 * 60_000,
          notifyBeforeWorkComplete: true,
        }),
      } as never,
      {
        getCurrentTimer: async () => timer,
        setCurrentTimer: async (_userId: string, nextTimer: object) =>
          Object.assign(timer, nextTimer),
      } as never,
      { emitTimerUpdate: () => undefined } as never,
      { emitTimerWarning } as never
    );

    await service.startCountdown(timer as never, async () => undefined);
    await vi.advanceTimersByTimeAsync(1_000);
    service.stopCountdown('user-1');

    expect(emitTimerWarning).not.toHaveBeenCalled();
  });

  it('does not warn when another instance already claimed the Timer warning', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T18:00:00.000Z'));
    const timer = {
      id: 'timer-1',
      scheduleRevision: 'timer-revision-1',
      userId: 'user-1',
      startTime: Date.now(),
      duration: 5 * 60_000,
      remainingTime: 5 * 60_000,
      type: TIMER_TYPES.WORK,
      status: TIMER_STATUSES.RUNNING,
      hasNotifiedBeforeTimeNotification: false,
    };
    const emitTimerWarning = vi.fn();
    const emitTimerUpdate = vi.fn();
    const service = new TimerCountdownService(
      {
        getPreferences: async () => ({
          notifyBeforeTime: 5 * 60_000,
          notifyBeforeWorkComplete: true,
        }),
      } as never,
      {
        getCurrentTimer: async () => timer,
        claimRunningTimerWarning: async () => {
          timer.scheduleRevision = 'timer-revision-remote-warning';
          timer.hasNotifiedBeforeTimeNotification = true;
          return null;
        },
      } as never,
      { emitTimerUpdate } as never,
      { emitTimerWarning } as never
    );

    await service.startCountdown(timer as never, async () => undefined);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(emitTimerUpdate).not.toHaveBeenCalled();
    expect(emitTimerWarning).not.toHaveBeenCalled();
    expect(
      (
        service as unknown as {
          intervals: Map<string, { scheduleRevision: string }>;
        }
      ).intervals.get('user-1')?.scheduleRevision
    ).toBe('timer-revision-remote-warning');
    service.stopCountdown('user-1');
  });

  it('restarts countdown when an authoritative extension rejects completion', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T18:00:00.000Z'));
    const expiredTimer = {
      id: 'timer-1',
      scheduleRevision: 'timer-revision-1',
      userId: 'user-1',
      startTime: Date.now() - 60_000,
      duration: 60_000,
      remainingTime: 0,
      type: TIMER_TYPES.WORK,
      status: TIMER_STATUSES.RUNNING,
    };
    const extendedTimer = {
      ...expiredTimer,
      duration: 6 * 60_000,
      remainingTime: 5 * 60_000,
    };
    const getCurrentTimer = vi
      .fn()
      .mockResolvedValueOnce(expiredTimer)
      .mockResolvedValueOnce(expiredTimer)
      .mockResolvedValue(extendedTimer);
    const onComplete = vi.fn(async () => undefined);
    const service = new TimerCountdownService(
      {
        getPreferences: async () => ({
          notifyBeforeTime: 0,
          notifyBeforeWorkComplete: false,
        }),
      } as never,
      { getCurrentTimer } as never,
      { emitTimerUpdate: vi.fn() } as never,
      { emitTimerWarning: vi.fn() } as never
    );

    await service.startCountdown(expiredTimer as never, onComplete);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    service.stopCountdown('user-1');

    expect(onComplete).toHaveBeenCalledOnce();
    expect(getCurrentTimer.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('does not contain obsolete local-armed suppression', async () => {
    const { service, fcmPayloads } = createNotificationService();
    expect('shouldSkipAndroidPush' in service).toBe(false);
    await service.sendTimerWarningNotification(
      createTimer({}) as never,
      'user-1',
      5
    );
    expect(fcmPayloads).toHaveLength(1);
  });
});
