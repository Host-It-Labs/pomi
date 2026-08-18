import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../App.css';
import { MOBILE_TASK_SCROLL_GUTTER_CLASS } from './MinimizedTaskView';
import { ManagerRowActions } from './intentions/ManagerRowActions';

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
});

describe('Task and manager polish geometry', () => {
  it('keeps trailing manager controls round, aligned, and non-overlapping', async () => {
    host = document.createElement('div');
    host.style.width = '280px';
    host.className = 'flex justify-end';
    document.body.append(host);
    root = createRoot(host);
    root.render(
      <ManagerRowActions
        isFavorite={false}
        label="Release"
        onFavorite={vi.fn()}
        onEdit={vi.fn()}
      />
    );

    await vi.waitFor(() =>
      expect(host?.querySelectorAll('button')).toHaveLength(2)
    );
    const controls = Array.from(host!.querySelectorAll('button'));
    const bounds = controls.map(control => control.getBoundingClientRect());
    bounds.forEach(bound => {
      expect(bound.width).toBe(32);
      expect(bound.height).toBe(32);
    });
    expect(bounds[0].right).toBeLessThanOrEqual(bounds[1].left);
    expect(bounds[1].right).toBeLessThanOrEqual(
      host.getBoundingClientRect().right
    );
    expect(
      Number.parseFloat(getComputedStyle(controls[0]).borderTopLeftRadius)
    ).toBeGreaterThanOrEqual(16);
  });

  it('places the mobile Task scrollbar in the outer gutter without narrowing rows', async () => {
    host = document.createElement('div');
    host.style.width = '320px';
    host.style.height = '120px';
    host.style.overflow = 'hidden';
    document.body.append(host);
    root = createRoot(host);
    root.render(
      <div data-testid="gutter" className={MOBILE_TASK_SCROLL_GUTTER_CLASS}>
        <div data-testid="row" className="h-10 w-full bg-slate-800" />
        <div className="h-40" />
      </div>
    );

    await vi.waitFor(() =>
      expect(host?.querySelector('[data-testid="row"]')).toBeTruthy()
    );
    const outer = host.getBoundingClientRect();
    const gutter = host
      .querySelector('[data-testid="gutter"]')!
      .getBoundingClientRect();
    const row = host
      .querySelector('[data-testid="row"]')!
      .getBoundingClientRect();
    expect(gutter.right).toBeGreaterThan(outer.right);
    expect(row.width).toBeGreaterThanOrEqual(outer.width - 1);
    expect(row.right).toBeLessThanOrEqual(outer.right + 1);
  });
});
