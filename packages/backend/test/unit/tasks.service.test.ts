import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

import {
  TASK_CREATION_SOURCES,
  TASK_FOLLOW_UP_DELAY_MAX_DAYS,
  TASK_STATUSES,
} from '@pomi/shared';
import { TasksService } from '../../src/tasks/tasks.service';

function createQueryBuilder(
  result,
  rawRows?: unknown[],
  manyRows: unknown[] = []
) {
  rawRows = rawRows ?? [];
  return {
    conditions: [],
    params: [],
    distinctColumns: [],
    select() {
      return this;
    },
    distinctOn(columns) {
      this.distinctColumns = columns;
      return this;
    },
    addSelect() {
      return this;
    },
    setParameter(key, value) {
      this.params.push({ [key]: value });
      return this;
    },
    setParameters(values) {
      this.params.push(values);
      return this;
    },
    groupBy() {
      return this;
    },
    addGroupBy() {
      return this;
    },
    orderBy() {
      return this;
    },
    addOrderBy() {
      return this;
    },
    limit() {
      return this;
    },
    where(condition, params) {
      this.conditions.push(condition);
      this.params.push(params);
      return this;
    },
    andWhere(condition, params) {
      this.conditions.push(condition);
      this.params.push(params);
      return this;
    },
    getCount() {
      return Promise.resolve(result ?? 0);
    },
    getRawOne() {
      return Promise.resolve(result);
    },
    getRawMany() {
      return Promise.resolve(rawRows);
    },
    getMany() {
      return Promise.resolve(manyRows);
    },
  };
}

function createService(
  task,
  taskRankingRows = [],
  completedEventCount = 0,
  latestEvent = null,
  taskEventLogs = [],
  latestEventRows = []
) {
  const savedEvents = [];
  const savedTasks = [];
  const deletedEvents = [];
  const deletedTasks = [];
  const intentions = [];
  const removedFocusedTasks = [];
  const taskBuilders = [];
  const taskEventBuilders = [];
  const emittedTaskUsers = [];
  const importRuns = [];
  const rankingLabelLookups = [];
  let preferenceReads = 0;

  const service = new TasksService(
    {
      create(entity) {
        return entity;
      },
      findOne() {
        return Promise.resolve(task);
      },
      find() {
        return Promise.resolve([]);
      },
      createQueryBuilder() {
        const builder = createQueryBuilder(0);
        taskBuilders.push(builder);
        return builder;
      },
      save(entity) {
        savedTasks.push({ ...entity });
        return Promise.resolve(entity);
      },
      delete(criteria) {
        deletedTasks.push(criteria);
        return Promise.resolve();
      },
    },
    {
      create(entity) {
        return entity;
      },
      save(entity) {
        savedEvents.push(entity);
        return Promise.resolve(entity);
      },
      find() {
        return Promise.resolve(taskEventLogs);
      },
      countBy() {
        return Promise.resolve(0);
      },
      createQueryBuilder() {
        const builder = createQueryBuilder(
          completedEventCount,
          taskRankingRows,
          latestEventRows
        );
        taskEventBuilders.push(builder);
        return builder;
      },
      findOne() {
        return Promise.resolve(latestEvent);
      },
      delete(criteria) {
        deletedEvents.push(criteria);
        return Promise.resolve();
      },
    },
    {
      create(entity) {
        return entity;
      },
      save(entity) {
        importRuns.push(entity);
        return Promise.resolve(entity);
      },
      count() {
        return Promise.resolve(importRuns.length);
      },
    },
    {
      getAllIntentions(_userId, type) {
        return Promise.resolve(
          type
            ? intentions.filter(intention => intention.type === type)
            : intentions
        );
      },
      createIntention(
        userId,
        title,
        emoji,
        type,
        hasCustomDuration,
        customDuration,
        keepScreenAwake,
        isHabit
      ) {
        const slug = title
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .replace(/\s+/g, '-');
        const intention = {
          id: `intention-${intentions.length + 1}`,
          userId,
          title,
          emoji,
          slug,
          type,
          isArchived: false,
          hasCustomDuration,
          customDuration: customDuration ?? null,
          keepScreenAwake: keepScreenAwake === true,
          isHabit: isHabit === true,
        };
        intentions.push(intention);
        return Promise.resolve(intention);
      },
      getIntentionsBySlug(_userId, slugs, type) {
        return Promise.resolve(
          Object.fromEntries(
            intentions
              .filter(
                intention =>
                  slugs.includes(intention.slug) &&
                  (type === undefined || intention.type === type)
              )
              .map(intention => [intention.slug, intention])
          )
        );
      },
      getIntentionLabelsByTypeAndSlug(userId, lookups) {
        rankingLabelLookups.push({ userId, lookups });
        return Promise.resolve(
          Object.fromEntries(
            intentions
              .filter(intention =>
                lookups.some(
                  lookup =>
                    intention.type === lookup.type &&
                    lookup.slugs.includes(intention.slug)
                )
              )
              .map(intention => [
                `${intention.type}:${intention.slug}`,
                `${intention.emoji} ${intention.title}`,
              ])
          )
        );
      },
      getSubIntentionCountsByParentIds(_userId, parentIds) {
        return Promise.resolve(
          Object.fromEntries(
            parentIds
              .map(parentId => [
                parentId,
                intentions.filter(
                  intention =>
                    intention.parentIntentionId === parentId &&
                    intention.isArchived !== true
                ).length,
              ])
              .filter(([, count]) => count > 0)
          )
        );
      },
      async validateTaskIntentionSelection(
        userId,
        selectedIntentions,
        subIntentions,
        allowedTypes
      ) {
        const lookupSlugs = [
          ...new Set([...selectedIntentions, ...Object.values(subIntentions)]),
        ];
        const intentionData = Object.assign(
          {},
          ...(await Promise.all(
            allowedTypes.map(type =>
              this.getIntentionsBySlug(userId, lookupSlugs, type)
            )
          ))
        );

        if (Object.keys(intentionData).length !== lookupSlugs.length) {
          throw new Error('Intention selection is invalid');
        }

        const counts = await this.getSubIntentionCountsByParentIds(
          userId,
          selectedIntentions.map(slug => intentionData[slug].id)
        );
        for (const parentSlug of selectedIntentions) {
          const parent = intentionData[parentSlug];
          if (parent.allowsTasks === false) {
            throw new Error('This Intention does not allow linked Tasks');
          }
          const childSlug = subIntentions[parentSlug];
          if (!childSlug && (counts[parent.id] ?? 0) > 0) {
            throw new Error('Sub-intention is required for this intention');
          }
          if (
            childSlug &&
            intentionData[childSlug]?.parentIntentionId !== parent.id
          ) {
            throw new Error('Sub-intention selection is invalid');
          }
        }

        return intentionData;
      },
    },
    {
      getPreferences() {
        preferenceReads += 1;
        return Promise.resolve({
          taskReminderPriorities: ['high', 'urgent'],
          taskBeforeDueReminderMinutes: 0,
          taskUrgentReminderRepeatEnabled: true,
          taskUrgentReminderRepeatIntervalMinutes: 30,
          timeZone: 'UTC',
        });
      },
    },
    {
      removeFocusedTask(userId, taskId) {
        removedFocusedTasks.push({ userId, taskId });
        return Promise.resolve();
      },
    },
    {
      emitTasksUpdate(userId) {
        emittedTaskUsers.push(userId);
      },
    }
  );
  const taskRepository = service['tasksRepository'];
  const eventRepository = service['taskEventsRepository'];
  taskRepository.update = () => Promise.resolve();
  taskRepository.manager = {
    async transaction(callback) {
      const taskCount = savedTasks.length;
      const eventCount = savedEvents.length;
      try {
        return await callback({
          getRepository(entity) {
            return entity.name === 'TaskEntity'
              ? taskRepository
              : eventRepository;
          },
        });
      } catch (error) {
        savedTasks.splice(taskCount);
        savedEvents.splice(eventCount);
        throw error;
      }
    },
  };

  return {
    service,
    intentions,
    savedEvents,
    savedTasks,
    deletedEvents,
    deletedTasks,
    removedFocusedTasks,
    taskBuilders,
    taskEventBuilders,
    emittedTaskUsers,
    importRuns,
    rankingLabelLookups,
    getPreferenceReads: () => preferenceReads,
  };
}

