const SYMBOL_WORDS: Record<string, string> = {
  '+': 'plus',
  '&': 'and',
  '@': 'at',
  '#': 'number',
  '%': 'percent',
};

function getStableSlugSuffix(value: string): string {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }

  return hash.toString(36);
}

export function generateIntentionSlug(title: string): string {
  const expandedTitle = Array.from(title)
    .map(char => (SYMBOL_WORDS[char] ? ` ${SYMBOL_WORDS[char]} ` : char))
    .join('');
  const slug = expandedTitle
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length > 0) {
    return slug;
  }

  return `intention-${getStableSlugSuffix(title) || 'untitled'}`;
}
