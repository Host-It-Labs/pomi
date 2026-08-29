import { describe, expect, it, vi } from 'vitest';
import { VacationService } from '../../src/vacation/vacation.service';
import { VacationEntity } from '../../src/vacation/vacation.entity';

type RepositoryMock = Record<string, any>;

function createRepositories(
  state: Record<string, any> | null,
  items: Record<string, any>[] = []
) {
  const taskQueries: Array<{ statement: string; parameters: unknown[] }> = [];
  const vacationRepository: RepositoryMock = {
    find: vi.fn().mockResolvedValue(state ? [state] : []),
    findOne: vi.fn().mockResolvedValue(state),
    create: vi.fn((value: Record<string, unknown>) => value),
    save: vi.fn(async (value: Record<string, unknown>) => value),
    update: vi.fn(
      async (_criteria: unknown, updates: Record<string, unknown>) => {
        if (state) Object.assign(state, updates);
      }
    ),
  };
  const tasksRepository: RepositoryMock = {
    find: vi.fn().mockResolvedValue(items),
    save: vi.fn(async (value: Record<string, unknown>) => value),
    update: vi.fn(),
    query: vi.fn(async (statement: string, parameters: unknown[]) => {
      taskQueries.push({ statement, parameters });
    }),
  };
  vacationRepository.manager = {
    transaction: async (callback: (manager: unknown) => Promise<unknown>) =>
      callback({
        getRepository: (entity: unknown) =>
          entity === VacationEntity ? vacationRepository : tasksRepository,
      }),
  };

  return { vacationRepository, tasksRepository, taskQueries };
}