function dateOffset(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function attachTaskRepository(service, tasks) {
  const savedBatches = [];
  const repository = {
    findOne({ where }) {
      return Promise.resolve(
        tasks.find(
          task =>
            task.id === where.id &&
            task.userId === where.userId &&
            task.status === where.status &&
            task.pinnedAt === null
        ) ?? null
      );
    },
    find({ where }) {
      return Promise.resolve(
        tasks.filter(
          task =>
            task.userId === where.userId &&
            task.status === where.status &&
            task.pinnedAt === null &&
            task.timerType === where.timerType &&
            task.intentionSlug === where.intentionSlug
        )
      );
    },
    save(entities) {
      savedBatches.push(entities.map(entity => ({ ...entity })));
      return Promise.resolve(entities);
    },
  };
  repository.manager = {
    transaction(callback) {
      return callback({ getRepository: () => repository });
    },
  };
  service.tasksRepository = repository;
  return savedBatches;
}

test('direct Task creation preserves an absent due date and defaults to Work', async () => {
  const { service, savedTasks, savedEvents } = createService(null);

  await service.createTask({
    userId: 'user-1',
    title: 'No date supplied',
    creationSource: TASK_CREATION_SOURCES.MANUAL,
  });

  assert.equal(savedTasks.at(-1).dueDate, null);
  assert.equal(savedTasks.at(-1).timerType, 'work');
  assert.equal(savedEvents.length, 1);
  assert.equal(savedEvents[0].eventType, 'created');
  assert.equal(savedEvents[0].recurrenceRuleSnapshot, null);
  assert.equal(savedEvents[0].recurrenceIntervalSnapshot, null);
  assert.equal(savedEvents[0].recurrenceAnchorModeSnapshot, 'planned');
});

test('prepared Assistant Tasks reuse validation context during persistence', async () => {
  const { service, getPreferenceReads, savedEvents, savedTasks } =
    createService(null);
  const prepared = await service.validateTaskCreation({
    userId: 'user-1',
    title: 'Prepared once',
    creationSource: TASK_CREATION_SOURCES.ASSISTANT,
  });

  await service.createPreparedTasks([prepared]);

  assert.equal(getPreferenceReads(), 1);
  assert.equal(savedTasks.length, 1);
  assert.equal(savedEvents.length, 1);
});

test('prepared Assistant Tasks roll back the whole batch before propagating failure', async () => {
  const { service, emittedTaskUsers, savedTasks, savedEvents } =
    createService(null);
  const first = await service.validateTaskCreation({
    userId: 'user-1',
    title: 'First task',
    creationSource: TASK_CREATION_SOURCES.ASSISTANT,
  });
  const second = await service.validateTaskCreation({
    userId: 'user-1',
    title: 'Second task',
    creationSource: TASK_CREATION_SOURCES.ASSISTANT,
  });
  const repository = service['tasksRepository'];
  let saveCalls = 0;
  repository.save = async entity => {
    saveCalls += 1;
    if (saveCalls === 2) throw new Error('database unavailable');
    return entity;
  };

  await assert.rejects(
    service.createPreparedTasks([first, second]),
    /database unavailable/
  );

  assert.deepEqual(savedTasks, []);
  assert.deepEqual(savedEvents, []);
  assert.deepEqual(emittedTaskUsers, []);
});

test('reverting the latest lifecycle event restores all recurrence snapshots', async () => {
  const task = {
    id: 'task-revert',
    userId: 'user-1',
    title: 'Changed recurrence',
    status: TASK_STATUSES.COMPLETED,
    priority: 'normal',
    timerType: 'work',
    intentionSlug: null,
    subIntentionSlug: null,
    dueDate: null,
    dueTime: null,
    recurrenceSequenceIndex: 2,
    recurrenceRule: 'FREQ=DAILY',
    recurrenceInterval: null,
    recurrenceAnchorMode: 'planned',
    manualOrder: null,
    manualOrderOverride: false,
  };
  const event = {
    id: 'event-revert',
    taskId: task.id,
    userId: task.userId,
    eventType: TASK_STATUSES.COMPLETED,
    titleSnapshot: 'Original recurrence',
    prioritySnapshot: 'high',
    timerTypeSnapshot: 'break',
    intentionSlugSnapshot: null,
    subIntentionSlugSnapshot: null,
    dueDate: null,
    dueTime: null,
    recurrenceSequenceIndex: 1,
    recurrenceRuleSnapshot: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
    recurrenceIntervalSnapshot: 2.5,
    recurrenceAnchorModeSnapshot: 'completion',
    occurredAt: new Date(),
  };
  const { service, savedTasks } = createService(task, [], 0, event);

  await service.revertLatestTaskEvent(task.userId, event.id);

  assert.equal(
    savedTasks.at(-1).recurrenceRule,
    'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU'
  );
  assert.equal(savedTasks.at(-1).recurrenceInterval, 2.5);
  assert.equal(savedTasks.at(-1).recurrenceAnchorMode, 'completion');
});

test('reverting a source completion removes its generated follow-up transactionally', async () => {
  const source = {
    id: 'source-revert',
    userId: 'user-1',
    title: 'Source Task',
    status: TASK_STATUSES.COMPLETED,
    priority: 'normal',
    timerType: 'work',
    intentionSlug: null,
    subIntentionSlug: null,
    dueDate: '2026-08-01',
    dueTime: null,
    recurrenceSequenceIndex: 0,
    recurrenceRule: null,
    recurrenceInterval: null,
    recurrenceAnchorMode: 'planned',
    manualOrder: null,
    manualOrderOverride: false,
  };
  const generatedFollowUp = {
    id: 'generated-revert',
    userId: 'user-1',
    status: TASK_STATUSES.ACTIVE,
    itemKind: 'task',
    followUpSourceTaskId: source.id,
  };
  const event = {
    id: 'source-completion',
    taskId: source.id,
    userId: source.userId,
    eventType: TASK_STATUSES.COMPLETED,
    titleSnapshot: source.title,
    prioritySnapshot: source.priority,
    timerTypeSnapshot: source.timerType,
    intentionSlugSnapshot: null,
    subIntentionSlugSnapshot: null,
    dueDate: source.dueDate,
    dueTime: source.dueTime,
    recurrenceSequenceIndex: 0,
    recurrenceRuleSnapshot: null,
    recurrenceIntervalSnapshot: null,
    recurrenceAnchorModeSnapshot: 'planned',
    occurredAt: new Date(),
  };
  const { service, deletedEvents, deletedTasks, savedTasks } = createService(
    source,
    [],
    0,
    event
  );
  service['tasksRepository'].findOne = ({ where }) =>
    Promise.resolve(
      where.followUpSourceTaskId === source.id ? generatedFollowUp : source
    );

  await service.revertLatestTaskEvent(source.userId, event.id);

  assert.equal(savedTasks.at(-1).status, TASK_STATUSES.ACTIVE);
  assert.deepEqual(deletedTasks, [generatedFollowUp.id]);
  assert.deepEqual(deletedEvents, [
    { userId: source.userId, taskId: generatedFollowUp.id },
    event.id,
  ]);
});

test('task event logs bound latest-event lookup to the visible task IDs', async () => {
  const visibleEvent = {
    id: 'event-old',
    taskId: 'task-history',
    userId: 'user-1',
    eventType: TASK_STATUSES.COMPLETED,
    titleSnapshot: 'Completed Task',
    prioritySnapshot: 'normal',
    timerTypeSnapshot: 'work',
    intentionSlugSnapshot: null,
    subIntentionSlugSnapshot: null,
    dueDate: null,
    dueTime: null,
    isOverdue: false,
    occurredAt: new Date('2026-07-01T10:00:00Z'),
  };
  const latestEvent = {
    ...visibleEvent,
    id: 'event-latest',
    occurredAt: new Date('2026-07-02T10:00:00Z'),
  };
  const { service, taskEventBuilders } = createService(
    null,
    [],
    0,
    null,
    [visibleEvent],
    [latestEvent]
  );

  const logs = await service.getTaskEventLogs('user-1', 20, 0);

  assert.equal(logs[0].canRevert, false);
  assert.deepEqual(taskEventBuilders[0].distinctColumns, ['event.taskId']);
  assert.ok(
    taskEventBuilders[0].conditions.includes('event.taskId IN (:...taskIds)')
  );
});

test('manual ordering updates one complete Intention family', async () => {
  const baseTask = {
    userId: 'user-1',
    status: TASK_STATUSES.ACTIVE,
    pinnedAt: null,
    timerType: 'work',
    intentionSlug: 'project',
    manualOrder: null,
    manualOrderOverride: false,
    createdAt: new Date('2026-07-01T10:00:00Z'),
  };
  const familyTasks = [
    { ...baseTask, id: 'task-writing', subIntentionSlug: 'writing' },
    { ...baseTask, id: 'task-review', subIntentionSlug: 'reviewing' },
  ];
  const unrelatedTask = {
    ...baseTask,
    id: 'task-other',
    intentionSlug: 'health',
  };
  const { service } = createService(familyTasks[0]);
  const savedBatches = attachTaskRepository(service, [
    ...familyTasks,
    unrelatedTask,
  ]);

  const result = await service.reorderTasks('user-1', [
    { id: 'task-review', manualOrder: 0, manualOrderOverride: true },
    { id: 'task-writing', manualOrder: 1, manualOrderOverride: true },
  ]);

  assert.deepEqual(
    result.map(task => task.id),
    ['task-review', 'task-writing']
  );
  assert.deepEqual(
    savedBatches
      .at(-1)
      .map(task => task.id)
      .sort(),
    ['task-review', 'task-writing']
  );
  assert.equal(unrelatedTask.manualOrder, null);
});

test('manual ordering rejects an incomplete Intention family', async () => {
  const tasks = ['task-one', 'task-two'].map(id => ({
    id,
    userId: 'user-1',
    status: TASK_STATUSES.ACTIVE,
    pinnedAt: null,
    timerType: 'work',
    intentionSlug: 'project',
    subIntentionSlug: null,
    manualOrder: null,
    manualOrderOverride: false,
    createdAt: new Date(),
  }));
  const { service } = createService(tasks[0]);
  attachTaskRepository(service, tasks);

  await assert.rejects(
    () =>
      service.reorderTasks('user-1', [
        { id: 'task-one', manualOrder: 0, manualOrderOverride: true },
      ]),
    /every active unpinned Task in the Intention family/
  );
});

test('assignment identity changes clear manual ordering anchors', async () => {
  const task = {
    id: 'task-anchor',
    userId: 'user-1',
    title: 'Anchored Task',
    status: TASK_STATUSES.ACTIVE,
    priority: 'normal',
    timerType: 'work',
    intentionSlug: 'project',
    subIntentionSlug: 'writing',
    dueDate: null,
    dueTime: null,
    recurrenceRule: null,
    recurrenceInterval: null,
    recurrenceAnchorMode: 'planned',
    manualOrder: 1,
    manualOrderOverride: true,
    pinnedAt: null,
  };
  const { service, intentions, savedTasks } = createService(task);
  const parent = {
    id: 'parent-project',
    userId: 'user-1',
    title: 'Project',
    emoji: '📁',
    slug: 'project',
    type: 'work',
    isArchived: false,
    parentIntentionId: null,
  };
  intentions.push(
    parent,
    {
      id: 'sub-writing',
      userId: 'user-1',
      title: 'Writing',
      emoji: '✍️',
      slug: 'writing',
      type: 'work',
      isArchived: false,
      parentIntentionId: parent.id,
    },
    {
      id: 'sub-review',
      userId: 'user-1',
      title: 'Review',
      emoji: '🔎',
      slug: 'reviewing',
      type: 'work',
      isArchived: false,
      parentIntentionId: parent.id,
    }
  );

  await service.updateTask('user-1', task.id, {
    intentionSlug: 'project',
    subIntentionSlug: 'writing',
  });
  assert.equal(savedTasks.at(-1).manualOrderOverride, true);
  assert.equal(savedTasks.at(-1).manualOrder, 1);

  await service.updateTask('user-1', task.id, {
    intentionSlug: 'project',
    subIntentionSlug: 'reviewing',
  });
  assert.equal(savedTasks.at(-1).manualOrderOverride, false);
  assert.equal(savedTasks.at(-1).manualOrder, null);
});

test('an unlinked Task can be pinned and completion clears its pin', async () => {
  const task = {
    id: 'task-pin',
    userId: 'user-1',
    title: 'Pinned without Intention',
    status: TASK_STATUSES.ACTIVE,
    dueDate: null,
    dueTime: null,
    timerType: 'break',
    pinnedAt: null,
    recurrenceRule: null,
    recurrenceAnchorMode: 'planned',
  };
  const { service, savedTasks } = createService(task);

  await service.updateTask('user-1', task.id, { pinned: true });
  assert.ok(savedTasks.at(-1).pinnedAt instanceof Date);

  await service.updateTask('user-1', task.id, {
    status: TASK_STATUSES.COMPLETED,
  });
  assert.equal(savedTasks.at(-1).pinnedAt, null);
});

test('a contextual follow-up cannot be pinned, reordered, or recurring', async () => {
  const task = {
    id: 'contextual-follow-up',
    userId: 'user-1',
    title: 'Send the summary',
    status: TASK_STATUSES.ACTIVE,
    itemKind: 'followUp',
    followUpSourceTaskId: 'parent-task',
  };
  const { service } = createService(task);

  for (const updates of [
    { pinned: true },
    { manualOrder: 0 },
    { manualOrderOverride: true },
    { recurrenceRule: 'FREQ=DAILY' },
    { recurrenceInterval: 2 },
  ]) {
    await assert.rejects(
      () => service.updateTask('user-1', task.id, updates),
      /cannot be pinned, reordered, or recurring/
    );
  }
});

test('Task links cannot cross timer types', async () => {
  const { service, intentions } = createService(null);
  intentions.push({
    id: 'break-1',
    userId: 'user-1',
    title: 'Coffee',
    emoji: '☕',
    slug: 'coffee',
    type: 'break',
    isArchived: false,
    parentIntentionId: null,
  });

  await assert.rejects(
    () =>
      service.createTask({
        userId: 'user-1',
        title: 'Mismatched link',
        timerType: 'work',
        intentionSlug: 'coffee',
        creationSource: TASK_CREATION_SOURCES.MANUAL,
      }),
    /Intention selection is invalid/
  );
});

test('completion replaces an active follow-up and preserves source recurrence', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));

  const source = {
    id: 'source-task',
    userId: 'user-1',
    title: 'Review the recurring work',
    status: TASK_STATUSES.ACTIVE,
    dueDate: '2026-08-01',
    dueTime: null,
    priority: 'normal',
    timerType: 'work',
    pinnedAt: null,
    manualOrder: null,
    manualOrderOverride: false,
    intentionSlug: null,
    subIntentionSlug: null,
    recurrenceRule: 'FREQ=DAILY',
    recurrenceInterval: null,
    recurrenceSequenceIndex: 0,
    recurrenceAnchorMode: 'planned',
    followUpTaskId: null,
    followUpDefinition: {
      title: 'Send the follow-up',
      description: null,
      dueTime: '09:00',
      priority: 'high',
      timerType: 'work',
      intentionSlug: null,
      subIntentionSlug: null,
      vacationEligible: false,
    },
    followUpDelayDays: 2,
    followUpSourceTaskId: null,
    itemKind: 'task',
  };
  const previousGenerated = {
    id: 'follow-up-template',
    userId: 'user-1',
    title: 'Send the follow-up',
    status: TASK_STATUSES.ACTIVE,
    dueDate: null,
    dueTime: '09:00',
    priority: 'high',
    timerType: 'work',
    pinnedAt: null,
    intentionSlug: null,
    subIntentionSlug: null,
    recurrenceRule: null,
    recurrenceInterval: null,
    recurrenceSequenceIndex: 0,
    recurrenceAnchorMode: 'planned',
    followUpTaskId: null,
    followUpDelayDays: null,
    followUpSourceTaskId: source.id,
    itemKind: 'followUp',
    vacationEligible: false,
  };
  const { service, savedTasks, savedEvents } = createService(source);
  const taskRepository = service['tasksRepository'];
  taskRepository.findOne = ({ where }) =>
    Promise.resolve(where.id === source.id ? source : null);
  taskRepository.find = ({ where }) =>
    Promise.resolve(
      where.followUpSourceTaskId === source.id ? [previousGenerated] : []
    );
  taskRepository.create = entity => ({
    ...entity,
    id: entity.id ?? 'generated-follow-up-new',
  });
  taskRepository.save = async entity => {
    const entities = Array.isArray(entity) ? entity : [entity];
    savedTasks.push(...entities.map(item => ({ ...item })));
    return entity;
  };

  try {
    await service.updateTask('user-1', source.id, {
      status: TASK_STATUSES.COMPLETED,
    });
  } finally {
    vi.useRealTimers();
  }

  assert.equal(source.status, TASK_STATUSES.ACTIVE);
  assert.equal(source.recurrenceRule, 'FREQ=DAILY');
  assert.equal(previousGenerated.status, TASK_STATUSES.ARCHIVED);
  assert.equal(savedTasks.at(-1).followUpSourceTaskId, source.id);
  assert.equal(savedTasks.at(-1).dueDate, '2026-08-04');
  assert.equal(savedTasks.at(-1).recurrenceRule, null);
  assert.equal(
    savedEvents.filter(event => event.taskId === source.id).length,
    1
  );
  assert.equal(
    savedEvents.filter(event => event.taskId === previousGenerated.id).at(-1)
      ?.eventType,
    TASK_STATUSES.ARCHIVED
  );
  assert.equal(
    savedEvents.filter(event => event.taskId === savedTasks.at(-1).id).at(-1)
      ?.eventType,
    'created'
  );
});

