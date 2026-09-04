import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTodayRange,
  getWeekRange,
  useTodayIntentionsCount,
} from './useTodayIntentionsCount';

const { intentionsToday } = vi.hoisted(() => ({
  intentionsToday: vi.fn(),
}));

vi.mock('../stores/preferencesStore', () => ({
  usePreferencesStore: {
    use: {
      preferences: () => ({
        intentionShowDailyCount: true,
        intentionHabits: true,
        intentionShowBreakIntentionsInLongBreak: false,
      }),
    },
  },
}));
vi.mock('../utils/apiClient', () => ({
  apiClient: { statistics: { intentionsToday } },
}));
vi.mock('../utils/osUtils', () => ({ isTauri: false }));
vi.mock('../utils/socketManager', () => ({
  connectionState: { isConnected: true },
  subscribeToConnectionState: () => () => undefined,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

describe('useTodayIntentionsCount', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-03T12:00:00'));
    intentionsToday.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses local day and Monday-through-Sunday week ranges', () => {
    const today = getTodayRange();
    const week = getWeekRange();

    expect(new Date(today.start).getHours()).toBe(0);
    expect(today.end - today.start).toBe(24 * 60 * 60 * 1000);
    expect(new Date(week.start).getDay()).toBe(1);
    expect(new Date(week.end).getDay()).toBe(1);
  });

  it('applies daily counts when the weekly request fails', async () => {
    intentionsToday
      .mockResolvedValueOnce({
        status: 200,
        body: { count: 2, bySlug: { focus: 2 }, subBySlug: {} },
      })
      .mockRejectedValueOnce(new Error('weekly unavailable'));

    const { result } = renderHook(() => useTodayIntentionsCount());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.count).toBe(2);
    expect(result.current.countBySlug).toEqual({ focus: 2 });
    expect(result.current.weekCountByTypedSlug).toEqual({});
  });
});
