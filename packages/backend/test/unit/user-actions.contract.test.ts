import { userActionIdSchema, userActionSchema } from '@pomi/shared';
import { describe, expect, it } from 'vitest';
import { redactUserAction } from '../../src/user-actions/user-action-redaction';

describe('user action contract', () => {
  it('validates IDs and explicit timer operations', () => {
    expect(userActionIdSchema.safeParse('client:action-1').success).toBe(true);
    expect(userActionIdSchema.safeParse('contains spaces').success).toBe(false);
    for (const action of [
      { kind: 'timer', operation: 'pause' },
      { kind: 'timer', operation: 'createOrResume', timerType: 'work' },
    ]) {
      expect(userActionSchema.safeParse(action).success).toBe(true);
    }
  });

  it('accepts intention selection and rejects malformed mutations', () => {
    expect(
      userActionSchema.safeParse({
        kind: 'timer',
        operation: 'setIntentions',
        intentions: ['focus'],
      }).success
    ).toBe(true);
    expect(
      userActionSchema.safeParse({
        kind: 'timer',
        operation: 'selectIntention',
      }).success
    ).toBe(false);
    expect(
      userActionSchema.safeParse({ kind: 'tasks', operation: 'complete' })
        .success
    ).toBe(false);
    expect(
      userActionSchema.safeParse({
        kind: 'request',
        method: 'GET',
        path: '/tasks',
      }).success
    ).toBe(false);
  });

  it('preserves manual-order reset and Assistant debug flag fields', () => {
    expect(
      userActionSchema.parse({
        kind: 'tasks',
        operation: 'update',
        taskId: 'task-1',
        manualOrder: null,
        manualOrderOverride: false,
      })
    ).toMatchObject({ manualOrder: null, manualOrderOverride: false });
    expect(
      userActionSchema.safeParse({
        kind: 'assistant',
        operation: 'updateDebugLogFlag',
        payload: { id: 'log-1', flagged: true },
      }).success
    ).toBe(true);
    expect(
      userActionSchema.safeParse({
        kind: 'lists',
        operation: 'convertListItemToTask',
        itemId: 'item-1',
        intentionSlug: 'focus',
        subIntentionSlug: null,
      }).success
    ).toBe(true);
  });

  it('accepts Task-link and Vacation Coverage controls', () => {
    expect(
      userActionSchema.parse({
        kind: 'intentions',
        operation: 'update',
        slug: 'focus',
        title: 'Focus',
        emoji: '🎯',
        allowsTasks: false,
      })
    ).toMatchObject({ allowsTasks: false });
    expect(
      userActionSchema.parse({
        kind: 'tasks',
        operation: 'update',
        taskId: 'task-1',
        vacationEligible: true,
      })
    ).toMatchObject({ vacationEligible: true });
    expect(
      userActionSchema.safeParse({
        kind: 'lists',
        operation: 'convertTaskToListItem',
        taskId: 'task-1',
        listId: 'list-1',
      }).success
    ).toBe(true);
  });

  it('keeps only operation metadata in lifecycle records', () => {
    expect(
      redactUserAction({
        kind: 'tasks',
        operation: 'import',
        importSource: 'CSV',
        rows: [{ title: 'one' }, { title: 'two' }],
      })
    ).toEqual({ kind: 'tasks', operation: 'import' });
    expect(
      redactUserAction({
        kind: 'tasks',
        operation: 'create',
        title: 'Private title',
        description: 'Private description',
      })
    ).toEqual({ kind: 'tasks', operation: 'create' });
  });
});
