import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  root?.unmount();
  host?.remove();
  document.body.style.minHeight = '';
  window.scrollTo({ top: 0 });
  root = null;
  host = null;
});

describe('Modal browser scroll lock', () => {
  it('keeps the page at the same scroll position', async () => {
    document.body.style.minHeight = '2200px';
    host = document.createElement('div');
    document.body.append(host);
    window.scrollTo({ top: 640 });
    const beforeOpen = window.scrollY;
    root = createRoot(host);
    flushSync(() => {
      root?.render(
        <Modal
          isOpen
          title="Editor"
          onClose={vi.fn()}
          closeOnEscape
          closeOnBackdropClick={false}
        >
          Content
        </Modal>
      );
    });

    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeTruthy()
    );
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(window.scrollY).toBe(beforeOpen);

    root.unmount();
    root = null;
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(window.scrollY).toBe(beforeOpen);
  });

  it('preserves the original position while nested modals open and close', async () => {
    document.body.style.minHeight = '2200px';
    host = document.createElement('div');
    document.body.append(host);
    window.scrollTo({ top: 480 });
    const beforeOpen = window.scrollY;
    root = createRoot(host);

    flushSync(() => {
      root?.render(
        <>
          <Modal
            isOpen
            title="Editor"
            onClose={vi.fn()}
            closeOnBackdropClick={false}
            closeOnEscape
          >
            Content
          </Modal>
          <Modal
            isOpen
            title="Confirm"
            onClose={vi.fn()}
            closeOnBackdropClick={false}
            closeOnEscape
          >
            Confirmation
          </Modal>
        </>
      );
    });
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(window.scrollY).toBe(beforeOpen);

    flushSync(() => {
      root?.render(
        <Modal
          isOpen
          title="Editor"
          onClose={vi.fn()}
          closeOnBackdropClick={false}
          closeOnEscape
        >
          Content
        </Modal>
      );
    });
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(window.scrollY).toBe(beforeOpen);

    root.unmount();
    root = null;
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(window.scrollY).toBe(beforeOpen);
  });

  it('keeps the header and action footer visible in a short viewport', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    flushSync(() => {
      root?.render(
        <Modal
          isOpen
          title="Short viewport editor"
          onClose={vi.fn()}
          closeOnEscape
          closeOnBackdropClick={false}
          className="!max-h-[320px]"
        >
          <form
            style={{
              display: 'flex',
              flexDirection: 'column',
              height: 244,
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
            <div
              data-testid="long-middle"
              style={{ flex: '1 1 0%', minHeight: 0, overflowY: 'auto' }}
            >
              <div style={{ height: 600 }}>Long editor content</div>
            </div>
            <div
              data-testid="fixed-actions"
              style={{ flexShrink: 0, paddingBlock: 12 }}
            >
              <button type="button">Cancel</button>
              <button type="submit">Save</button>
            </div>
          </form>
        </Modal>
      );
    });

    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-testid="fixed-actions"]')
      ).toBeTruthy()
    );
    const panel = document.querySelector('[data-testid="modal-panel"]')!;
    const title = document.querySelector('h2')!;
    const middle = document.querySelector('[data-testid="long-middle"]')!;
    const actions = document.querySelector('[data-testid="fixed-actions"]')!;
    expect(title.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      panel.getBoundingClientRect().top
    );
    expect(actions.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      panel.getBoundingClientRect().bottom
    );
    expect(middle.scrollHeight).toBeGreaterThan(middle.clientHeight);
  });
});
