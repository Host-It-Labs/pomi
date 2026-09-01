import { describe, expect, it } from 'vitest';
import { TasksService } from '../../src/tasks/tasks.service';

type QueryBuilder = {
  conditions: Array<{ condition: string; params?: Record<string, unknown> }>;
  orders: Array<{ expression: string; direction?: string }>;
  takeValue: number | undefined;
  clone: () => QueryBuilder;
  where: (condition: string, params?: Record<string, unknown>) => QueryBuilder;
  andWhere: (
    condition: string,
    params?: Record<string, unknown>
  ) => QueryBuilder;
  orderBy: (expression: string, direction?: string) => QueryBuilder;
  addOrderBy: (expression: string, direction?: string) => QueryBuilder;
  setParameter: (key: string, value: unknown) => QueryBuilder;
  setParameters: (values: Record<string, unknown>) => QueryBuilder;
  take: (value: number) => QueryBuilder;
  getCount: () => Promise<number>;
  getMany: () => Promise<unknown[]>;
};

function createBuilder(
  count: number,
  rows: unknown[],
  onClone: (builder: QueryBuilder) => void = () => undefined
): QueryBuilder {
  const builder = {
    conditions: [],
    orders: [],
    takeValue: undefined,
    clone() {
      const cloned = createBuilder(count, rows, onClone);
      onClone(cloned);
      return cloned;
    },
    where(condition, params) {
      this.conditions.push({ condition, params });
      return this;
    },
    andWhere(condition, params) {
      this.conditions.push({ condition, params });
      return this;
    },
    orderBy(expression, direction) {
      this.orders.push({ expression, direction });
      return this;
    },
    addOrderBy(expression, direction) {
      this.orders.push({ expression, direction });
      return this;
    },
    setParameter(key, value) {
      this.conditions.push({ condition: key, params: { value } });
      return this;
    },
    setParameters(values) {
      this.conditions.push({ condition: 'parameters', params: values });
      return this;
    },
    take(value) {
      this.takeValue = value;
      return this;
    },
    getCount() {
      return Promise.resolve(count);
    },
    getMany() {
      return Promise.resolve(rows.slice(0, this.takeValue ?? rows.length));
    },
  } satisfies QueryBuilder;

  return builder;
}

function createTask(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    userId: 'user-1',
    title: id,
    dueDate: null,
    dueTime: null,
    manualOrder: null,
    manualOrderOverride: false,
    priority: 'normal',
    timerType: 'work',
    pinnedAt: null,
    intentionSlug: null,
    subIntentionSlug: null,
    followUpSourceTaskId: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('TasksService Watch query', () => {
  it('limits candidate reads while preserving grouped ordering and counts', async () => {
    const pinned = createTask('pinned', {
      pinnedAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    const automatic = createTask('automatic');
    const override = createTask('override', {
      manualOrder: 0,
      manualOrderOverride: true,
    });
    const builders: QueryBuilder[] = [];
    const repository = {
      createQueryBuilder() {
        const rows =
          builders.length === 1
            ? [pinned]
            : builders.length === 2
              ? [automatic]
              : builders.length === 3
                ? [override]
                : [];
        const builder = createBuilder(3, rows);
        builders.push(builder);
        return builder;
      },
      find: async () => [],
    };
    const service = new TasksService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    const result = await service.getWatchTaskSnapshot('user-1', {
      timerType: 'work',
      taskMode: 'general',
      timerIntentions: [],
      limit: 2,
      now: new Date('2026-09-01T00:00:00.000Z'),
      timeZone: 'UTC',
    });

    expect(result).toMatchObject({
      totalActiveTasks: 3,
      totalVisibleTasks: 3,
      tasks: [pinned, override],
    });
    expect(builders).toHaveLength(4);
    expect(builders[1].takeValue).toBe(2);
    expect(builders[2].takeValue).toBe(1);
    expect(builders[3].takeValue).toBe(1);
    expect(builders[2].conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ condition: 'task.pinnedAt IS NULL' }),
        expect.objectContaining({
          condition: 'task.manualOrderOverride = false',
        }),
      ])
    );
    expect(builders[2].orders.map(order => order.expression)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"task"."dueDate"'),
        'task.id',
      ])
    );
  });

  it('keeps the newest overrides when a manual position exceeds the limit', async () => {
    const overrides = Array.from({ length: 13 }, (_, index) =>
      createTask(`override-${index}`, {
        manualOrder: 0,
        manualOrderOverride: true,
        createdAt: new Date(
          `2026-09-01T00:00:${String(index).padStart(2, '0')}Z`
        ),
      })
    );
    const builders: QueryBuilder[] = [];
    const repository = {
      createQueryBuilder() {
        const rows = builders.length === 3 ? [...overrides].reverse() : [];
        const builder = createBuilder(13, rows);
        builders.push(builder);
        return builder;
      },
      find: async () => [],
    };
    const service = new TasksService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    const result = await service.getWatchTaskSnapshot('user-1', {
      timerType: 'work',
      taskMode: 'general',
      timerIntentions: [],
      limit: 12,
      now: new Date('2026-09-01T00:00:00.000Z'),
      timeZone: 'UTC',
    });

    expect(result.tasks.map(task => task.id)).toEqual(
      overrides
        .slice()
        .reverse()
        .slice(0, 12)
        .map(task => task.id)
    );
    expect(builders[3].takeValue).toBe(12);
  });
});
