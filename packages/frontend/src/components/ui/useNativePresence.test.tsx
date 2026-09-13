import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNativePresence, useNativePresenceList } from './useNativePresence';

function PresenceProbe({ visible }: { visible: boolean }) {
  const presence = useNativePresence(visible ? 'content' : null, 200);
  return presence.shouldRender ? (
    <button
      data-testid="presence"
      data-presence={presence.phase}
      aria-hidden={presence.isExiting || undefined}
    >
      {presence.value}
    </button>
  ) : null;
}

function PresenceListProbe() {
  const [items, setItems] = useState(['first', 'second']);
  const rendered = useNativePresenceList(items, item => item, 70);
  return (
    <>
      <button type="button" onClick={() => setItems(['second'])}>
        Remove
      </button>
      {rendered.map(item => (
        <span key={item.key} data-presence={item.phase}>
          {item.value}
        </span>
      ))}
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('native presence', () => {
  it('keeps exiting content mounted and non-interactive until its animation ends', () => {
    const view = render(<PresenceProbe visible />);
    view.rerender(<PresenceProbe visible={false} />);

    expect(screen.getByTestId('presence')).toHaveAttribute(
      'data-presence',
      'exiting'
    );
    expect(screen.getByTestId('presence')).toHaveAttribute(
      'aria-hidden',
      'true'
    );

    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByTestId('presence')).not.toBeInTheDocument();
  });

  it('cancels delayed removal when content rapidly reopens', () => {
    const view = render(<PresenceProbe visible />);
    view.rerender(<PresenceProbe visible={false} />);
    view.rerender(<PresenceProbe visible />);
    act(() => vi.advanceTimersByTime(400));

    expect(screen.getByTestId('presence')).toHaveAttribute(
      'data-presence',
      'entered'
    );
    expect(screen.getByTestId('presence')).not.toHaveAttribute('aria-hidden');
  });

  it('removes content immediately when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    const view = render(<PresenceProbe visible />);
    view.rerender(<PresenceProbe visible={false} />);

    expect(screen.queryByTestId('presence')).not.toBeInTheDocument();
  });

  it('retains removed list rows only for the bounded exit interval', () => {
    render(<PresenceListProbe />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(screen.getByText('first')).toHaveAttribute(
      'data-presence',
      'exiting'
    );
    act(() => vi.advanceTimersByTime(70));
    expect(screen.queryByText('first')).not.toBeInTheDocument();
    expect(screen.getByText('second')).toBeInTheDocument();
  });
});
