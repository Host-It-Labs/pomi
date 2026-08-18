import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileSwipeActionRow } from './MobileSwipeActionRow';

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
});

describe('MobileSwipeActionRow browser gesture', () => {
  it('tracks the pointer and commits a completed swipe', async () => {
    const onComplete = vi.fn();
    host = document.createElement('div');
    host.style.width = '320px';
    document.body.append(host);
    root = createRoot(host);
    root.render(
      <MobileSwipeActionRow
        disabled={false}
        onComplete={onComplete}
        onArchive={vi.fn()}
      >
        <div style={{ height: 48 }}>Task</div>
      </MobileSwipeActionRow>
    );

    await vi.waitFor(() => expect(host?.firstElementChild).toBeTruthy());
    const row = host.firstElementChild as HTMLElement;
    expect(
      row.querySelector('[data-testid="mobile-swipe-actions"]')
    ).toBeNull();
    const content = row.lastElementChild as HTMLElement;
    row.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'touch',
        clientX: 10,
        clientY: 10,
      })
    );
    row.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'touch',
        clientX: 96,
        clientY: 12,
      })
    );

    await vi.waitFor(() =>
      expect(content.style.transform).not.toBe('translate3d(0px, 0, 0)')
    );
    row.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'touch',
        clientX: 96,
        clientY: 12,
      })
    );
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
  });

  it('springs back below threshold and requests archive above it', async () => {
    const onArchive = vi.fn();
    host = document.createElement('div');
    host.style.width = '320px';
    document.body.append(host);
    root = createRoot(host);
    root.render(
      <MobileSwipeActionRow
        disabled={false}
        onComplete={vi.fn()}
        onArchive={onArchive}
      >
        <div style={{ height: 48 }}>Task</div>
      </MobileSwipeActionRow>
    );

    await vi.waitFor(() => expect(host?.firstElementChild).toBeTruthy());
    const row = host.firstElementChild as HTMLElement;
    const content = row.lastElementChild as HTMLElement;
    dispatchPointer(row, 'pointerdown', 120, 10);
    dispatchPointer(row, 'pointermove', 80, 12);
    dispatchPointer(row, 'pointerup', 80, 12);
    await vi.waitFor(() =>
      expect(content.style.transform).toMatch(
        /^translate3d\(0px, 0(?:px)?, 0(?:px)?\)$/
      )
    );
    expect(onArchive).not.toHaveBeenCalled();

    dispatchPointer(row, 'pointerdown', 120, 10);
    dispatchPointer(row, 'pointermove', 20, 12);
    dispatchPointer(row, 'pointerup', 20, 12);
    await vi.waitFor(() => expect(onArchive).toHaveBeenCalledOnce());
  });

  it('leaves vertical pointer movement to the scroll container', async () => {
    const onComplete = vi.fn();
    const onArchive = vi.fn();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    root.render(
      <MobileSwipeActionRow
        disabled={false}
        onComplete={onComplete}
        onArchive={onArchive}
      >
        <div style={{ height: 48 }}>Task</div>
      </MobileSwipeActionRow>
    );

    await vi.waitFor(() => expect(host?.firstElementChild).toBeTruthy());
    const row = host.firstElementChild as HTMLElement;
    const content = row.lastElementChild as HTMLElement;
    dispatchPointer(row, 'pointerdown', 10, 10);
    dispatchPointer(row, 'pointermove', 13, 80);
    dispatchPointer(row, 'pointerup', 13, 80);

    expect(content.style.transform).toMatch(
      /^translate3d\(0px, 0(?:px)?, 0(?:px)?\)$/
    );
    expect(onComplete).not.toHaveBeenCalled();
    expect(onArchive).not.toHaveBeenCalled();
    expect(
      row.querySelector('[data-testid="mobile-swipe-actions"]')
    ).toBeNull();
  });
});

function dispatchPointer(
  target: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  clientX: number,
  clientY: number
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      pointerId: 1,
      pointerType: 'touch',
      clientX,
      clientY,
    })
  );
}
