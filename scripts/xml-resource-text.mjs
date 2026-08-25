import { JSDOM } from 'jsdom';

export function parseAndroidStringResources(source, sourceLabel) {
  let document;
  try {
    document = new JSDOM(source, { contentType: 'text/xml' }).window.document;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Invalid Android string resources in ${sourceLabel}: ${detail}`
    );
  }

  const values = new Map();
  for (const element of document.querySelectorAll(
    'resources > string[name], resources > plurals[name]'
  )) {
    const name = element.getAttribute('name');
    if (name) {
      values.set(name, element.textContent?.trim() ?? '');
    }
  }
  return values;
}
