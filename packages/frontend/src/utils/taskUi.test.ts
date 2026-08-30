import type { Task } from '@pomi/shared';
import { TIMER_TYPES } from '@pomi/shared/src/constants';
import { describe, expect, it, vi } from 'vitest';
import { focusTaskOnTimer } from './taskUi';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    userId: 'user-1',
    title: 'Plan release',
    description: null,
    sourceTranscript: null,
    creationSource: 'manual',
    importSource: null,
    importSourceTaskId: null,
    dueDate: null,
    dueTime: null,
    manualOrder: null,
    manualOrderOverride: false,
    priority: 'normal',
    status: 'active',
    timerType: TIMER_TYPES.WORK,
    customDuration: null,
    pinnedAt: null,
    intentionSlug: 'focus',
    subIntentionSlug: null,
    recurrenceRule: null,
    recurrenceInterval: null,
    recurrenceAnchorMode: 'planned',
    followUpTaskId: null,
    followUpDefinition: null,
    followUpDelayDays: null,
    followUpSourceTaskId: null,
    itemKind: 'task',
    vacationEligible: false,
    createdAt: '2026-08-30T10:00:00.000Z',
    updatedAt: '2026-08-30T10:00:00.000Z',
    ...overrides,
  };
}

describe('focused Task Timer setup', () => {
  it('forwards a Task custom duration when pinning starts or resumes its Timer', async () => {
    const createOrResumeTimer = vi.fn(async () => true);

    await expect(
      focusTaskOnTimer({
        task: task({ customDuration: 1_800_000 }),
        timer: null,
        preferences: null,
        createOrResumeTimer,
        updatePreferenceWithResult: vi.fn(async () => true),
      })
    ).resolves.toBe(true);

    expect(createOrResumeTimer).toHaveBeenCalledWith(
      TIMER_TYPES.WORK,
      'focus',
      ['focus'],
      {},
      'task-1',
      false,
      1_800_000
    );
  });

  it('forwards no override for a Task without a custom duration', async () => {
    const createOrResumeTimer = vi.fn(async () => true);

    await focusTaskOnTimer({
      task: task(),
      timer: null,
      preferences: null,
      createOrResumeTimer,
      updatePreferenceWithResult: vi.fn(async () => true),
    });

    expect(createOrResumeTimer).toHaveBeenCalledWith(
      TIMER_TYPES.WORK,
      'focus',
      ['focus'],
      {},
      'task-1',
      false,
      null
    );
  });
});
