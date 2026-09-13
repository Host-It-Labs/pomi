import type { Intention, Task } from '@pomi/shared';

type TaskSearchDocument = {
  task: Task;
  searchableText: string;
};

export type TaskSearchIndex = {
  documents: Map<string, TaskSearchDocument>;
  candidateCount: number;
};

function intentionKey(type: Intention['type'], slug: string) {
  return `${type}:${slug}`;
}

export function normalizeWorkspaceTaskSearch(value: string, locale: string) {
  return value.trim().toLocaleLowerCase(locale);
}

export function normalizeMinimizedTaskSearch(value: string, locale: string) {
  return value
    .toLocaleLowerCase(locale)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildWorkspaceTaskSearchIndex(
  tasks: Task[],
  intentions: Intention[],
  locale: string
): TaskSearchIndex {
  const parents = new Map<string, Intention>();
  const children = new Map<string, Intention>();
  for (const intention of intentions) {
    const destination = intention.parentIntentionId ? children : parents;
    destination.set(intentionKey(intention.type, intention.slug), intention);
  }

  let candidateCount = 0;
  const documents = new Map<string, TaskSearchDocument>();
  for (const task of tasks) {
    const parent = task.intentionSlug
      ? parents.get(intentionKey(task.timerType, task.intentionSlug))
      : undefined;
    const child = task.subIntentionSlug
      ? children.get(intentionKey(task.timerType, task.subIntentionSlug))
      : undefined;
    const candidates = [
      task.title,
      task.description ?? '',
      task.priority,
      task.dueDate ?? '',
      task.dueTime ?? '',
      parent?.title ?? '',
      parent?.emoji ?? '',
      child?.title ?? '',
      child?.emoji ?? '',
    ];
    candidateCount += candidates.length;
    documents.set(task.id, {
      task,
      searchableText: candidates
        .map(candidate => normalizeWorkspaceTaskSearch(candidate, locale))
        .join('\n'),
    });
  }

  return { documents, candidateCount };
}

export function matchesWorkspaceTaskSearch(
  index: TaskSearchIndex,
  taskId: string,
  normalizedQuery: string
) {
  return (
    normalizedQuery.length === 0 ||
    index.documents.get(taskId)?.searchableText.includes(normalizedQuery) ===
      true
  );
}

export function buildMinimizedTaskSearchIndex(
  tasks: Task[],
  intentions: Intention[],
  locale: string
): TaskSearchIndex {
  const intentionsByKey = new Map<string, Intention[]>();
  for (const intention of intentions) {
    const key = intentionKey(intention.type, intention.slug);
    intentionsByKey.set(key, [...(intentionsByKey.get(key) ?? []), intention]);
  }

  let candidateCount = 0;
  const documents = new Map<string, TaskSearchDocument>();
  for (const task of tasks) {
    const linkedIntentions = new Set<Intention>();
    if (task.intentionSlug) {
      for (const parent of intentionsByKey.get(
        intentionKey(task.timerType, task.intentionSlug)
      ) ?? []) {
        linkedIntentions.add(parent);
      }
    }
    if (task.subIntentionSlug) {
      for (const child of intentionsByKey.get(
        intentionKey(task.timerType, task.subIntentionSlug)
      ) ?? []) {
        linkedIntentions.add(child);
      }
    }

    const candidates = [
      task.title,
      task.description ?? '',
      task.sourceTranscript ?? '',
      task.priority,
      task.timerType,
      ...Array.from(linkedIntentions).flatMap(intention => [
        intention.title,
        intention.emoji,
      ]),
    ];
    candidateCount += candidates.length;
    documents.set(task.id, {
      task,
      searchableText: normalizeMinimizedTaskSearch(
        candidates.join(' '),
        locale
      ),
    });
  }

  return { documents, candidateCount };
}

export function searchMinimizedTaskIndex(
  index: TaskSearchIndex,
  query: string,
  locale: string
) {
  const tokens = normalizeMinimizedTaskSearch(query, locale)
    .split(' ')
    .filter(Boolean);
  if (tokens.length === 0) {
    return Array.from(index.documents.values(), document => document.task);
  }
  return Array.from(index.documents.values())
    .filter(document =>
      tokens.every(token => document.searchableText.includes(token))
    )
    .map(document => document.task);
}