test('active follow-ups retain context when their parent becomes a List item', async () => {
  const parent = {
    id: 'parent-task',
    userId: 'user-1',
    title: 'Review the launch',
    status: TASK_STATUSES.ACTIVE,
    itemKind: 'listItem',
    followUpSourceTaskId: null,
  };
  const followUp = {
    id: 'follow-up-task',
    userId: 'user-1',
    title: 'Send the summary',
    status: TASK_STATUSES.ACTIVE,
    itemKind: 'followUp',
    followUpSourceTaskId: parent.id,
  };
  const { service } = createService(null);
  const taskRepository = service['tasksRepository'];
  taskRepository.find = vi
    .fn()
    .mockResolvedValueOnce([followUp])
    .mockResolvedValueOnce([parent]);

  const tasks = await service.getActiveTasks('user-1');

  assert.equal(tasks.length, 1);
  assert.deepEqual((followUp as { followUpParent?: unknown }).followUpParent, {
    id: parent.id,
    title: parent.title,
  });
});

test('recurring completion advances successive occurrences and ignores a replay', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));

  const task = {
    id: 'recurring-task',
    userId: 'user-1',
    title: 'Daily review',
    status: TASK_STATUSES.ACTIVE,
    dueDate: '2026-08-01',
    dueTime: null,
    priority: 'normal',
    timerType: 'work',
    pinnedAt: null,
    manualOrder: null,
    manualOrderOverride: false,
    intentionSlug: null,
    subIntentionSlug: null,
    recurrenceRule: 'FREQ=DAILY',
    recurrenceInterval: null,
    recurrenceSequenceIndex: 0,
    recurrenceAnchorMode: 'planned',
    followUpTaskId: null,
    followUpDelayDays: null,
    followUpSourceTaskId: null,
    itemKind: 'task',
  };
  const { service, savedTasks, savedEvents } = createService(task);

  try {
    await service.updateTask('user-1', task.id, {
      status: TASK_STATUSES.COMPLETED,
      expectedDueDate: '2026-08-01',
      expectedDueTime: null,
    });
    await service.updateTask('user-1', task.id, {
      status: TASK_STATUSES.COMPLETED,
      expectedDueDate: '2026-08-01',
      expectedDueTime: null,
    });
    await service.updateTask('user-1', task.id, {
      status: TASK_STATUSES.COMPLETED,
      expectedDueDate: '2026-08-02',
      expectedDueTime: null,
    });
  } finally {
    vi.useRealTimers();
  }

  assert.equal(task.status, TASK_STATUSES.ACTIVE);
  assert.equal(task.dueDate, '2026-08-03');
  assert.deepEqual(
    savedEvents.map(event => event.dueDate),
    ['2026-08-01', '2026-08-02']
  );
  assert.deepEqual(
    savedTasks.map(savedTask => savedTask.dueDate),
    ['2026-08-02', '2026-08-03']
  );
});

