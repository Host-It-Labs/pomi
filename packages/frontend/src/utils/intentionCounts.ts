import type { IntentionType } from '@pomi/shared';

export type IntentionCountEntry = {
  type: IntentionType;
  count: number;
  bySlug: Record<string, number>;
  subBySlug?: Record<string, number>;
};

export const getTypedCountKey = (type: IntentionType, slug: string) =>
  `${type}:${slug}`;

export function mergeIntentionCounts(entries: IntentionCountEntry[]) {
  const bySlug: Record<string, number> = {};
  const subBySlug: Record<string, number> = {};
  const byTypedSlug: Record<string, number> = {};
  const subByTypedSlug: Record<string, number> = {};
  let count = 0;

  entries.forEach(entry => {
    count += entry.count;
    Object.entries(entry.bySlug).forEach(([slug, value]) => {
      bySlug[slug] = (bySlug[slug] ?? 0) + value;
      byTypedSlug[getTypedCountKey(entry.type, slug)] = value;
    });
    Object.entries(entry.subBySlug ?? {}).forEach(([slug, value]) => {
      subBySlug[slug] = (subBySlug[slug] ?? 0) + value;
      subByTypedSlug[getTypedCountKey(entry.type, slug)] = value;
    });
  });

  return { count, bySlug, subBySlug, byTypedSlug, subByTypedSlug };
}

export function getTypedLeafCount(
  type: IntentionType,
  slug: string,
  byTypedSlug: Record<string, number>,
  subByTypedSlug: Record<string, number>
) {
  const key = getTypedCountKey(type, slug);
  return (byTypedSlug[key] ?? 0) + (subByTypedSlug[key] ?? 0);
}

export function getTypedAggregateCount(
  type: IntentionType,
  slug: string,
  childSlugs: string[],
  byTypedSlug: Record<string, number>,
  subByTypedSlug: Record<string, number>
) {
  return (
    (byTypedSlug[getTypedCountKey(type, slug)] ?? 0) +
    childSlugs.reduce(
      (total, childSlug) =>
        total + (subByTypedSlug[getTypedCountKey(type, childSlug)] ?? 0),
      0
    )
  );
}
