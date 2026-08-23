import {
  BadRequestException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TASK_STATUSES } from '@pomi/shared';
import { In, Repository } from 'typeorm';
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
    let state = await this.vacationRepository.findOne({ where: { userId } });
    state ??= this.vacationRepository.create({ userId });
    state.active = true;
    state.runId = uuid();
    state.startedOn = today;
    state.endsOn = endsOn ?? null;
    state = await this.vacationRepository.save(state);
    await this.applyDueDateShifts(state, today, preferences.timeZone);
    return this.publicState(state);
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
      const preferences = await this.preferencesService.getPreferences(
        state.userId
      );
      if (!preferences.vacationExtension) {
        state.active = false;
        await this.vacationRepository.save(state);
        continue;
      }
      const today = this.localDate(resolvedNow, preferences.timeZone);
      if (state.endsOn && today >= state.endsOn) {
        await this.applyDueDateShifts(
          state,
          this.addDays(state.endsOn, -1),
          preferences.timeZone
        );
        state.active = false;
        await this.vacationRepository.save(state);
        continue;
      }
      await this.applyDueDateShifts(state, today, preferences.timeZone);
    }
  }

  private async applyDueDateShifts(
    state: VacationEntity,
    throughDate: string,
    timeZone: string
  ) {
    if (!state.runId || !state.startedOn) return;
    const items = await this.tasksRepository.find({
      where: {
        userId: state.userId,
        status: TASK_STATUSES.ACTIVE,
        vacationEligible: true,
      },
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
      await this.tasksRepository.save(item);
      changed = true;
    }
    if (changed) this.realtimeEvents.emitTasksUpdate(state.userId);
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