test('completed Task updates reject unrelated edits', async () => {
  const task = {
    id: 'task-complete-edit',
    userId: 'user-1',
    title: 'Keep this title',
    status: TASK_STATUSES.ACTIVE,
    dueDate: null,
    dueTime: null,
    recurrenceRule: null,
    recurrenceAnchorMode: 'planned',
  };
  const { service, savedEvents } = createService(task);

  await assert.rejects(
    service.updateTask('user-1', task.id, {
      status: TASK_STATUSES.COMPLETED,
      title: 'Changed title',
    }),
    /Task completion cannot include other updates/
  );
  assert.equal(task.status, TASK_STATUSES.ACTIVE);
  assert.equal(savedEvents.length, 0);
});

test('follow-up delay validation enforces the shared maximum', async () => {
  const { service } = createService(null);

  await assert.rejects(
    service.createTask({
      userId: 'user-1',
      title: 'Source Task',
      followUpTaskId: null,
      followUpDefinition: {
        title: 'Send the follow-up',
        description: null,
        dueTime: null,
        priority: 'normal',
        timerType: 'work',
        intentionSlug: null,
        subIntentionSlug: null,
        vacationEligible: false,
      },
      followUpDelayDays: TASK_FOLLOW_UP_DELAY_MAX_DAYS + 1,
      creationSource: TASK_CREATION_SOURCES.MANUAL,
    }),
    /whole number of days from 0 to/
  );
});

