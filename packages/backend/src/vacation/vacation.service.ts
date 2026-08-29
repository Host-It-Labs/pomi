import {
  BadRequestException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TASK_STATUSES } from '@pomi/shared';
import { In, IsNull, LessThan, Not, Repository } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { Intention } from '../intentions/intentions.entity';
import { ListEntity } from '../lists/lists.entity';
import { PreferencesService } from '../preferences/preferences.service';
import { RealtimeEvents } from '../realtime/realtime-events';
import { TaskEntity } from '../tasks/tasks.entity';
import { VacationEntity } from './vacation.entity';

@Injectable()
export class VacationService implements OnModuleInit, OnModuleDestroy {
  private interval: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(VacationEntity)
    private readonly vacationRepository: Repository<VacationEntity>,
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
    @InjectRepository(Intention)
    private readonly intentionsRepository: Repository<Intention>,
    @InjectRepository(ListEntity)
    private readonly listsRepository: Repository<ListEntity>,
    private readonly preferencesService: PreferencesService,
    private readonly realtimeEvents: RealtimeEvents
  ) {}

  onModuleInit() {
    this.interval = setInterval(
      () => void this.processActiveVacations(),
      60_000
    );
    this.interval.unref();
    void this.processActiveVacations();
  }

  onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
  }

  async status(userId: string) {
    const state = await this.vacationRepository.findOne({ where: { userId } });
    return this.publicState(state);
  }

  async configure(
    userId: string,
    input: {
      intentionSlugs: string[];
      listIds: string[];
      excludedItemIds: string[];
    }
  ) {
    await this.intentionsRepository.update(
      { userId },
      { vacationDefault: false }
    );
    if (input.intentionSlugs.length) {
      await this.intentionsRepository.update(
        { userId, slug: In(input.intentionSlugs) },
        { vacationDefault: true }
      );
    }
    await this.listsRepository.update({ userId }, { vacationDefault: false });
    if (input.listIds.length) {
      await this.listsRepository.update(
        { userId, id: In(input.listIds) },
        { vacationDefault: true }
      );
    }
    await this.tasksRepository.update({ userId }, { vacationEligible: false });
    await this.tasksRepository.query(
      `UPDATE "tasks" SET "followUpDefinition" = jsonb_set("followUpDefinition", '{vacationEligible}', 'false'::jsonb, false) WHERE "userId" = $1 AND "followUpDefinition" IS NOT NULL`,
      [userId]
    );
    if (input.intentionSlugs.length) {
      await this.tasksRepository.update(
        {
          userId,
          intentionSlug: In(input.intentionSlugs),
          itemKind: In(['task', 'followUp']),
        },
        { vacationEligible: true }
      );
      await this.tasksRepository.query(
        `UPDATE "tasks" SET "followUpDefinition" = jsonb_set("followUpDefinition", '{vacationEligible}', 'true'::jsonb, false) WHERE "userId" = $1 AND "followUpDefinition" IS NOT NULL AND "followUpDefinition" ->> 'intentionSlug' = ANY($2::text[])`,
        [userId, input.intentionSlugs]
      );
    }
    if (input.listIds.length) {
      await this.tasksRepository.update(
        { userId, listId: In(input.listIds), itemKind: 'listItem' },
        { vacationEligible: true }
      );
    }
    if (input.excludedItemIds.length) {
      await this.tasksRepository.update(
        { userId, id: In(input.excludedItemIds) },
        { vacationEligible: false }
      );
    }
    await this.vacationRepository.update(
      { userId, active: true },
      { lastProcessedOn: null, lastProcessedTimeZone: null }
    );
    this.realtimeEvents.emitTasksUpdate(userId);
    await this.preferencesService.updatePreferences(userId, {
      vacationCoverageConfigured: true,
    });
    return { success: true };
  }

  async activate(userId: string, endsOn?: string | null) {
    const preferences = await this.preferencesService.getPreferences(userId);
    if (!preferences.vacationExtension) {
      throw new BadRequestException('Vacation mode is not enabled');
    }
    const today = this.localDate(new Date(), preferences.timeZone);
    if (endsOn && endsOn <= today) {
      throw new BadRequestException('Return date must be after today');
    }
    const result = await this.vacationRepository.manager.transaction(
      async manager => {
        const vacationRepository = manager.getRepository(VacationEntity);
        const tasksRepository = manager.getRepository(TaskEntity);
        let state = await vacationRepository.findOne({
          where: { userId },
          lock: { mode: 'pessimistic_write' },
        });
        if (state?.active) {
          return { state, changed: false };
        }
        state ??= vacationRepository.create({ userId });
        state.active = true;
        state.runId = uuid();
        state.startedOn = today;
        state.endsOn = endsOn ?? null;
        state.lastProcessedOn = null;
        state.lastProcessedTimeZone = null;
        state = await vacationRepository.save(state);
        const changed = await this.applyDueDateShifts(
          state,
          today,
          preferences.timeZone,
          tasksRepository
        );
        state.lastProcessedOn = today;
        state.lastProcessedTimeZone = preferences.timeZone;
        state = await vacationRepository.save(state);
        return { state, changed };
      }
    );
    if (result.changed) this.realtimeEvents.emitTasksUpdate(userId);
    return this.publicState(result.state);
  }

  async deactivate(userId: string) {
    let state = await this.vacationRepository.findOne({ where: { userId } });
    if (!state) {
      state = await this.vacationRepository.save(
        this.vacationRepository.create({ userId, active: false })
      );
    } else if (state.active) {
      state.active = false;
      state = await this.vacationRepository.save(state);
    }
    return this.publicState(state);
  }

  async processActiveVacations(now?: Date) {
    const resolvedNow = now ?? new Date();
    const states = await this.vacationRepository.find({
      where: { active: true },
    });
    for (const state of states) {
      const changed = await this.processActiveVacation(
        state.userId,
        resolvedNow
      );
      if (changed) this.realtimeEvents.emitTasksUpdate(state.userId);
    }
  }

  private async processActiveVacation(
    userId: string,
    now: Date
  ): Promise<boolean> {
    return this.vacationRepository.manager.transaction(async manager => {
      const vacationRepository = manager.getRepository(VacationEntity);
      const tasksRepository = manager.getRepository(TaskEntity);
      const state = await vacationRepository.findOne({
        where: { userId, active: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!state) return false;

      const preferences = await this.preferencesService.getPreferences(userId);
      if (!preferences.vacationExtension) {
        state.active = false;
        await vacationRepository.save(state);
        return false;
      }

      const today = this.localDate(now, preferences.timeZone);
      const processingThrough =
        state.endsOn && today >= state.endsOn
          ? this.addDays(state.endsOn, -1)
          : today;
      const shouldProcess =
        state.lastProcessedOn !== processingThrough ||
        state.lastProcessedTimeZone !== preferences.timeZone;
      const shouldRun =
        shouldProcess ||
        (state.runId !== null &&
          (await this.hasUnprocessedDueDateShifts(
            state,
            processingThrough,
            tasksRepository
          )));

      if (!shouldRun) {
        if (state.endsOn && today >= state.endsOn) {
          state.active = false;
          await vacationRepository.save(state);
        }
        return false;
      }

      const changed = await this.applyDueDateShifts(
        state,
        processingThrough,
        preferences.timeZone,
        tasksRepository
      );
      state.lastProcessedOn = processingThrough;
      state.lastProcessedTimeZone = preferences.timeZone;
      if (state.endsOn && today >= state.endsOn) state.active = false;
      await vacationRepository.save(state);
      return changed;
    });
  }

  private async applyDueDateShifts(
    state: VacationEntity,
    throughDate: string,
    timeZone: string,
    tasksRepository: Repository<TaskEntity>
  ): Promise<boolean> {
    if (!state.runId || !state.startedOn) return false;
    const items = await tasksRepository.find({
      where: this.getUnprocessedDueDateShiftWhere(state, throughDate),
      lock: { mode: 'pessimistic_write' },
    });
    let changed = false;
    for (const item of items) {
      if (!item.dueDate) continue;
      const firstEligibleDate = this.localDate(item.updatedAt, timeZone);
      const firstDate =
        item.lastVacationRunId === state.runId && item.lastVacationShiftedOn
          ? this.addDays(item.lastVacationShiftedOn, 1)
          : firstEligibleDate > state.startedOn
            ? firstEligibleDate
            : state.startedOn;
      const lastDate =
        state.endsOn && throughDate >= state.endsOn
          ? this.addDays(state.endsOn, -1)
          : throughDate;
      const days = this.daysInclusive(firstDate, lastDate);
      if (days <= 0) continue;
      item.dueDate = this.addDays(item.dueDate, days);
      item.lastReminderKey = null;
      item.lastVacationRunId = state.runId;
      item.lastVacationShiftedOn = lastDate;
      await tasksRepository.save(item);
      changed = true;
    }
    return changed;
  }

  private async hasUnprocessedDueDateShifts(
    state: VacationEntity,
    throughDate: string,
    tasksRepository: Repository<TaskEntity>
  ) {
    return tasksRepository.exists({
      where: this.getUnprocessedDueDateShiftWhere(state, throughDate),
    });
  }

  private getUnprocessedDueDateShiftWhere(
    state: VacationEntity,
    throughDate: string
  ) {
    if (!state.runId) return [];
    const runId = state.runId;
    const base = {
      userId: state.userId,
      status: TASK_STATUSES.ACTIVE,
      vacationEligible: true,
      dueDate: Not(IsNull()),
    };

    return [
      { ...base, lastVacationRunId: IsNull() },
      { ...base, lastVacationRunId: Not(runId) },
      {
        ...base,
        lastVacationRunId: runId,
        lastVacationShiftedOn: IsNull(),
      },
      {
        ...base,
        lastVacationRunId: runId,
        lastVacationShiftedOn: LessThan(throughDate),
      },
    ];
  }

  private publicState(state: VacationEntity | null) {
    return {
      active: state?.active ?? false,
      runId: state?.runId ?? null,
      startedOn: state?.startedOn ?? null,
      endsOn: state?.endsOn ?? null,
    };
  }

  private localDate(date: Date, timeZone: string) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  private addDays(value: string, days: number) {
    const date = new Date(`${value}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  private daysInclusive(first: string, last: string) {
    if (first > last) return 0;
    const firstMs = Date.parse(`${first}T00:00:00.000Z`);
    const lastMs = Date.parse(`${last}T00:00:00.000Z`);
    return Math.floor((lastMs - firstMs) / 86_400_000) + 1;
  }
}
