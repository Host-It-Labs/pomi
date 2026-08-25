const OMITTED_ELEMENTS = new Set(['noscript', 'script', 'style', 'template']);

function renderChildren(node: Node): string {
  return Array.from(node.childNodes, renderNode).join('');
}

function renderList(element: Element, ordered: boolean): string {
  const items = Array.from(element.children).filter(
    child => child.tagName.toLowerCase() === 'li'
  );
  return `\n${items
    .map((item, index) => {
      const prefix = ordered ? `${index + 1}.` : '-';
      return `${prefix} ${renderChildren(item).trim()}`;
    })
    .join('\n')}\n`;
}

function safeLinkHref(value: string | null): string | null {
  if (
    !value ||
    Array.from(value).some(character => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    return null;
  }

  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function renderLink(element: Element): string {
  const label = renderChildren(element).replace(/\s+/g, ' ').trim();
  const href = safeLinkHref(element.getAttribute('href'));
  if (!href || !label || label.includes('[') || label.includes(']')) {
    return label;
  }
  return `[${label}](${href})`;
}

function renderNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.nodeValue ?? '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (OMITTED_ELEMENTS.has(tag)) {
    return '';
  }

  if (tag === 'br') return '\n';
  if (tag === 'ul') return renderList(element, false);
  if (tag === 'ol') return renderList(element, true);
  if (tag === 'a') return renderLink(element);

  const content = renderChildren(element);
  if (tag === 'h1') return `\n# ${content.trim()}\n`;
  if (tag === 'h2') return `\n## ${content.trim()}\n`;
  if (tag === 'h3') return `\n### ${content.trim()}\n`;
  if (tag === 'strong' || tag === 'b') return `**${content}**`;
  if (tag === 'em' || tag === 'i') return `*${content}*`;
  if (tag === 'code') return `\`${content.replace(/`/g, "'")}\``;
  if (tag === 'article' || tag === 'div' || tag === 'p' || tag === 'section') {
    return `\n${content}\n`;
  }
  return content;
}

export function normalizeVikunjaDescription(
  description: string | null
): string | null {
  if (!description?.trim()) {
    return null;
  }

  const document = new DOMParser().parseFromString(description, 'text/html');
  const markdown = renderChildren(document.body)
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return markdown || null;
}
