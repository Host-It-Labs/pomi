import type { Preferences, Timer, TimerExtensionState } from '@pomi/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdvancedSkipModal } from '../components/AdvancedSkipModal';
import { TimerExtensionModal } from '../components/TimerExtensionModal';
import { IntentionAssignmentPicker } from '../components/intentions/IntentionAssignmentPicker';
import {
  getAdvancedSkipElapsedMs,
  getAdvancedSkipFullMs,
  shouldOpenAdvancedSkipModal,
} from '../utils/advancedSkip';
import { getDisplayedSessionPosition } from '../utils/sessionDisplay';

const mocks = vi.hoisted(() => ({
  preferences: { keyboardShortcuts: true, advancedSkip: true } as Preferences,
}));

vi.mock('../stores/preferencesStore', () => ({
  usePreferencesStore: {
    use: { preferences: () => mocks.preferences },
  },
}));

vi.mock('../utils/osUtils', () => ({
  isDesktop: true,
  isMac: false,
  isMobile: false,
}));

function timer(overrides: Partial<Timer>): Timer {
  return {
    id: 'timer',
    userId: 'user',
    type: 'work',
    status: 'paused',
    duration: 300_000,
    remainingTime: 300_000,
    startTime: 0,
    intentionSlugs: [],
    subIntentions: {},
    isExtension: false,
    ...overrides,
  } as Timer;
}

beforeEach(() => {
  mocks.preferences = {
    keyboardShortcuts: true,
    advancedSkip: true,
  } as Preferences;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Legacy Timer expectations moved below Playwright', () => {
  it('advanced skip bypasses confirmation before start, then requires a log decision after elapsed work', () => {
    const preferences = { advancedSkip: true } as Preferences;

    expect(shouldOpenAdvancedSkipModal(timer({}), preferences)).toBe(false);
    expect(
      shouldOpenAdvancedSkipModal(
        timer({ remainingTime: 299_999 }),
        preferences
      )
    ).toBe(true);
    expect(
      shouldOpenAdvancedSkipModal(
        timer({ status: 'completed', remainingTime: 0 }),
        preferences
      )
    ).toBe(false);
    expect(shouldOpenAdvancedSkipModal(timer({}), null)).toBe(false);
  });

  it('advanced skip carries the original work duration into an extension log decision', () => {
    vi.useFakeTimers();
    vi.setSystemTime(180_000);
    const extension = timer({
      status: 'running',
      startTime: 120_000,
      duration: 300_000,
      isExtension: true,
      extensionBaseDuration: 600_000,
    });

    expect(getAdvancedSkipElapsedMs(extension)).toBe(660_000);
    expect(getAdvancedSkipFullMs(extension)).toBe(900_000);
  });

  it('keeps the three advanced-skip actions and keyboard choices visible for a started timer', () => {
    const onSelect = vi.fn();
    render(
      <AdvancedSkipModal
        isOpen
        timer={timer({ remainingTime: 240_000 })}
        onCancel={vi.fn()}
        onSelect={onSelect}
      />
    );

    expect(screen.getByRole('button', { name: /Elapsed/ })).toHaveTextContent(
      'Press 1'
    );
    expect(screen.getByRole('button', { name: /Full/ })).toHaveTextContent(
      'Press 2'
    );
    expect(screen.getByRole('button', { name: /No log/ })).toHaveTextContent(
      'Press 0'
    );

    fireEvent.keyDown(window, { code: 'Digit1' });
    fireEvent.keyDown(window, { code: 'Digit2' });
    fireEvent.keyDown(window, { code: 'Digit0' });
    expect(onSelect.mock.calls.map(([mode]) => mode)).toEqual([
      'elapsed',
      'full',
      'none',
    ]);
  });

  it('shows every selected intention emoji pair beside the Advanced Skip title', () => {
    render(
      <AdvancedSkipModal
        isOpen
        timer={timer({
          intention: 'focus',
          intentionSlugs: ['focus', 'health'],
          intentionEmoji: '🎯',
          subIntentionEmoji: '🧭',
          intentionEmojis: { focus: '🎯', health: '❤️' },
          subIntentionEmojis: { focus: '🧭', health: '🍎' },
          remainingTime: 240_000,
        })}
        onCancel={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByText('Advanced Skip')).toBeInTheDocument();
    expect(screen.getByText('🎯')).toBeInTheDocument();
    expect(screen.getByText('🧭')).toBeInTheDocument();
    expect(screen.getByText('❤️')).toBeInTheDocument();
    expect(screen.getByText('🍎')).toBeInTheDocument();
  });
});

describe('Legacy Intention expectations moved below Playwright', () => {
  it('requires an explicit sub-intention and submits the preserved parent-child pair', () => {
    const onChange = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <IntentionAssignmentPicker
        label="Work intention"
        options={[{ value: 'parent', title: 'Parent', emoji: '🧭' }]}
        subIntentionsByParent={{
          parent: [{ slug: 'child', title: 'Child', emoji: '🗺️' }],
        }}
        selectedIntentions={[]}
        selectedSubIntentions={{}}
        mode="single"
        isOpen
        onOpenChange={onOpenChange}
        onChange={onChange}
        parentSelectionLabel={undefined}
      />
    );

    fireEvent.click(screen.getByRole('option', { name: /Parent/ }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Child/ }));
    expect(onChange).toHaveBeenCalledWith({
      intentionSlugs: ['parent'],
      subIntentions: { parent: 'child' },
      reason: 'subIntention',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('Legacy Session and extension expectations moved below Playwright', () => {
  it('keeps an extension on the originating session marker and exposes both resolution actions', () => {
    vi.useFakeTimers();
    vi.setSystemTime(180_000);
    const onSelect = vi.fn();
    const extensionState = {
      startTime: 120_000,
      originalDuration: 1_200_000,
      originalTimerId: 'work-timer',
      intentionEmoji: '🎯',
      subIntentionEmoji: '🧪',
    } as TimerExtensionState;

    expect(
      getDisplayedSessionPosition(
        timer({ isExtension: true, sessionPosition: 3 })
      )
    ).toBe(2);

    render(
      <TimerExtensionModal
        isOpen
        extensionState={extensionState}
        onCancel={vi.fn()}
        onSelect={onSelect}
      />
    );

    expect(screen.getByRole('dialog', { name: 'Extend timer' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Log total/ })).toHaveTextContent(
      '21m 0s'
    );
    expect(
      screen.getByRole('button', { name: /Add 5 Minutes/ })
    ).toHaveTextContent('21m 0s + 5m');

    fireEvent.keyDown(window, { code: 'Digit1' });
    fireEvent.keyDown(window, { code: 'Digit2' });
    expect(onSelect.mock.calls.map(([action]) => action)).toEqual([
      'logElapsed',
      'addFiveMinutes',
    ]);
  });
});