test('repeated completed update does not record duplicate lifecycle event', async () => {
  const task = {
    id: 'task-1',
    userId: 'user-1',
    title: 'Done',
    status: TASK_STATUSES.COMPLETED,
    dueDate: '2026-06-17',
    dueTime: null,
    recurrenceRule: null,
    recurrenceAnchorMode: 'planned',
  };
  const { service, savedEvents, removedFocusedTasks } = createService(task);

  await service.updateTask('user-1', task.id, {
    status: TASK_STATUSES.COMPLETED,
  });

  assert.equal(savedEvents.length, 0);
  assert.equal(removedFocusedTasks.length, 0);
});

test('planned overdue recurring occurrences count toward RRULE COUNT', async () => {
  const task = {
    id: 'task-1',
    userId: 'user-1',
    title: 'Daily',
    status: TASK_STATUSES.ACTIVE,
    dueDate: '2020-01-01',
    dueTime: null,
    recurrenceRule: 'FREQ=DAILY;COUNT=3',
    recurrenceAnchorMode: 'planned',
  };
  const { service, savedTasks } = createService(task);

  await service.updateTask('user-1', task.id, {
    status: TASK_STATUSES.COMPLETED,
  });

  assert.equal(savedTasks.at(-1).status, TASK_STATUSES.COMPLETED);
});

