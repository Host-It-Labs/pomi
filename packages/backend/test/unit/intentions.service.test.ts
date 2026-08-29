import { TIMER_TYPES } from '@pomi/shared';
import { describe, expect, it } from 'vitest';
import { generateIntentionSlug } from '../../src/intentions/intention-slug';
import { IntentionsService } from '../../src/intentions/intentions.service';

type ServiceOptions = {
  intention?: Record<string, unknown>;
  intentions?: Record<string, unknown>[];
  intentionsById?: Record<string, Record<string, unknown> | null>;
  intentionsBySlug?: Record<string, Record<string, unknown> | null>;
};

function createService(options: ServiceOptions) {
  const savedIntentions: Record<string, unknown>[] = [];
  const deletedIntentions: unknown[] = [];
  const taskUpdates: unknown[] = [];
  const cascadeQueries: { statement: string; parameters: unknown[] }[] = [];
  const renamedRuntimeSlugs: unknown[] = [];
  const realtimeUpdates: string[] = [];
  const intentionFindOptions: unknown[] = [];
  const usageQueries: { method: string; args: unknown[] }[] = [];
  let transactionCalls = 0;
  let monthlyUsageCalls = 0;
  const usageQuery = {
    update: (entity: unknown) => {
      usageQueries.push({ method: 'update', args: [entity] });
      return usageQuery;
    },
    set: (updates: unknown) => {
      usageQueries.push({ method: 'set', args: [updates] });
      return usageQuery;
    },
    where: (...args: unknown[]) => {
      usageQueries.push({ method: 'where', args });
      return usageQuery;
    },
    andWhere: (...args: unknown[]) => {
      usageQueries.push({ method: 'andWhere', args });
      return usageQuery;
    },
    execute: async () => {
      usageQueries.push({ method: 'execute', args: [] });
    },
  };
  const intentionsRepository = {
    create: (entity: Record<string, unknown>) => entity,
    save: async (entity: Record<string, unknown>) => {
      savedIntentions.push({ ...entity });
      return entity;
    },
    findOne: async (findOptions: unknown) => {
      const where = (findOptions as { where?: { id?: string; slug?: string } })
        ?.where;
      const id = where?.id;
      if (id && options.intentionsById?.[id] !== undefined) {
        return options.intentionsById[id];
      }
      const slug = where?.slug;
      if (slug && options.intentionsBySlug?.[slug] !== undefined) {
        return options.intentionsBySlug[slug];
      }
      return options.intention ?? null;
    },
    find: async (findOptions: unknown) => {
      intentionFindOptions.push(findOptions);
      return options.intentions ?? [];
    },
    delete: async (criteria: unknown) => {
      deletedIntentions.push(criteria);
    },
    count: async () => 0,
    createQueryBuilder: () => usageQuery,
    manager: {
      transaction: async (callback: (manager: unknown) => Promise<unknown>) => {
        transactionCalls += 1;
        return callback({
          getRepository: () => ({
            save: async (entity: Record<string, unknown>) => {
              savedIntentions.push({ ...entity });
              return entity;
            },
            update: async (criteria: unknown, update: unknown) => {
              taskUpdates.push({ criteria, update });
            },
            query: async (statement: string, parameters: unknown[]) => {
              cascadeQueries.push({ statement, parameters });
            },
          }),
          query: async (statement: string, parameters: unknown[]) => {
            cascadeQueries.push({ statement, parameters });
          },
        });
      },
    },
  };

  const service = new IntentionsService(
    intentionsRepository as never,
    {
      update: async (criteria: unknown, update: unknown) => {
        taskUpdates.push({ criteria, update });
      },
      query: async (statement: string, parameters: unknown[]) => {
        cascadeQueries.push({ statement, parameters });
      },
    } as never,
    {
      getMonthlyIntentionsUsage: async () => {
        monthlyUsageCalls += 1;
        return {};
      },
      deleteStatsByIntention: async () => undefined,
      nullifyIntentionInStats: async () => undefined,
      updateIntentionParentStats: async () => undefined,
    } as never,
    {
      emitTasksUpdate: (userId: string) => realtimeUpdates.push(userId),
    } as never,
    {
      renameIntentionSlug: async (
        userId: string,
        type: string,
        from: string,
        to: string
      ) => renamedRuntimeSlugs.push({ userId, type, from, to }),
    } as never
  );

  return {
    service,
    savedIntentions,
    deletedIntentions,
    taskUpdates,
    cascadeQueries,
    renamedRuntimeSlugs,
    realtimeUpdates,
    intentionFindOptions,
    usageQueries,
    getTransactionCalls: () => transactionCalls,
    getMonthlyUsageCalls: () => monthlyUsageCalls,
  };
}

