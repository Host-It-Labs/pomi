import type { Intention, Task } from '@pomi/shared';
import { bench, describe } from 'vitest';
import {
  buildMinimizedTaskSearchIndex,
  normalizeMinimizedTaskSearch,
  searchMinimizedTaskIndex,
} from './taskSearchIndex';

function makeFixture(taskCount: number, intentionCount: number) {
  const intentions = Array.from({ length: intentionCount }, (_, index) => ({
    id: `intention-${index}`,
    slug: `intention-${index}`,
    title: `Intention ${index}`,
    emoji: '🎯',
    type: 'work',
    parentIntentionId: null,
  })) as Intention[];
  const tasks = Array.from({ length: taskCount }, (_, index) => ({
    id: `task-${index}`,
    title: `Task ${index} benchmark target`,
    description: `Description ${index}`,
    sourceTranscript: null,
    priority: 'normal',
    timerType: 'work',
    intentionSlug: `intention-${index % intentionCount}`,
    subIntentionSlug: null,
    vacationEligible: false,
  })) as Task[];
  return { intentions, tasks };
}

function legacySearch(tasks: Task[], intentions: Intention[], query: string) {
  const normalizedQuery = normalizeMinimizedTaskSearch(query, 'en');
  return tasks.filter(task => {
    const linkedIntentions = intentions.filter(
      intention =>
        intention.type === task.timerType &&
        (intention.slug === task.intentionSlug ||
          intention.slug === task.subIntentionSlug)
    );
    const searchableText = normalizeMinimizedTaskSearch(
      [
        task.title,
        task.description ?? '',
        task.sourceTranscript ?? '',
        task.priority,
        task.timerType,
        ...linkedIntentions.flatMap(intention => [
          intention.title,
          intention.emoji,
        ]),
      ].join(' '),
      'en'
    );
    return normalizedQuery
      .split(' ')
      .every(token => searchableText.includes(token));
  });
}

for (const [taskCount, intentionCount] of [
  [1_000, 100],
  [1_000, 1_000],
  [10_000, 100],
  [10_000, 1_000],
] as const) {
  describe(`${taskCount} tasks and ${intentionCount} intentions`, () => {
    const fixture = makeFixture(taskCount, intentionCount);
    const index = buildMinimizedTaskSearchIndex(
      fixture.tasks,
      fixture.intentions,
      'en'
    );
    const queries = ['benchmark target', 'intention 42', 'missing value'];

    bench('legacy repeated queries', () => {
      for (const query of queries) {
        legacySearch(fixture.tasks, fixture.intentions, query);
      }
    });

    bench('indexed repeated queries', () => {
      for (const query of queries) {
        searchMinimizedTaskIndex(index, query, 'en');
      }
    });

    bench('full index rebuild', () => {
      buildMinimizedTaskSearchIndex(fixture.tasks, fixture.intentions, 'en');
    });
  });
}