test('completion recurrence anchors are date-normalized before UNTIL check', async () => {
  const tomorrow = dateOffset(1);
  const task = {
    id: 'task-1',
    userId: 'user-1',
    title: 'Daily',
    status: TASK_STATUSES.ACTIVE,
    dueDate: dateOffset(-1),
    dueTime: null,
    recurrenceRule: `FREQ=DAILY;UNTIL=${tomorrow}`,
    recurrenceAnchorMode: 'completion',
  };
  const { service, savedTasks } = createService(task);

  await service.updateTask('user-1', task.id, {
    status: TASK_STATUSES.COMPLETED,
  });

  assert.equal(savedTasks.at(-1).status, TASK_STATUSES.ACTIVE);
  assert.equal(savedTasks.at(-1).dueDate, tomorrow);
});

test('fractional daily recurrence alternates two and three day gaps', async () => {
  const expectedDates = [
    '2099-01-03',
    '2099-01-06',
    '2099-01-08',
    '2099-01-11',
  ];
  const task = {
    id: 'task-fractional',
    userId: 'user-1',
    title: 'Every two and a half days',
    status: TASK_STATUSES.ACTIVE,
    dueDate: '2099-01-01',
    dueTime: null,
    priority: 'normal',
    recurrenceRule: 'FREQ=DAILY',
    recurrenceInterval: 2.5,
    recurrenceSequenceIndex: 0,
    recurrenceAnchorMode: 'planned',
  };
  const { service, savedTasks } = createService(task);

  for (const expectedDate of expectedDates) {
    await service.updateTask('user-1', task.id, {
      status: TASK_STATUSES.COMPLETED,
    });

    assert.equal(savedTasks.at(-1).dueDate, expectedDate);
  }
});

test('fractional recurrence keeps cadence after an excluded occurrence', async () => {
  const task = {
    id: 'task-fractional-exdate',
    userId: 'user-1',
    title: 'Every two and a half days with exclusion',
    status: TASK_STATUSES.ACTIVE,
    dueDate: '2099-01-01',
    dueTime: null,
    priority: 'normal',
    recurrenceRule: 'FREQ=DAILY;EXDATE=20990103',
    recurrenceInterval: 2.5,
    recurrenceSequenceIndex: 0,
    recurrenceAnchorMode: 'planned',
  };
  const { service, savedEvents, savedTasks } = createService(task);

  await service.updateTask('user-1', task.id, {
    status: TASK_STATUSES.COMPLETED,
  });
  assert.equal(savedTasks.at(-1).dueDate, '2099-01-06');
  assert.equal(savedEvents.at(-1).recurrenceSequenceIndex, 0);

  await service.updateTask('user-1', task.id, {
    status: TASK_STATUSES.COMPLETED,
  });
  assert.equal(savedTasks.at(-1).dueDate, '2099-01-08');
  assert.equal(savedEvents.at(-1).recurrenceSequenceIndex, 2);
});

test('clearing recurrence rule also clears a stale fractional interval', async () => {
  const task = {
    id: 'task-clear-fractional',
    userId: 'user-1',
    title: 'Clear fractional recurrence',
    status: TASK_STATUSES.ACTIVE,
    dueDate: '2099-01-01',
    dueTime: null,
    priority: 'normal',
    recurrenceRule: 'FREQ=DAILY',
    recurrenceInterval: 2.5,
    recurrenceSequenceIndex: 2,
    recurrenceAnchorMode: 'planned',
  };
  const { service, savedTasks } = createService(task);

  await service.updateTask('user-1', task.id, { recurrenceRule: null });

  assert.equal(savedTasks.at(-1).recurrenceRule, null);
  assert.equal(savedTasks.at(-1).recurrenceInterval, null);
  assert.equal(savedTasks.at(-1).recurrenceSequenceIndex, 0);
});

test('unsupported RRULE parts are rejected', async () => {
  const { service } = createService(null);

  await assert.rejects(
    () =>
      service.createTask({
        userId: 'user-1',
        title: 'Invalid recurrence',
        dueDate: '2026-06-17',
        recurrenceRule: 'FREQ=DAILY;WKST=MO',
        creationSource: TASK_CREATION_SOURCES.MANUAL,
      }),
    /Task recurrence rule is invalid/
  );
});

