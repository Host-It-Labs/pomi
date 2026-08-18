import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaginationControls } from './PaginationControls';

let host: HTMLDivElement | null = null;

afterEach(() => {
  host?.remove();
  host = null;
});

describe('PaginationControls browser layout', () => {
  it('renders real, ordered, non-overlapping controls', async () => {
    host = document.createElement('div');
    host.style.width = '240px';
    document.body.append(host);
    createRoot(host).render(
      <PaginationControls
        pageIndex={1}
        pageCount={3}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        previousLabel="Previous"
        nextLabel="Next"
      />
    );

    await vi.waitFor(() => {
      expect(host?.querySelectorAll('button')).toHaveLength(2);
    });
    const [previous, next] = Array.from(host.querySelectorAll('button'));
    const previousBounds = previous.getBoundingClientRect();
    const nextBounds = next.getBoundingClientRect();

    expect(previousBounds.width).toBeGreaterThan(0);
    expect(nextBounds.width).toBeGreaterThan(0);
    expect(previousBounds.right).toBeLessThan(nextBounds.left);
    expect(host.textContent).toContain('2/3');
  });
});
