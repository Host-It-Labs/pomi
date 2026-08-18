import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  delete window.__POMI_TEST_PLATFORM__;
  vi.resetModules();
});

describe('mobile modal history registry', () => {
  it('closes nested modals in LIFO order on native back events', async () => {
    window.__POMI_TEST_PLATFORM__ = 'android';
    const { registerOpenModal } = await import('./modalRegistry');
    const closed: string[] = [];
    let unregisterParent = () => {};
    let unregisterChild = () => {};
    unregisterParent = registerOpenModal(() => {
      closed.push('parent');
      unregisterParent();
    });
    unregisterChild = registerOpenModal(() => {
      closed.push('child');
      unregisterChild();
    });

    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(closed).toEqual(['child']);
    await new Promise(resolve => window.setTimeout(resolve, 0));

    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(closed).toEqual(['child', 'parent']);
  });
});