test('impossible due dates are rejected before save', async () => {
  const { service, savedTasks } = createService(null);

  await assert.rejects(
    () =>
      service.createTask({
        userId: 'user-1',
        title: 'Impossible date',
        dueDate: '2026-02-30',
        creationSource: TASK_CREATION_SOURCES.MANUAL,
      }),
    /Task due date is invalid/
  );
  assert.equal(savedTasks.length, 0);
});

test('task completion events snapshot task metadata', async () => {
  const task = {
    id: 'task-1',
    userId: 'user-1',
    title: 'Snapshot me',
    status: TASK_STATUSES.ACTIVE,
    dueDate: dateOffset(1),
    dueTime: '12:00',
    priority: 'high',
    intentionSlug: 'focus',
    recurrenceRule: 'FREQ=DAILY',
    recurrenceInterval: 2.5,
    recurrenceAnchorMode: 'planned',
  };
  const { service, savedEvents } = createService(task);

  await service.updateTask('user-1', task.id, {
    status: TASK_STATUSES.COMPLETED,
  });

  assert.equal(savedEvents.length, 1);
  assert.equal(savedEvents[0].titleSnapshot, 'Snapshot me');
  assert.equal(savedEvents[0].prioritySnapshot, 'high');
  assert.equal(savedEvents[0].intentionSlugSnapshot, 'focus');
  assert.equal(savedEvents[0].recurrenceRuleSnapshot, 'FREQ=DAILY');
  assert.equal(savedEvents[0].recurrenceIntervalSnapshot, 2.5);
  assert.equal(savedEvents[0].recurrenceAnchorModeSnapshot, 'planned');
  assert.equal(savedEvents[0].isOverdue, false);
});

test('task completion events become overdue immediately after the due boundary', async () => {
  const task = {
    id: 'task-1',
    userId: 'user-1',
    title: 'Grace',
    status: TASK_STATUSES.ACTIVE,
    dueDate: dateOffset(-1),
    dueTime: null,
    priority: 'normal',
    intentionSlug: null,
    recurrenceRule: null,
    recurrenceAnchorMode: 'planned',
  };
  const { service, savedEvents } = createService(task);

  await service.updateTask('user-1', task.id, {
    status: TASK_STATUSES.COMPLETED,
  });

  assert.equal(savedEvents.length, 1);
  assert.equal(savedEvents[0].isOverdue, true);
});

test('task import creates new intention groups once', async () => {
  const { service, intentions, savedTasks, importRuns } = createService(null);

  const result = await service.importTasks('user-1', 'VIKUNJA', [
    {
      sourceId: 'source-1',
      title: 'Call clinic',
      dueDate: '2026-06-17',
      newIntentionTitle: 'Health',
      newIntentionEmoji: '🏥',
      include: true,
    },
    {
      sourceId: 'source-2',
      title: 'Book checkup',
      dueDate: '2026-06-18',
      newIntentionTitle: 'Health',
      newIntentionEmoji: '🏥',
      include: true,
    },
  ]);

  assert.equal(result.imported.length, 2);
  assert.equal(result.skipped.length, 0);
  assert.equal(intentions.length, 1);
  assert.equal(intentions[0].title, 'Health');
  assert.equal(intentions[0].emoji, '🏥');
  assert.equal(savedTasks[0].intentionSlug, 'health');
  assert.equal(savedTasks[1].intentionSlug, 'health');
  assert.deepEqual(importRuns, [
    {
      userId: 'user-1',
      source: 'VIKUNJA',
      importedCount: 2,
      skippedCount: 0,
    },
  ]);
  assert.equal(await service.hasImportedTasks('user-1'), true);
});

test('task import does not record skipped-only attempts', async () => {
  const { service, importRuns } = createService(null);
  const result = await service.importTasks('user-1', 'VIKUNJA', []);
  assert.equal(result.imported.length, 0);
  assert.deepEqual(importRuns, []);
  assert.equal(await service.hasImportedTasks('user-1'), false);
});

test('task import creates work intention when only non-work title matches', async () => {
  const { service, intentions, savedTasks } = createService(null);
  intentions.push({
    id: 'break-intention-1',
    userId: 'user-1',
    title: 'Health',
    emoji: '☕',
    slug: 'health',
    type: 'break',
    isArchived: false,
  });

  const result = await service.importTasks('user-1', 'VIKUNJA', [
    {
      sourceId: 'source-1',
      title: 'Book checkup',
      dueDate: '2026-06-18',
      newIntentionTitle: 'Health',
      newIntentionEmoji: '🏥',
      include: true,
    },
  ]);

  assert.equal(result.imported.length, 1);
  assert.equal(intentions.length, 2);
  assert.equal(intentions[1].type, 'work');
  assert.equal(intentions[1].title, 'Health');
  assert.equal(savedTasks[0].intentionSlug, 'health');
});

test('linked Tasks require a child when their parent has active sub-intentions', async () => {
  const { service, intentions, savedTasks } = createService(null);
  const parent = {
    id: 'parent-1',
    userId: 'user-1',
    title: 'Project',
    emoji: '📁',
    slug: 'project',
    type: 'work',
    isArchived: false,
    parentIntentionId: null,
  };
  intentions.push(parent, {
    id: 'child-1',
    userId: 'user-1',
    title: 'Writing',
    emoji: '✍️',
    slug: 'writing',
    type: 'work',
    isArchived: false,
    parentIntentionId: parent.id,
    parentIntention: parent,
  });

  await assert.rejects(
    () =>
      service.createTask({
        userId: 'user-1',
        title: 'Draft outline',
        intentionSlug: 'project',
        creationSource: TASK_CREATION_SOURCES.MANUAL,
      }),
    /Sub-intention is required/
  );

  await service.createTask({
    userId: 'user-1',
    title: 'Draft outline',
    intentionSlug: 'project',
    subIntentionSlug: 'writing',
    creationSource: TASK_CREATION_SOURCES.MANUAL,
  });

  assert.equal(savedTasks.at(-1).intentionSlug, 'project');
  assert.equal(savedTasks.at(-1).subIntentionSlug, 'writing');
});