describe('VacationService', () => {
  it('keeps embedded follow-up Vacation Coverage aligned with its Intention', async () => {
    const { vacationRepository, tasksRepository, taskQueries } =
      createRepositories(null);
    const service = new VacationService(
      vacationRepository as never,
      tasksRepository as never,
      { update: vi.fn() } as never,
      { update: vi.fn() } as never,
      { updatePreferences: vi.fn() } as never,
      { emitTasksUpdate: vi.fn() } as never
    );

    await service.configure('user-1', {
      intentionSlugs: ['focus'],
      listIds: [],
      excludedItemIds: [],
    });

    expect(taskQueries).toHaveLength(2);
    expect(taskQueries[0].statement).toContain("'false'::jsonb");
    expect(taskQueries[1].statement).toContain("'true'::jsonb");
    expect(taskQueries[1].parameters).toEqual(['user-1', ['focus']]);
  });

  it('catches up one calendar day at a time without shifting a day twice', async () => {
    const state = {
      userId: 'user-1',
      active: true,
      runId: 'run-1',
      startedOn: '2026-07-28',
      endsOn: null,
    };
    const item = {
      userId: 'user-1',
      status: 'active',
      vacationEligible: true,
      dueDate: '2026-08-01',
      lastReminderKey: 'old',
      lastVacationRunId: null,
      lastVacationShiftedOn: null,
      updatedAt: new Date('2026-07-28T08:00:00Z'),
    };
    const { vacationRepository, tasksRepository } = createRepositories(state, [
      item,
    ]);
    const service = new VacationService(
      vacationRepository as never,
      tasksRepository as never,
      {} as never,
      {} as never,
      {
        getPreferences: vi
          .fn()
          .mockResolvedValue({ timeZone: 'UTC', vacationExtension: true }),
      } as never,
      { emitTasksUpdate: vi.fn() } as never
    );

    await service.processActiveVacations(new Date('2026-07-29T12:00:00Z'));
    expect(item.dueDate).toBe('2026-08-03');
    expect(item.lastVacationShiftedOn).toBe('2026-07-29');
    expect(state.lastProcessedOn).toBe('2026-07-29');
    expect(state.lastProcessedTimeZone).toBe('UTC');
    expect(tasksRepository.find).toHaveBeenCalledTimes(1);
    expect(vacationRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } })
    );

    await service.processActiveVacations(new Date('2026-07-29T18:00:00Z'));
    expect(item.dueDate).toBe('2026-08-03');
    expect(tasksRepository.save).toHaveBeenCalledTimes(1);
    expect(tasksRepository.find).toHaveBeenCalledTimes(1);
  });

  it('catches up through the exclusive return date before deactivating', async () => {
    const state = {
      userId: 'user-1',
      active: true,
      runId: 'run-1',
      startedOn: '2026-07-28',
      endsOn: '2026-07-30',
    };
    const item = {
      dueDate: '2026-08-01',
      lastReminderKey: null,
      lastVacationRunId: 'run-1',
      lastVacationShiftedOn: '2026-07-28',
      updatedAt: new Date('2026-07-28T08:00:00Z'),
    };
    const { vacationRepository, tasksRepository } = createRepositories(state, [
      item,
    ]);
    const service = new VacationService(
      vacationRepository as never,
      tasksRepository as never,
      {} as never,
      {} as never,
      {
        getPreferences: vi
          .fn()
          .mockResolvedValue({ timeZone: 'UTC', vacationExtension: true }),
      } as never,
      { emitTasksUpdate: vi.fn() } as never
    );

    await service.processActiveVacations(new Date('2026-07-30T08:00:00Z'));

    expect(state.active).toBe(false);
    expect(item.dueDate).toBe('2026-08-02');
    expect(item.lastVacationShiftedOn).toBe('2026-07-29');
    expect(tasksRepository.find).toHaveBeenCalledTimes(1);
  });

  it('deactivates on the return date without reloading already processed Tasks', async () => {
    const state = {
      userId: 'user-1',
      active: true,
      runId: 'run-1',
      startedOn: '2026-07-28',
      endsOn: '2026-07-30',
      lastProcessedOn: '2026-07-29',
      lastProcessedTimeZone: 'UTC',
    };
    const { vacationRepository, tasksRepository } = createRepositories(state);
    const service = new VacationService(
      vacationRepository as never,
      tasksRepository as never,
      {} as never,
      {} as never,
      {
        getPreferences: vi
          .fn()
          .mockResolvedValue({ timeZone: 'UTC', vacationExtension: true }),
      } as never,
      { emitTasksUpdate: vi.fn() } as never
    );

    await service.processActiveVacations(new Date('2026-07-30T08:00:00Z'));

    expect(state.active).toBe(false);
    expect(tasksRepository.find).not.toHaveBeenCalled();
  });

  it('starts shifting on the day an item becomes eligible', async () => {
    const state = {
      userId: 'user-1',
      active: true,
      runId: 'run-1',
      startedOn: '2026-07-25',
      endsOn: null,
    };
    const item = {
      dueDate: '2026-08-01',
      lastReminderKey: null,
      lastVacationRunId: null,
      lastVacationShiftedOn: null,
      updatedAt: new Date('2026-07-29T08:00:00Z'),
    };
    const { vacationRepository, tasksRepository } = createRepositories(state, [
      item,
    ]);
    const service = new VacationService(
      vacationRepository as never,
      tasksRepository as never,
      {} as never,
      {} as never,
      {
        getPreferences: vi
          .fn()
          .mockResolvedValue({ timeZone: 'UTC', vacationExtension: true }),
      } as never,
      { emitTasksUpdate: vi.fn() } as never
    );

    await service.processActiveVacations(new Date('2026-07-29T12:00:00Z'));

    expect(item.dueDate).toBe('2026-08-02');
    expect(item.lastVacationShiftedOn).toBe('2026-07-29');
  });

  it('deactivates without shifting when the extension is disabled', async () => {
    const state = {
      userId: 'user-1',
      active: true,
      runId: 'run-1',
      startedOn: '2026-07-28',
      endsOn: null,
    };
    const { vacationRepository, tasksRepository } = createRepositories(state);
    const service = new VacationService(
      vacationRepository as never,
      tasksRepository as never,
      {} as never,
      {} as never,
      {
        getPreferences: vi
          .fn()
          .mockResolvedValue({ timeZone: 'UTC', vacationExtension: false }),
      } as never,
      { emitTasksUpdate: vi.fn() } as never
    );

    await service.processActiveVacations(new Date('2026-07-29T12:00:00Z'));

    expect(state.active).toBe(false);
    expect(vacationRepository.save).toHaveBeenCalledWith(state);
    expect(tasksRepository.find).not.toHaveBeenCalled();
  });

  it('reprocesses an active vacation after same-day coverage reconfiguration', async () => {
    const state = {
      userId: 'user-1',
      active: true,
      runId: 'run-1',
      startedOn: '2026-07-28',
      endsOn: null,
    };
    const { vacationRepository, tasksRepository } = createRepositories(state);
    const preferencesService = {
      getPreferences: vi
        .fn()
        .mockResolvedValue({ timeZone: 'UTC', vacationExtension: true }),
      updatePreferences: vi.fn(),
    };
    const service = new VacationService(
      vacationRepository as never,
      tasksRepository as never,
      { update: vi.fn() } as never,
      { update: vi.fn() } as never,
      preferencesService as never,
      { emitTasksUpdate: vi.fn() } as never
    );

    await service.processActiveVacations(new Date('2026-07-29T12:00:00Z'));
    await service.configure('user-1', {
      intentionSlugs: [],
      listIds: [],
      excludedItemIds: [],
    });
    await service.processActiveVacations(new Date('2026-07-29T18:00:00Z'));

    expect(tasksRepository.find).toHaveBeenCalledTimes(2);
    expect(vacationRepository.update).toHaveBeenCalledWith(
      { userId: 'user-1', active: true },
      { lastProcessedOn: null, lastProcessedTimeZone: null }
    );
  });

  it('rechecks when the configured time zone changes without shifting an already processed day twice', async () => {
    const state = {
      userId: 'user-1',
      active: true,
      runId: 'run-1',
      startedOn: '2026-07-28',
      endsOn: null,
      lastProcessedOn: '2026-07-29',
      lastProcessedTimeZone: 'UTC',
    };
    const item = {
      userId: 'user-1',
      status: 'active',
      vacationEligible: true,
      dueDate: '2026-08-03',
      lastReminderKey: null,
      lastVacationRunId: 'run-1',
      lastVacationShiftedOn: '2026-07-29',
      updatedAt: new Date('2026-07-28T08:00:00Z'),
    };
    const { vacationRepository, tasksRepository } = createRepositories(state, [
      item,
    ]);
    const service = new VacationService(
      vacationRepository as never,
      tasksRepository as never,
      {} as never,
      {} as never,
      {
        getPreferences: vi.fn().mockResolvedValue({
          timeZone: 'America/New_York',
          vacationExtension: true,
        }),
      } as never,
      { emitTasksUpdate: vi.fn() } as never
    );

    await service.processActiveVacations(new Date('2026-07-29T18:00:00Z'));

    expect(tasksRepository.find).toHaveBeenCalledTimes(1);
    expect(item.dueDate).toBe('2026-08-03');
    expect(state.lastProcessedTimeZone).toBe('America/New_York');
  });
});
