import type { Preferences, Timer, TimerExtensionState } from '@pomi/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdvancedSkipInlineStrip } from './AdvancedSkipInlineStrip';
import { CompactTimerDisplay } from './CompactTimer';
import { TimerExtensionModal } from './TimerExtensionModal';

const mocks = vi.hoisted(() => ({
  preferences: { keyboardShortcuts: true } as Preferences,
  setSessionPosition: vi.fn(),
  timer: null as Timer | null,
  disconnected: false,
}));

vi.mock('../stores/preferencesStore', () => ({
  usePreferencesStore: {
    use: { preferences: () => mocks.preferences },
  },
}));

vi.mock('../stores/timerStore', () => ({
  useTimerStore: {
    use: {
      setSessionPosition: () => mocks.setSessionPosition,
      timer: () => mocks.timer,
      connectionStatus: () => ({
        isConnected: !mocks.disconnected,
        isReconnecting: false,
      }),
      toggleTimer: () => vi.fn(),
      extensionState: () => null,
    },
  },
}));

vi.mock('../utils/osUtils', () => ({
  isDesktop: true,
  isMobile: false,
  isMac: false,
}));

function timer(overrides: Partial<Timer>): Timer {
  return {
    id: 'timer',
    userId: 'user',
    type: 'work',
    status: 'running',
    duration: 300_000,
    remainingTime: 240_000,
    startTime: 40_000,
    intentionSlugs: [],
    subIntentions: {},
    isExtension: false,
    ...overrides,
  } as Timer;
}

beforeEach(() => {
  mocks.setSessionPosition.mockReset();
  mocks.preferences = { keyboardShortcuts: true } as Preferences;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Timer and Session presentation', () => {
  it('selects ring segments directly and disables them when disconnected', async () => {
    const user = userEvent.setup();
    mocks.preferences = {
      keyboardShortcuts: true,
      sessionsExtension: true,
    } as Preferences;
    mocks.timer = timer({ sessionPosition: 2, sessionTotal: 4 });
    mocks.disconnected = false;
    const { rerender } = render(<CompactTimerDisplay />);
    const segments = screen.getAllByRole('button', { name: /^Work [1-4]\/4$/ });
    expect(segments).toHaveLength(4);
    expect(segments[1]).toHaveAttribute('aria-pressed', 'true');
    await user.click(segments[3]);
    expect(mocks.setSessionPosition).toHaveBeenCalledWith(4);
    expect(screen.queryByRole('dialog')).toBeNull();
    mocks.disconnected = true;
    rerender(<CompactTimerDisplay />);
    await user.click(segments[2]);
    expect(mocks.setSessionPosition).toHaveBeenCalledOnce();
    expect(segments[2]).toHaveAttribute('aria-disabled', 'true');
  });

  it('offers deterministic advanced-skip durations by pointer and keyboard', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    render(
      <AdvancedSkipInlineStrip
        timer={timer({})}
        onSelect={onSelect}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText('1m 0s')).toBeInTheDocument();
    expect(screen.getByText('5m 0s')).toBeInTheDocument();
    fireEvent.click(screen.getByText('No log'));
    fireEvent.keyDown(window, { code: 'Digit1' });
    fireEvent.keyDown(window, { code: 'Numpad2' });
    fireEvent.keyDown(window, { code: 'Escape' });

    expect(onSelect.mock.calls.map(([mode]) => mode)).toEqual([
      'none',
      'elapsed',
      'full',
    ]);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('presents extension totals and resolves both choices without elapsed waits', () => {
    vi.useFakeTimers();
    vi.setSystemTime(160_000);
    const onSelect = vi.fn();
    const extensionState = {
      startTime: 100_000,
      originalDuration: 1_200_000,
      intentionEmoji: '🎯',
      subIntentionEmoji: '🧪',
    } as TimerExtensionState;

    render(
      <TimerExtensionModal
        isOpen
        extensionState={extensionState}
        onCancel={vi.fn()}
        onSelect={onSelect}
      />
    );

    expect(screen.getByRole('dialog', { name: 'Extend timer' })).toBeVisible();
    expect(screen.getByText('21m 0s')).toBeInTheDocument();
    expect(screen.getByText('21m 0s + 5m')).toBeInTheDocument();
    fireEvent.click(screen.getByText('21m 0s'));
    fireEvent.keyDown(window, { code: 'Digit2' });

    expect(onSelect.mock.calls.map(([action]) => action)).toEqual([
      'logElapsed',
      'addFiveMinutes',
    ]);
  });
});