test('task ranking labels remain type-aware when slugs collide', async () => {
  const { service, intentions, rankingLabelLookups } = createService(null);
  intentions.push(
    {
      id: 'work-intention-1',
      userId: 'user-1',
      title: 'Work Focus',
      emoji: '🎯',
      slug: 'focus',
      type: 'work',
      isArchived: false,
    },
    {
      id: 'break-intention-1',
      userId: 'user-1',
      title: 'Break Focus',
      emoji: '☕',
      slug: 'focus',
      type: 'break',
      isArchived: false,
    }
  );

  const labels = await service.getTaskRankingLabels('user-1', [
    {
      slug: 'work:focus',
      timerType: 'work',
      intentionSlug: 'focus',
      count: '2',
    },
    {
      slug: 'break:focus',
      timerType: 'break',
      intentionSlug: 'focus',
      count: '1',
    },
  ]);

  assert.equal(labels['work:focus'], '🎯 Work Focus');
  assert.equal(labels['break:focus'], '☕ Break Focus');
  assert.deepEqual(rankingLabelLookups, [
    {
      userId: 'user-1',
      lookups: [
        { type: 'work', slugs: ['focus'] },
        { type: 'break', slugs: ['focus'] },
      ],
    },
  ]);
});

test('task statistics period counts use one bounded aggregate query', async () => {
  const rawCounts = {
    todayCount: '2',
    yesterdayCount: '1',
    weekCount: '3',
    previousWeekCount: '4',
    monthCount: '5',
    previousMonthCount: '6',
    yearCount: '7',
    previousYearCount: '8',
  };
  const { service, taskEventBuilders } = createService(null, [], rawCounts);
  const periods = {
    today: { start: new Date('2026-07-10T00:00:00.000Z') },
    yesterday: {
      start: new Date('2026-07-09T00:00:00.000Z'),
      end: new Date('2026-07-10T00:00:00.000Z'),
    },
    week: { start: new Date('2026-07-04T00:00:00.000Z') },
    previousWeek: {
      start: new Date('2026-06-27T00:00:00.000Z'),
      end: new Date('2026-07-04T00:00:00.000Z'),
    },
    month: { start: new Date('2026-06-11T00:00:00.000Z') },
    previousMonth: {
      start: new Date('2026-05-12T00:00:00.000Z'),
      end: new Date('2026-06-11T00:00:00.000Z'),
    },
    year: { start: new Date('2025-07-11T00:00:00.000Z') },
    previousYear: {
      start: new Date('2024-07-11T00:00:00.000Z'),
      end: new Date('2025-07-11T00:00:00.000Z'),
    },
  };
  const serviceWithPeriodCounts = service as unknown as {
    getTaskPeriodCounts: (
      userId: string,
      filter: 'completed',
      periods: typeof periods
    ) => Promise<Record<keyof typeof periods, number>>;
  };

  const counts = await serviceWithPeriodCounts.getTaskPeriodCounts(
    'user-1',
    'completed',
    periods
  );
  assert.deepEqual(counts, {
    today: 2,
    yesterday: 1,
    week: 3,
    previousWeek: 4,
    month: 5,
    previousMonth: 6,
    year: 7,
    previousYear: 8,
  });

  assert.equal(taskEventBuilders.length, 1);
  assert.ok(
    taskEventBuilders[0].conditions.includes(
      'event."occurredAt" >= :periodStart'
    )
  );
});

test('task overview includes active contextual follow-ups', async () => {
  const { service, taskBuilders } = createService(null);

  await service['getTaskOverview'](
    'user-1',
    new Date('2026-08-16T00:00:00.000Z'),
    'UTC'
  );

  assert.ok(
    taskBuilders[0].conditions.includes('task.itemKind IN (:...itemKinds)')
  );
  assert.deepEqual(taskBuilders[0].params.at(-2), {
    itemKinds: ['task', 'followUp'],
  });
});

test('task ranking distinguishes a none slug from an unlinked Task', async () => {
  const { service, intentions, taskEventBuilders } = createService(null, [
    {
      slug: 'work:none',
      timerType: 'work',
      intentionSlug: 'none',
      count: '2',
    },
    {
      slug: '[no-intention]',
      timerType: null,
      intentionSlug: null,
      count: '1',
    },
  ]);
  intentions.push({
    id: 'work-none',
    userId: 'user-1',
    title: 'Named none',
    emoji: '📝',
    slug: 'none',
    type: 'work',
    isArchived: false,
  });

  const ranking = await service.getTaskRanking(
    'user-1',
    'all',
    'week',
    '2026-07-10',
    'UTC'
  );

  assert.equal(
    ranking.find(entry => entry.slug === 'work:none').label,
    '📝 Named none'
  );
  assert.equal(
    ranking.find(entry => entry.slug === '[no-intention]').label,
    'No Intention'
  );
  assert.ok(
    taskEventBuilders
      .flatMap(builder => builder.params)
      .some(params => params.noIntention === '[no-intention]')
  );
});

test('task ranking labels archived intentions and preserves missing history', async () => {
  const { service, intentions, rankingLabelLookups } = createService(null, [
    {
      slug: 'work:archived-focus',
      timerType: 'work',
      intentionSlug: 'archived-focus',
      count: '2',
    },
    {
      slug: 'break:deleted-focus',
      timerType: 'break',
      intentionSlug: 'deleted-focus',
      count: '1',
    },
  ]);
  intentions.push({
    id: 'archived-work-intention',
    userId: 'user-1',
    title: 'Archived Focus',
    emoji: '📦',
    slug: 'archived-focus',
    type: 'work',
    isArchived: true,
  });

  const ranking = await service.getTaskRanking(
    'user-1',
    'all',
    'week',
    '2026-07-10',
    'UTC'
  );

  assert.equal(ranking[0].label, '📦 Archived Focus');
  assert.equal(ranking[1].label, 'break:deleted-focus');
  assert.deepEqual(rankingLabelLookups, [
    {
      userId: 'user-1',
      lookups: [
        { type: 'work', slugs: ['archived-focus'] },
        { type: 'break', slugs: ['deleted-focus'] },
      ],
    },
  ]);
});
