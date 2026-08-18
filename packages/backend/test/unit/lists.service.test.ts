import assert from 'node:assert/strict';
import { test } from 'vitest';
import { TASK_STATUSES } from '@pomi/shared';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ListsService } from '../../src/lists/lists.service';

test('reset completed List items preserves archived items', async () => {
  const updates: Array<{ criteria: unknown; updates: unknown }> = [];
  const emittedUsers: string[] = [];
  const service = new ListsService(
    {
      findOne: async () => ({ id: 'list-1', userId: 'user-1' }),
    } as never,
    {} as never,
    {} as never,
    {
      transaction: async callback =>
        callback({
          getRepository: () => ({
            update: async (criteria, next) => {
              updates.push({ criteria, updates: next });
              return { affected: 3 };
            },
          }),
        }),
    } as never,
    {} as never,
    { emitTasksUpdate: userId => emittedUsers.push(userId) } as never
  );

  const result = await service.resetCompletedItems('user-1', 'list-1');

  assert.deepEqual(result, { restoredCount: 3 });
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], {
    criteria: {
      userId: 'user-1',
      listId: 'list-1',
      itemKind: 'listItem',
      status: TASK_STATUSES.COMPLETED,
    },
    updates: { status: TASK_STATUSES.ACTIVE },
  });
  assert.deepEqual(emittedUsers, ['user-1']);
});

test('creating a List emits a realtime refresh', async () => {
  const emittedUsers: string[] = [];
  const listsRepository = {
    findOne: async () => null,
    create: value => value,
    save: async value => ({ id: 'list-1', ...value }),
  };
  const service = new ListsService(
    listsRepository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { emitTasksUpdate: userId => emittedUsers.push(userId) } as never
  );

  const list = await service.create('user-1', { title: 'Groceries' });

  assert.equal(list.title, 'Groceries');
  assert.deepEqual(emittedUsers, ['user-1']);
});

test('renaming a List to an existing title returns a conflict', async () => {
  const list = { id: 'list-1', userId: 'user-1', title: 'Packing' };
  const listsRepository = {
    findOne: async ({ where }) =>
      where.id === 'list-1'
        ? list
        : { id: 'list-2', userId: 'user-1', title: 'Groceries' },
  };
  const service = new ListsService(
    listsRepository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );

  await assert.rejects(
    service.update('user-1', 'list-1', { title: 'Groceries' }),
    ConflictException
  );
});

