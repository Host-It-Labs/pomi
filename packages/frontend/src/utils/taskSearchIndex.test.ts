import type { Intention, Task } from '@pomi/shared';
import { describe, expect, it } from 'vitest';
import {
  buildMinimizedTaskSearchIndex,
  buildWorkspaceTaskSearchIndex,
  matchesWorkspaceTaskSearch,
  normalizeWorkspaceTaskSearch,
  searchMinimizedTaskIndex,
} from './taskSearchIndex';

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: null,
    sourceTranscript: null,
    priority: 'normal',
    timerType: 'work',
    intentionSlug: null,
    subIntentionSlug: null,
    vacationEligible: false,
    ...overrides,
  } as Task;
}

function intention(
  id: string,
  slug: string,
  title: string,
  overrides: Partial<Intention> = {}
): Intention {
  return {
    id,
    slug,
    title,
    emoji: '🎯',
    type: 'work',
    parentIntentionId: null,
    ...overrides,
  } as Intention;
}

describe('task search indexes', () => {
  it('preserves the distinct workspace and minimized matching rules', () => {
    const tasks = [task('one', { title: 'Préparer, résumé!' })];
    const workspace = buildWorkspaceTaskSearchIndex(tasks, [], 'fr');
    const minimized = buildMinimizedTaskSearchIndex(tasks, [], 'fr');

    expect(
      matchesWorkspaceTaskSearch(
        workspace,
        'one',
        normalizeWorkspaceTaskSearch('preparer', 'fr')
      )
    ).toBe(false);
    expect(
      searchMinimizedTaskIndex(minimized, 'preparer resume', 'fr')
    ).toEqual(tasks);
  });

  it('keeps timer-type and parent-child slug collisions isolated', () => {
    const tasks = [
      task('work', { intentionSlug: 'focus', subIntentionSlug: 'deep' }),
      task('break', { timerType: 'break', intentionSlug: 'focus' }),
    ];
    const intentions = [
      intention('work-parent', 'focus', 'Work focus'),
      intention('work-child', 'deep', 'Deep work', {
        parentIntentionId: 'work-parent',
      }),
      intention('break-parent', 'focus', 'Break focus', { type: 'break' }),
    ];
    const index = buildMinimizedTaskSearchIndex(tasks, intentions, 'en');

    expect(searchMinimizedTaskIndex(index, 'deep work', 'en')).toEqual([
      tasks[0],
    ]);
    expect(searchMinimizedTaskIndex(index, 'break focus', 'en')).toEqual([
      tasks[1],
    ]);
  });

  it('rebuilds renamed links and retains only live task documents', () => {
    const tasks = [task('one', { intentionSlug: 'focus' }), task('two')];
    const before = buildWorkspaceTaskSearchIndex(
      tasks,
      [intention('parent', 'focus', 'Old name')],
      'en'
    );
    const after = buildWorkspaceTaskSearchIndex(
      [tasks[0]],
      [intention('parent', 'focus', 'New name')],
      'en'
    );

    expect(before.documents.size).toBe(2);
    expect(after.documents.size).toBe(1);
    expect(after.candidateCount).toBe(9);
    expect(matchesWorkspaceTaskSearch(after, 'one', 'new name')).toBe(true);
    expect(matchesWorkspaceTaskSearch(after, 'one', 'old name')).toBe(false);
    expect(after.documents.has('two')).toBe(false);
  });
});