describe('IntentionsService', () => {
  it('updates unique Intention usage slugs with one set-based statement', async () => {
    const { service, usageQueries } = createService({});

    await service.incrementIntentionsUsage('user-1', [
      'focus',
      'focus',
      '',
      'deep-work',
    ]);

    expect(usageQueries).toEqual([
      { method: 'update', args: [expect.any(Function)] },
      {
        method: 'set',
        args: [{ usageCount: expect.any(Function) }],
      },
      {
        method: 'where',
        args: ['"userId" = :userId', { userId: 'user-1' }],
      },
      {
        method: 'andWhere',
        args: ['"slug" IN (:...slugs)', { slugs: ['focus', 'deep-work'] }],
      },
      { method: 'execute', args: [] },
    ]);
  });

  it('guards one set-based decrement at zero while preserving cross-type slugs', async () => {
    const { service, usageQueries } = createService({});

    await service.decrementIntentionsUsage('user-1', [
      'focus',
      'focus',
      'deep-work',
    ]);

    expect(usageQueries).toEqual([
      { method: 'update', args: [expect.any(Function)] },
      {
        method: 'set',
        args: [{ usageCount: expect.any(Function) }],
      },
      {
        method: 'where',
        args: ['"userId" = :userId', { userId: 'user-1' }],
      },
      {
        method: 'andWhere',
        args: ['"slug" IN (:...slugs)', { slugs: ['focus', 'deep-work'] }],
      },
      {
        method: 'andWhere',
        args: ['"usageCount" > 0'],
      },
      { method: 'execute', args: [] },
    ]);
  });

  it('does not issue usage updates for empty slug selections', async () => {
    const { service, usageQueries } = createService({});

    await service.incrementIntentionsUsage('user-1', ['', '']);
    await service.decrementIntentionsUsage('user-1', []);

    expect(usageQueries).toEqual([]);
  });

  it('loads assistant metadata without computing monthly usage', async () => {
    const { service, getMonthlyUsageCalls, intentionFindOptions } =
      createService({
        intentions: [{ slug: 'focus', title: 'Focus' }],
      });

    await expect(
      service.getActiveIntentionsForAssistant('user-1')
    ).resolves.toEqual([{ slug: 'focus', title: 'Focus' }]);
    expect(getMonthlyUsageCalls()).toBe(0);
    expect(intentionFindOptions).toEqual([
      {
        where: { userId: 'user-1', isArchived: false },
        relations: { parentIntention: true },
        order: { title: 'ASC' },
      },
    ]);
  });

  it('filters task-disabled Parent Intention trees from Assistant metadata', async () => {
    const disabledParent = {
      id: 'disabled-parent',
      slug: 'private',
      title: 'Private',
      allowsTasks: false,
      parentIntention: null,
    };
    const enabledParent = {
      id: 'enabled-parent',
      slug: 'focus',
      title: 'Focus',
      allowsTasks: true,
      parentIntention: null,
    };
    const { service } = createService({
      intentions: [
        disabledParent,
        { slug: 'private-child', parentIntention: disabledParent },
        enabledParent,
        { slug: 'focus-child', parentIntention: enabledParent },
      ],
    });

    await expect(
      service.getActiveIntentionsForAssistant('user-1')
    ).resolves.toEqual([
      enabledParent,
      { slug: 'focus-child', parentIntention: enabledParent },
    ]);
  });

  it('loads only targeted Intention label fields without usage work', async () => {
    const { service, getMonthlyUsageCalls, intentionFindOptions } =
      createService({
        intentions: [
          {
            type: TIMER_TYPES.WORK,
            slug: 'focus',
            emoji: '🎯',
            title: 'Focus',
          },
          {
            type: TIMER_TYPES.BREAK,
            slug: 'focus',
            emoji: '☕',
            title: 'Break Focus',
          },
        ],
      });

    await expect(
      service.getIntentionLabelsByTypeAndSlug('user-1', [
        { type: TIMER_TYPES.WORK, slugs: ['focus', 'focus'] },
        { type: TIMER_TYPES.BREAK, slugs: ['focus'] },
      ])
    ).resolves.toEqual({
      'work:focus': '🎯 Focus',
      'break:focus': '☕ Break Focus',
    });
    expect(getMonthlyUsageCalls()).toBe(0);
    expect(intentionFindOptions).toHaveLength(1);
    const findOptions = intentionFindOptions[0] as {
      select: Record<string, boolean>;
      where: Array<{
        userId: string;
        type: string;
        slug: { value: string[] };
      }>;
    };
    expect(findOptions.select).toEqual({
      type: true,
      slug: true,
      emoji: true,
      title: true,
    });
    expect(
      findOptions.where.map(({ userId, type, slug }) => ({
        userId,
        type,
        slugs: slug.value,
      }))
    ).toEqual([
      { userId: 'user-1', type: TIMER_TYPES.WORK, slugs: ['focus'] },
      { userId: 'user-1', type: TIMER_TYPES.BREAK, slugs: ['focus'] },
    ]);
  });

  it('generates non-empty slugs for symbol-only titles', () => {
    expect(generateIntentionSlug('++')).toBe('plus-plus');
    expect(generateIntentionSlug('Focused Work')).toBe('focused-work');
    expect(generateIntentionSlug('🔥')).toMatch(/^intention-[a-z0-9]+$/);
  });

  it('stores a valid slug for a symbol-only title', async () => {
    const { service, savedIntentions } = createService({});
    await service.createIntention(
      'user-1',
      '++',
      '➕',
      TIMER_TYPES.WORK,
      false
    );
    expect(savedIntentions).toHaveLength(1);
    expect(savedIntentions[0]).toMatchObject({ slug: 'plus-plus' });
  });

  it('unlinks only Tasks with the same type when archiving', async () => {
    const { service, taskUpdates, cascadeQueries } = createService({
      intention: {
        userId: 'user-1',
        slug: 'shared',
        type: TIMER_TYPES.BREAK,
        isArchived: false,
      },
    });
    await service.archiveIntention('user-1', 'shared', TIMER_TYPES.BREAK);
    expect(taskUpdates).toEqual([
      {
        criteria: {
          userId: 'user-1',
          timerType: TIMER_TYPES.BREAK,
          intentionSlug: 'shared',
        },
        update: { intentionSlug: null, subIntentionSlug: null },
      },
    ]);
    expect(cascadeQueries).toEqual([
      expect.objectContaining({
        statement: expect.stringContaining('"followUpDefinition"'),
        parameters: ['user-1', TIMER_TYPES.BREAK, 'shared'],
      }),
    ]);
  });

  it('unlinks embedded follow-up children when archiving a Sub-intention', async () => {
    const { service, taskUpdates, cascadeQueries } = createService({
      intention: {
        userId: 'user-1',
        slug: 'review',
        type: TIMER_TYPES.WORK,
        isArchived: false,
        parentIntentionId: 'parent-1',
        parentIntention: { id: 'parent-1', slug: 'focus' },
      },
    });

    await service.archiveIntention('user-1', 'review', TIMER_TYPES.WORK);

    expect(taskUpdates).toEqual([
      {
        criteria: {
          userId: 'user-1',
          timerType: TIMER_TYPES.WORK,
          subIntentionSlug: 'review',
          itemKind: expect.anything(),
        },
        update: { subIntentionSlug: null },
      },
    ]);
    expect(cascadeQueries).toEqual([
      expect.objectContaining({
        statement: expect.stringContaining("'{subIntentionSlug}'"),
        parameters: ['user-1', TIMER_TYPES.WORK, 'review'],
      }),
    ]);
  });

  it('unlinks matching Tasks when deleting a work intention', async () => {
    const { service, deletedIntentions, taskUpdates } = createService({
      intention: {
        userId: 'user-1',
        slug: 'deep-work',
        type: TIMER_TYPES.WORK,
      },
    });
    await service.deleteIntention('user-1', 'deep-work', TIMER_TYPES.WORK);
    expect(taskUpdates).toEqual([
      {
        criteria: {
          userId: 'user-1',
          timerType: TIMER_TYPES.WORK,
          intentionSlug: 'deep-work',
        },
        update: { intentionSlug: null, subIntentionSlug: null },
      },
    ]);
    expect(deletedIntentions).toEqual([
      { userId: 'user-1', slug: 'deep-work', type: TIMER_TYPES.WORK },
    ]);
  });

  it('cascades persisted and runtime links when a slug changes', async () => {
    const intention = {
      id: 'intention-1',
      userId: 'user-1',
      title: 'Deep Work',
      emoji: '🎯',
      slug: 'deep-work',
      type: TIMER_TYPES.WORK,
      parentIntentionId: null,
      parentIntention: null,
    };
    const { service, cascadeQueries, renamedRuntimeSlugs, realtimeUpdates } =
      createService({ intention, intentions: [intention] });

    const renamed = await service.updateIntention(
      'user-1',
      'deep-work',
      'Focused Work',
      '🎯',
      TIMER_TYPES.WORK
    );

    expect(renamed.slug).toBe('focused-work');
    for (const table of ['"tasks"', '"task_events"', '"statistics"']) {
      expect(
        cascadeQueries.some(query => query.statement.includes(table))
      ).toBe(true);
    }
    expect(renamedRuntimeSlugs).toEqual([
      {
        userId: 'user-1',
        type: TIMER_TYPES.WORK,
        from: 'deep-work',
        to: 'focused-work',
      },
    ]);
    expect(realtimeUpdates).toEqual(['user-1']);
  });

  it('atomically disables a Parent and unlinks every matching Task', async () => {
    const intention = {
      id: 'intention-1',
      userId: 'user-1',
      title: 'Focus',
      emoji: '🎯',
      slug: 'focus',
      type: TIMER_TYPES.WORK,
      parentIntentionId: null,
      parentIntention: null,
      allowsTasks: true,
    };
    const { service, taskUpdates, realtimeUpdates } = createService({
      intention,
      intentions: [intention],
    });

    const saved = await service.updateIntention(
      'user-1',
      'focus',
      'Focus',
      '🎯',
      TIMER_TYPES.WORK,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false
    );

    expect(saved.allowsTasks).toBe(false);
    expect(taskUpdates).toEqual([
      {
        criteria: {
          userId: 'user-1',
          timerType: TIMER_TYPES.WORK,
          intentionSlug: 'focus',
          itemKind: expect.anything(),
        },
        update: { intentionSlug: null, subIntentionSlug: null },
      },
    ]);
    expect(realtimeUpdates).toEqual(['user-1']);
  });

  it('ignores allowsTasks updates on Sub-intentions', async () => {
    const intention = {
      id: 'child-1',
      userId: 'user-1',
      title: 'Review',
      emoji: '🔎',
      slug: 'review',
      type: TIMER_TYPES.WORK,
      parentIntentionId: 'parent-1',
      parentIntention: { id: 'parent-1', slug: 'focus' },
      allowsTasks: true,
    };
    const { service, taskUpdates } = createService({
      intention,
      intentions: [intention],
    });

    const saved = await service.updateIntention(
      'user-1',
      'review',
      'Review',
      '🔎',
      TIMER_TYPES.WORK,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false
    );

    expect(saved.allowsTasks).toBe(true);
    expect(taskUpdates).toEqual([]);
  });

  it('atomically unlinks Tasks when updating a Sub-intention into a disabled Parent', async () => {
    const enabledParent = {
      id: 'enabled-parent',
      slug: 'focus',
      allowsTasks: true,
      parentIntentionId: null,
    };
    const disabledParent = {
      id: 'disabled-parent',
      slug: 'private',
      allowsTasks: false,
      parentIntentionId: null,
    };
    const child = {
      id: 'child-1',
      userId: 'user-1',
      title: 'Review',
      emoji: '🔎',
      slug: 'review',
      type: TIMER_TYPES.WORK,
      parentIntentionId: enabledParent.id,
      parentIntention: enabledParent,
      allowsTasks: true,
    };
    const { service, taskUpdates, getTransactionCalls } = createService({
      intentionsBySlug: {
        review: child,
        private: disabledParent,
      },
      intentionsById: {
        [disabledParent.id]: disabledParent,
      },
    });

    await service.updateIntention(
      'user-1',
      'review',
      'Review',
      '🔎',
      TIMER_TYPES.WORK,
      undefined,
      undefined,
      undefined,
      undefined,
      disabledParent.id
    );

    expect(getTransactionCalls()).toBe(1);
    expect(taskUpdates).toEqual([
      {
        criteria: {
          userId: 'user-1',
          timerType: TIMER_TYPES.WORK,
          subIntentionSlug: 'review',
          itemKind: expect.anything(),
        },
        update: { intentionSlug: null, subIntentionSlug: null },
      },
    ]);
  });

  it('atomically unlinks Tasks when reparenting a Sub-intention into a disabled Parent', async () => {
    const enabledParent = {
      id: 'enabled-parent',
      slug: 'focus',
      allowsTasks: true,
      parentIntentionId: null,
    };
    const disabledParent = {
      id: 'disabled-parent',
      slug: 'private',
      allowsTasks: false,
      parentIntentionId: null,
    };
    const child = {
      id: 'child-1',
      userId: 'user-1',
      title: 'Review',
      emoji: '🔎',
      slug: 'review',
      type: TIMER_TYPES.WORK,
      parentIntentionId: enabledParent.id,
      parentIntention: enabledParent,
      allowsTasks: true,
    };
    const { service, taskUpdates, getTransactionCalls } = createService({
      intentionsBySlug: {
        review: child,
        private: disabledParent,
      },
    });

    await service.reparentIntention(
      'user-1',
      'review',
      TIMER_TYPES.WORK,
      'private'
    );

    expect(getTransactionCalls()).toBe(1);
    expect(taskUpdates).toEqual([
      {
        criteria: {
          userId: 'user-1',
          timerType: TIMER_TYPES.WORK,
          subIntentionSlug: 'review',
          itemKind: expect.anything(),
        },
        update: { intentionSlug: null, subIntentionSlug: null },
      },
    ]);
  });
});