test('List item creation rejects a blank title defensively', async () => {
  const service = new ListsService(
    {
      findOne: async () => ({
        id: 'list-1',
        userId: 'user-1',
        isArchived: false,
      }),
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );

  await assert.rejects(
    service.createItem('user-1', 'list-1', { title: '   ' }),
    BadRequestException
  );
});

test('new List items inherit Vacation Coverage until explicitly overridden', async () => {
  const savedItems: Record<string, unknown>[] = [];
  const service = new ListsService(
    {
      findOne: async () => ({
        id: 'list-1',
        userId: 'user-1',
        isArchived: false,
        vacationDefault: true,
      }),
    } as never,
    {
      create: value => value,
      save: async value => {
        savedItems.push({ ...value });
        return value;
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    { emitTasksUpdate: () => undefined } as never
  );

  await service.createItem('user-1', 'list-1', { title: 'Inherited' });
  await service.createItem('user-1', 'list-1', {
    title: 'Override',
    vacationEligible: false,
  });

  assert.equal(savedItems[0].vacationEligible, true);
  assert.equal(savedItems[1].vacationEligible, false);
});

test('changing a List Vacation default preserves item-level overrides', async () => {
  const list = {
    id: 'list-1',
    userId: 'user-1',
    vacationDefault: false,
  };
  let itemUpdateCount = 0;
  const service = new ListsService(
    {
      findOne: async () => list,
      save: async value => value,
    } as never,
    { update: async () => itemUpdateCount++ } as never,
    {} as never,
    {} as never,
    {} as never,
    { emitTasksUpdate: () => undefined } as never
  );

  await service.update('user-1', 'list-1', { vacationDefault: true });

  assert.equal(list.vacationDefault, true);
  assert.equal(itemUpdateCount, 0);
});

test('Task-to-List conversion snapshots and clears every Task-only field', async () => {
  const task = {
    id: 'task-1',
    userId: 'user-1',
    title: 'Plan launch',
    description: 'Detailed plan',
    sourceTranscript: 'spoken source',
    creationSource: 'voice',
    importSource: null,
    importSourceTaskId: null,
    dueDate: '2026-08-01',
    dueTime: '12:30',
    manualOrder: 4,
    manualOrderOverride: true,
    priority: 'high',
    status: 'active',
    timerType: 'break',
    pinnedAt: new Date('2026-07-31T10:00:00Z'),
    intentionSlug: 'launch',
    subIntentionSlug: 'review',
    recurrenceRule: 'FREQ=WEEKLY',
    recurrenceInterval: 1,
    recurrenceSequenceIndex: 3,
    recurrenceAnchorMode: 'completion',
    followUpTaskId: 'follow-up-task',
    followUpDelayDays: 2,
    followUpSourceTaskId: null,
    lastReminderKey: 'old-key',
    itemKind: 'task',
    listId: null,
    taskRestoreState: null,
    vacationEligible: true,
  };
  const service = new ListsService(
    {
      findOne: async () => ({
        id: 'list-1',
        userId: 'user-1',
        isArchived: false,
        vacationDefault: false,
      }),
    } as never,
    { findOne: async () => task } as never,
    {} as never,
    {
      transaction: async callback =>
        callback({ getRepository: () => ({ save: async value => value }) }),
    } as never,
    { getCurrentTimer: async () => null } as never,
    { emitTasksUpdate: () => undefined } as never
  );

  await service.convertTaskToListItem('user-1', 'task-1', 'list-1', {});

  assert.equal(task.itemKind, 'listItem');
  assert.equal(task.listId, 'list-1');
  assert.equal(task.description, null);
  assert.equal(task.pinnedAt, null);
  assert.equal(task.recurrenceSequenceIndex, 0);
  assert.equal(task.followUpTaskId, null);
  assert.equal(task.followUpDelayDays, null);
  assert.equal(task.followUpSourceTaskId, null);
  assert.equal(task.manualOrder, null);
  assert.equal(task.vacationEligible, true);
  assert.deepEqual(task.taskRestoreState, {
    description: 'Detailed plan',
    sourceTranscript: 'spoken source',
    creationSource: 'voice',
    importSource: null,
    importSourceTaskId: null,
    dueTime: '12:30',
    timerType: 'break',
    pinnedAt: new Date('2026-07-31T10:00:00Z'),
    intentionSlug: 'launch',
    subIntentionSlug: 'review',
    recurrenceRule: 'FREQ=WEEKLY',
    recurrenceInterval: 1,
    recurrenceAnchorMode: 'completion',
    followUpTaskId: 'follow-up-task',
    followUpDelayDays: 2,
    followUpSourceTaskId: null,
    lastReminderKey: 'old-key',
    recurrenceSequenceIndex: 3,
    manualOrder: 4,
    manualOrderOverride: true,
  });
});

test('Task-to-List conversion rejects a currently focused Task', async () => {
  const service = new ListsService(
    {
      findOne: async () => ({
        id: 'list-1',
        userId: 'user-1',
        isArchived: false,
      }),
    } as never,
    {
      findOne: async () => ({ id: 'task-1', userId: 'user-1' }),
    } as never,
    {} as never,
    {} as never,
    { getCurrentTimer: async () => ({ focusedTaskIds: ['task-1'] }) } as never,
    {} as never
  );

  await assert.rejects(
    service.convertTaskToListItem('user-1', 'task-1', 'list-1', {}),
    BadRequestException
  );
});

test('Parent conversion aborts before its transaction for directly linked Tasks', async () => {
  let transactionCount = 0;
  const parent = {
    id: 'parent-1',
    userId: 'user-1',
    slug: 'focus',
    type: 'work',
    isArchived: false,
  };
  const service = new ListsService(
    {} as never,
    {
      find: async () => [
        {
          id: 'task-1',
          intentionSlug: 'focus',
          subIntentionSlug: null,
        },
      ],
    } as never,
    {
      findOne: async () => parent,
      find: async () => [{ id: 'child-1', slug: 'review', title: 'Review' }],
    } as never,
    {
      transaction: async () => {
        transactionCount++;
      },
    } as never,
    {} as never,
    {} as never
  );

  await assert.rejects(
    service.convertIntention('user-1', 'focus'),
    BadRequestException
  );
  assert.equal(transactionCount, 0);
});

test('converting a source List restores its current identity', async () => {
  const list = {
    id: 'list-1',
    userId: 'user-1',
    title: 'Updated groceries',
    emoji: '🥕',
    description: 'Things to buy',
    vacationDefault: true,
    isFavorite: true,
    isArchived: false,
    sourceIntentionId: 'intention-1',
  };
  const intention = {
    id: 'intention-1',
    userId: 'user-1',
    title: 'Old title',
    emoji: '📋',
    description: null,
    vacationDefault: false,
    isFavorite: false,
    isArchived: true,
    slug: 'old-title',
  };
  const intentionsRepository = {
    findOne: async () => intention,
    save: async value => value,
  };
  const listsRepository = {
    findOne: async () => list,
    save: async value => value,
  };
  const service = new ListsService(
    listsRepository as never,
    { find: async () => [] } as never,
    intentionsRepository as never,
    {} as never,
    { getCurrentTimer: async () => null } as never,
    { emitTasksUpdate: () => undefined } as never
  );

  await service.convertToIntention('user-1', 'list-1');

  assert.equal(intention.title, 'Updated groceries');
  assert.equal(intention.emoji, '🥕');
  assert.equal(intention.description, 'Things to buy');
  assert.equal(intention.vacationDefault, true);
  assert.equal(intention.isFavorite, true);
  assert.equal(intention.isArchived, false);
});

test('restoring a List from a converted Parent detaches the Sub-intention and its Tasks', async () => {
  const parent = {
    id: 'parent-1',
    userId: 'user-1',
    slug: 'projects',
    isArchived: true,
  };
  const intention = {
    id: 'child-1',
    userId: 'user-1',
    title: 'Review',
    emoji: '🔎',
    description: null,
    vacationDefault: false,
    isFavorite: false,
    isArchived: true,
    slug: 'review',
    parentIntentionId: parent.id,
    parentIntention: parent,
  };
  const task = {
    id: 'task-1',
    userId: 'user-1',
    title: 'Review proposal',
    status: 'active',
    itemKind: 'listItem',
    listId: 'list-1',
    taskRestoreState: {
      intentionSlug: parent.slug,
      subIntentionSlug: intention.slug,
    },
  };
  const list = {
    id: 'list-1',
    userId: 'user-1',
    title: intention.title,
    emoji: intention.emoji,
    description: intention.description,
    vacationDefault: intention.vacationDefault,
    isFavorite: intention.isFavorite,
    isArchived: false,
    sourceIntentionId: intention.id,
  };
  const savedTasks: (typeof task)[] = [];
  const intentionsRepository = {
    findOne: async ({ where }) =>
      where.id === intention.id ? intention : parent,
    save: async value => value,
  };
  const service = new ListsService(
    {
      findOne: async () => list,
      save: async value => value,
    } as never,
    {
      find: async () => [task],
      save: async value => {
        savedTasks.push(value);
        return value;
      },
    } as never,
    intentionsRepository as never,
    {} as never,
    { getCurrentTimer: async () => null } as never,
    { emitTasksUpdate: () => undefined } as never
  );

  await service.convertToIntention('user-1', 'list-1');

  assert.equal(intention.isArchived, false);
  assert.equal(intention.parentIntentionId, null);
  assert.equal(intention.parentIntention, null);
  assert.equal(savedTasks.length, 1);
  assert.equal(task.itemKind, 'task');
  assert.equal(task.listId, null);
  assert.equal(task.taskRestoreState, null);
  assert.equal(task.intentionSlug, intention.slug);
  assert.equal(task.subIntentionSlug, null);
});
