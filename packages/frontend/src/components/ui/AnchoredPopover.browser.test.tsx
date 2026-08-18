import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnchoredPopover } from './AnchoredPopover';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
});

describe('AnchoredPopover', () => {
  it('portals above clipped row content and closes on scroll', async () => {
    const onOpenChange = vi.fn();
    host = document.createElement('div');
    host.style.overflow = 'hidden';
    host.style.height = '20px';
    document.body.append(host);
    root = createRoot(host);
    root.render(
      <AnchoredPopover
        isOpen
        onOpenChange={onOpenChange}
        trigger={<button type="button">More</button>}
        className="w-40"
      >
        <button type="button">Edit</button>
      </AnchoredPopover>
    );

    await vi.waitFor(() =>
      expect(document.body.querySelector('[role="menu"]')).toBeTruthy()
    );
    const menu = document.body.querySelector('[role="menu"]') as HTMLElement;
    expect(host.contains(menu)).toBe(false);
    expect(menu.classList.contains('fixed')).toBe(true);

    window.dispatchEvent(new Event('scroll'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
