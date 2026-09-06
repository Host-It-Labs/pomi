import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// Execute the emitted modules, not Vite's development transforms: chunk cycles
// can pass compilation and source tests while failing before React mounts.
const dist = new URL('../packages/frontend/dist/', import.meta.url);
const html = readFileSync(new URL('index.html', dist), 'utf8');
const entry = html.match(/<script[^>]+src="([^"]+)"/)[1];
const dom = new JSDOM('<div id="root"></div>', {
  url: 'https://tauri.localhost',
  pretendToBeVisual: true,
});
for (const key of [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'MutationObserver',
  'HTMLElement',
  'location',
  'history',
]) {
  Object.defineProperty(globalThis, key, {
    value: dom.window[key],
    configurable: true,
  });
}
for (const key of [
  'addEventListener',
  'removeEventListener',
  'requestAnimationFrame',
  'cancelAnimationFrame',
]) {
  globalThis[key] = dom.window[key].bind(dom.window);
}
// Never contact the configured backend or Sentry during the smoke check.
globalThis.fetch = async () => new globalThis.Response('{}', { status: 401 });
dom.window.fetch = globalThis.fetch;
dom.window.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
dom.window.scrollTo = () => {};
dom.window.localStorage.setItem('pomi-backend-url', 'https://example.invalid');

async function verifyStartup() {
  try {
    const mounted = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error('Production bundle did not render the login form'));
      }, 10_000);
      const observer = new dom.window.MutationObserver(() => {
        if (!dom.window.document.querySelector('input[type="password"]'))
          return;
        clearTimeout(timeout);
        observer.disconnect();
        resolve();
      });
      observer.observe(dom.window.document.body, {
        childList: true,
        subtree: true,
      });
    });
    await import(new URL(entry.replace(/^\//, ''), dist));
    await mounted;
    assert.ok(dom.window.document.querySelector('input[type="password"]'));
    process.stdout.write(
      'Production frontend startup passed: login form rendered.\n'
    );
    process.exit(0);
  } catch (error) {
    process.stderr.write(`${error.stack}\n`);
    process.exit(1);
  }
}

void verifyStartup();
