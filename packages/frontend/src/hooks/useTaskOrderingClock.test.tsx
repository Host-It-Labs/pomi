import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTaskOrderingClock } from './useTaskOrderingClock';

function ClockHarness() {
  const clock = useTaskOrderingClock();
  return (
    <output data-testid="clock">
      {clock.today} {clock.currentTime}
    </output>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useTaskOrderingClock', () => {
  it('refreshes at the next local minute, including local midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 26, 23, 59, 59, 500));

    render(<ClockHarness />);
    expect(screen.getByTestId('clock')).toHaveTextContent('2026-07-26 23:59');

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByTestId('clock')).toHaveTextContent('2026-07-27 00:00');
  });
});
