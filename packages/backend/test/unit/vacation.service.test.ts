import { describe, expect, it, vi } from 'vitest';
import { VacationService } from '../../src/vacation/vacation.service';

describe('VacationService', () => {
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
    const vacationRepository = {
      find: vi.fn().mockResolvedValue([state]),
      save: vi.fn(async value => value),
    };
    const tasksRepository = {
      find: vi.fn().mockResolvedValue([item]),
      save: vi.fn(async value => value),
    };
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

    await service.processActiveVacations(new Date('2026-07-29T18:00:00Z'));
    expect(item.dueDate).toBe('2026-08-03');
    expect(tasksRepository.save).toHaveBeenCalledTimes(1);
  });

  it('catches up through the exclusive return date before deactivating', async () => {
    const state = {
      userId: 'user-1',
      active: true,
      runId: 'run-1',
      startedOn: '2026-07-28',
      endsOn: '2026-07-30',
    };
    const vacationRepository = {
      find: vi.fn().mockResolvedValue([state]),
      save: vi.fn(async value => value),
    };
    const item = {
      dueDate: '2026-08-01',
      lastReminderKey: null,
      lastVacationRunId: 'run-1',
      lastVacationShiftedOn: '2026-07-28',
      updatedAt: new Date('2026-07-28T08:00:00Z'),
    };
    const tasksRepository = {
      find: vi.fn().mockResolvedValue([item]),
      save: vi.fn(async value => value),
    };
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
    const tasksRepository = {
      find: vi.fn().mockResolvedValue([item]),
      save: vi.fn(async value => value),
    };
    const service = new VacationService(
      { find: vi.fn().mockResolvedValue([state]), save: vi.fn() } as never,
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
    const vacationRepository = {
      find: vi.fn().mockResolvedValue([state]),
      save: vi.fn(async value => value),
    };
    const tasksRepository = { find: vi.fn() };
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
});
