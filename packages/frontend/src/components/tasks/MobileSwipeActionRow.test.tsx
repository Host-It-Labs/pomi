import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileSwipeActionRow } from './MobileSwipeActionRow';

describe('MobileSwipeActionRow', () => {
  afterEach(() => vi.useRealTimers());

  it('tracks a horizontal gesture and completes above the threshold', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    render(
      <MobileSwipeActionRow
        disabled={false}
        onComplete={onComplete}
        onArchive={vi.fn()}
      >
        <div>Task row</div>
      </MobileSwipeActionRow>
    );
    const row = screen.getByTestId('mobile-swipe-row');
    row.setPointerCapture = vi.fn();

    fireEvent(row, pointerEvent('pointerdown', 10, 10));
    fireEvent(row, pointerEvent('pointermove', 95, 12));
    expect(row.lastElementChild).not.toHaveStyle({
      transform: 'translate3d(0px, 0, 0)',
    });
    fireEvent(row, pointerEvent('pointerup', 95, 12));
    act(() => vi.advanceTimersByTime(140));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('does not capture a vertical gesture', () => {
    const onComplete = vi.fn();
    render(
      <MobileSwipeActionRow
        disabled={false}
        onComplete={onComplete}
        onArchive={vi.fn()}
      >
        <div>Task row</div>
      </MobileSwipeActionRow>
    );
    const row = screen.getByTestId('mobile-swipe-row');
    expect(
      screen.queryByTestId('mobile-swipe-actions')
    ).not.toBeInTheDocument();
    row.setPointerCapture = vi.fn();

    fireEvent(row, pointerEvent('pointerdown', 10, 10));
    fireEvent(row, pointerEvent('pointermove', 12, 70));
    fireEvent(row, pointerEvent('pointerup', 12, 70));

    expect(onComplete).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('mobile-swipe-actions')
    ).not.toBeInTheDocument();
    expect(row.lastElementChild).toHaveStyle({
      transform: 'translate3d(0px, 0, 0)',
    });
  });

  it('only paints actions after a horizontal direction lock', () => {
    render(
      <MobileSwipeActionRow
        disabled={false}
        onComplete={vi.fn()}
        onArchive={vi.fn()}
      >
        <div>Task row</div>
      </MobileSwipeActionRow>
    );
    const row = screen.getByTestId('mobile-swipe-row');
    row.setPointerCapture = vi.fn();
    fireEvent(row, pointerEvent('pointerdown', 10, 10));
    fireEvent(row, pointerEvent('pointermove', 14, 12));
    expect(
      screen.queryByTestId('mobile-swipe-actions')
    ).not.toBeInTheDocument();
    fireEvent(row, pointerEvent('pointermove', 40, 12));
    expect(screen.getByTestId('mobile-swipe-actions')).toBeInTheDocument();
  });

  it('allows swipes to begin on metadata triggers', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    render(
      <MobileSwipeActionRow
        disabled={false}
        onComplete={onComplete}
        onArchive={vi.fn()}
      >
        <button type="button" data-swipe-start>
          Tomorrow
        </button>
      </MobileSwipeActionRow>
    );
    const row = screen.getByTestId('mobile-swipe-row');
    const metadata = screen.getByRole('button', { name: 'Tomorrow' });
    row.setPointerCapture = vi.fn();

    fireEvent(metadata, pointerEvent('pointerdown', 10, 10));
    fireEvent(row, pointerEvent('pointermove', 100, 12));
    fireEvent(row, pointerEvent('pointerup', 100, 12));
    act(() => vi.advanceTimersByTime(140));

    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('still ignores ordinary action buttons', () => {
    const onComplete = vi.fn();
    render(
      <MobileSwipeActionRow
        disabled={false}
        onComplete={onComplete}
        onArchive={vi.fn()}
      >
        <button type="button">Edit</button>
      </MobileSwipeActionRow>
    );
    const row = screen.getByTestId('mobile-swipe-row');
    const action = screen.getByRole('button', { name: 'Edit' });
    row.setPointerCapture = vi.fn();

    fireEvent(action, pointerEvent('pointerdown', 10, 10));
    fireEvent(row, pointerEvent('pointermove', 100, 12));
    fireEvent(row, pointerEvent('pointerup', 100, 12));

    expect(onComplete).not.toHaveBeenCalled();
    expect(row.lastElementChild).toHaveStyle({
      transform: 'translate3d(0px, 0, 0)',
    });
  });
});

function pointerEvent(type: string, clientX: number, clientY: number) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: 'touch' },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  return event;
}
