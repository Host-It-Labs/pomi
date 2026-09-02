import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { HabitCadence, IntentionType, TIMER_TYPES } from '@pomi/shared';
import { StatisticsService } from 'src/statistics/statistics.service';
import { In, IsNull, Repository } from 'typeorm';
import { TaskEntity } from '../tasks/tasks.entity';
import { TimerStore } from '../timer/timer-store';
import { RealtimeEvents } from '../realtime/realtime-events';
import { Intention } from './intentions.entity';
import { generateIntentionSlug } from './intention-slug';

type GetAllIntentionsOptions = {
  includeSubIntentions?: boolean;
  parentSlug?: string;
};

@Injectable()
export class IntentionsService {
  constructor(
    @InjectRepository(Intention)
    private intentionsRepository: Repository<Intention>,
    @InjectRepository(TaskEntity)
    private tasksRepository: Repository<TaskEntity>,
    @Inject(forwardRef(() => StatisticsService))
    private statisticsService: StatisticsService,
    private realtimeEvents: RealtimeEvents,
    private timerStore: TimerStore
  ) {}

  async getAllIntentions(
    userId: string,
    type?: IntentionType,
    isArchived?: boolean,
    options?: GetAllIntentionsOptions
  ): Promise<Intention[]> {
    const resolvedOptions = options ?? {};
    const whereClause: {
      userId: string;
      type?: IntentionType;
      isArchived?: boolean;
      parentIntentionId?: string | ReturnType<typeof IsNull>;
    } = {
      userId,
    };

    if (type) {
      whereClause.type = type;
    }
    if (isArchived !== undefined) {
      whereClause.isArchived = isArchived;
    }

    let usageMap: Record<string, { count: number }>;
    if (resolvedOptions.parentSlug) {
      const parentType = type ?? TIMER_TYPES.WORK;
      const parent = await this.findIntentionBySlug(
        userId,
        resolvedOptions.parentSlug,
        parentType
      );
      whereClause.type = parent.type;
      whereClause.parentIntentionId = parent.id;
      usageMap = await this.statisticsService.getMonthlySubIntentionsUsage(
        userId,
        parent.slug,
        parent.type
      );
    } else {
      if (!resolvedOptions.includeSubIntentions) {
        whereClause.parentIntentionId = IsNull();
      }
      usageMap = await this.statisticsService.getMonthlyIntentionsUsage(
        userId,
        type
      );
    }

    const intentions = await this.intentionsRepository.find({
      where: whereClause,
      relations: { parentIntention: true },
    });

    return intentions
      .map(intention => ({
        ...intention,
        usageCount: usageMap[intention.slug]?.count || 0,
      }))
      .sort((a, b) => {
        return b.usageCount - a.usageCount || a.title.localeCompare(b.title);
      });
  }

  async getActiveIntentionsForAssistant(userId: string): Promise<Intention[]> {
    const intentions = await this.intentionsRepository.find({
      where: { userId, isArchived: false },
      relations: { parentIntention: true },
      order: { title: 'ASC' },
    });
    return intentions.filter(intention =>
      intention.parentIntention
        ? intention.parentIntention.allowsTasks !== false
        : intention.allowsTasks !== false
    );
  }

  async createIntention(
    userId: string,
    title: string,
    emoji: string,
    type: IntentionType,
    hasCustomDuration: boolean,
    customDuration?: number,
    keepScreenAwake?: boolean,
    isHabit?: boolean,
    parentIntentionId?: string | null,
    isFavorite?: boolean,
    description?: string | null,
    allowsTasks?: boolean,
    habitCadence?: HabitCadence
  ): Promise<Intention> {
    const slug = await this.getAvailableSlug(userId, type, title);
    const parentIntention = parentIntentionId
      ? await this.validateParentIntention(userId, parentIntentionId, type)
      : null;

    const intention = this.intentionsRepository.create({
      userId,
      title,
      emoji,
      slug,
      type,
      parentIntentionId: parentIntention?.id ?? null,
      hasCustomDuration,
      customDuration: hasCustomDuration ? customDuration : null,
      keepScreenAwake: keepScreenAwake === true,
      isHabit: habitCadence ? habitCadence !== 'off' : isHabit === true,
      habitCadence: habitCadence ?? (isHabit ? 'daily' : 'off'),
      isFavorite: isFavorite === true,
      allowsTasks: parentIntention ? true : allowsTasks !== false,
      description: description?.trim() || null,
      vacationDefault: false,
    });

    try {
      return await this.intentionsRepository.save(intention);
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new ConflictException('Intention already exists');
      }
      throw error;
    }
  }

  async incrementIntentionUsage(userId: string, slug: string): Promise<void> {
    await this.intentionsRepository.increment(
      { userId, slug },
      'usageCount',
      1
    );
  }

  async incrementIntentionsUsage(
    userId: string,
    slugs: string[]
  ): Promise<void> {
    const uniqueSlugs = Array.from(new Set(slugs.filter(Boolean)));
    if (uniqueSlugs.length === 0) return;

    await this.intentionsRepository
      .createQueryBuilder()
      .update(Intention)
      .set({ usageCount: () => '"usageCount" + 1' })
      .where('"userId" = :userId', { userId })
      .andWhere('"slug" IN (:...slugs)', { slugs: uniqueSlugs })
      .execute();
  }

  async incrementSubIntentionsUsage(
    userId: string,
    subIntentions?: Record<string, string>
  ): Promise<void> {
    await this.incrementIntentionsUsage(
      userId,
      Object.values(subIntentions ?? {})
    );
  }

  async decrementIntentionUsage(userId: string, slug: string): Promise<void> {
    await this.intentionsRepository
      .createQueryBuilder()
      .update(Intention)
      .set({
        usageCount: () => '"usageCount" - 1',
      })
      .where('"userId" = :userId', { userId })
      .andWhere('slug = :slug', { slug })
      .andWhere('"usageCount" > 0')
      .execute();
  }

  async decrementIntentionsUsage(
    userId: string,
    slugs: string[]
  ): Promise<void> {
    const uniqueSlugs = Array.from(new Set(slugs.filter(Boolean)));
    if (uniqueSlugs.length === 0) return;

    await this.intentionsRepository
      .createQueryBuilder()
      .update(Intention)
      .set({
        usageCount: () => 'GREATEST(0, "usageCount" - 1)',
      })
      .where('"userId" = :userId', { userId })
      .andWhere('"slug" IN (:...slugs)', { slugs: uniqueSlugs })
      .andWhere('"usageCount" > 0')
      .execute();
  }

  async decrementSubIntentionsUsage(
    userId: string,
    subIntentions?: Record<string, string>
  ): Promise<void> {
    await this.decrementIntentionsUsage(
      userId,
      Object.values(subIntentions ?? {})
    );
  }

  private async findIntentionBySlug(
    userId: string,
    slug: string,
    type: IntentionType
  ): Promise<Intention> {
    const intention = await this.intentionsRepository.findOne({
      where: { userId, slug, type },
      relations: { parentIntention: true },
    });

    if (!intention) {
      throw new NotFoundException('Intention not found');
    }

    return intention;
  }

  private async validateParentIntention(
    userId: string,
    parentIntentionId: string,
    type: IntentionType,
    currentIntentionId?: string
  ): Promise<Intention> {
    if (parentIntentionId === currentIntentionId) {
      throw new BadRequestException('An intention cannot be its own parent');
    }

    const parent = await this.intentionsRepository.findOne({
      where: { id: parentIntentionId, userId, type },
    });

    if (!parent) {
      throw new NotFoundException('Parent intention not found');
    }

    if (parent.parentIntentionId) {
      throw new BadRequestException('Sub-intentions cannot have children');
    }

    if (parent.isArchived) {
      throw new BadRequestException('Archived intentions cannot be parents');
    }

    return parent;
  }

  private async unlinkTasksForIntention(
    userId: string,
    slug: string,
    type: IntentionType,
    intention: Intention
  ) {
    if (intention.parentIntentionId) {
      await this.updateTaskLinksForMovedSubIntention(
        this.tasksRepository,
        userId,
        type,
        slug,
        null,
        false
      );
      this.realtimeEvents.emitTasksUpdate(userId);
      return;
    }

    await this.tasksRepository.update(
      { userId, timerType: type, intentionSlug: slug },
      { intentionSlug: null, subIntentionSlug: null }
    );
    await this.unlinkFollowUpDefinitions(
      this.tasksRepository,
      userId,
      type,
      slug
    );
    this.realtimeEvents.emitTasksUpdate(userId);
  }

  async deleteIntention(
    userId: string,
    slug: string,
    type: IntentionType,
    keepStats?: boolean
  ): Promise<void> {
    const intention = await this.findIntentionBySlug(userId, slug, type);

    if (intention.parentIntentionId) {
      const parent = intention.parentIntention;
      if (!parent) {
        throw new NotFoundException('Parent intention not found');
      }

      if (keepStats === false) {
        await this.statisticsService.deleteStatsBySubIntention(
          userId,
          parent.slug,
          slug,
          type
        );
      } else {
        await this.statisticsService.nullifySubIntentionInStats(
          userId,
          parent.slug,
          slug,
          type
        );
      }
    } else {
      if (keepStats === false) {
        await this.statisticsService.deleteStatsByIntention(userId, slug, type);
      } else {
        await this.statisticsService.nullifyIntentionInStats(
          userId,
          slug,
          type
        );
      }
    }
    await this.unlinkTasksForIntention(userId, slug, type, intention);
    await this.intentionsRepository.delete({ userId, slug, type });
  }

  async archiveIntention(
    userId: string,
    slug: string,
    type: IntentionType
  ): Promise<Intention> {
    const intention = await this.intentionsRepository.findOne({
      where: { userId, slug, type },
      relations: { parentIntention: true },
    });
    if (!intention) {
      throw new NotFoundException('Intention not found');
    }
    intention.isArchived = true;
    const saved = await this.intentionsRepository.save(intention);
    await this.unlinkTasksForIntention(userId, slug, type, intention);
    return saved;
  }

  async unarchiveIntention(
    userId: string,
    slug: string,
    type: IntentionType
  ): Promise<Intention> {
    const intention = await this.intentionsRepository.findOne({
      where: { userId, slug, type },
    });
    if (!intention) {
      throw new NotFoundException('Intention not found');
    }
    intention.isArchived = false;
    return this.intentionsRepository.save(intention);
  }

  async updateIntention(
    userId: string,
    slug: string,
    title: string,
    emoji: string,
    type: IntentionType,
    hasCustomDuration?: boolean,
    customDuration?: number,
    keepScreenAwake?: boolean,
    isHabit?: boolean,
    parentIntentionId?: string | null,
    isFavorite?: boolean,
    description?: string | null,
    allowsTasks?: boolean,
    habitCadence?: HabitCadence
  ): Promise<Intention> {
    const intention = await this.intentionsRepository.findOne({
      where: { userId, slug, type },
      relations: { parentIntention: true },
    });

    if (!intention) {
      throw new NotFoundException('Intention not found');
    }

    const previousParentId = intention.parentIntentionId;
    const previousParentSlug = intention.parentIntention?.slug ?? null;
    const previousSlug = intention.slug;
    const previouslyAllowedTasks = intention.allowsTasks;
    const titleChanged = intention.title !== title;
    let nextParentSlug = previousParentSlug;
    let nextParentAllowsTasks = true;

    intention.title = title;
    intention.emoji = emoji;
    if (titleChanged || intention.slug.trim().length === 0) {
      intention.slug = await this.getAvailableSlug(
        userId,
        type,
        title,
        intention.id
      );
    }
    if (hasCustomDuration !== undefined) {
      intention.hasCustomDuration = hasCustomDuration;
      intention.customDuration = hasCustomDuration
        ? (customDuration ?? null)
        : null;
    }
    if (keepScreenAwake !== undefined) {
      intention.keepScreenAwake = keepScreenAwake;
    }
    if (isHabit !== undefined) {
      intention.isHabit = isHabit;
      if (habitCadence === undefined) {
        intention.habitCadence = isHabit ? 'daily' : 'off';
      }
    }
    if (habitCadence !== undefined) {
      intention.habitCadence = habitCadence;
      intention.isHabit = habitCadence !== 'off';
    }
    if (isFavorite !== undefined) {
      intention.isFavorite = isFavorite;
    }
    if (allowsTasks !== undefined && intention.parentIntentionId === null) {
      intention.allowsTasks = allowsTasks;
    }
    if (description !== undefined) {
      intention.description = description?.trim() || null;
    }

    if (parentIntentionId !== undefined) {
      if (parentIntentionId === null) {
        intention.parentIntentionId = null;
        intention.parentIntention = null;
        nextParentSlug = null;
      } else {
        const childCount = await this.intentionsRepository.count({
          where: { userId, parentIntentionId: intention.id },
        });
        if (childCount > 0) {
          throw new BadRequestException(
            'Intentions with sub-intentions cannot become sub-intentions'
          );
        }
        const parent = await this.validateParentIntention(
          userId,
          parentIntentionId,
          type,
          intention.id
        );
        intention.parentIntentionId = parent.id;
        intention.parentIntention = parent;
        nextParentSlug = parent.slug;
        nextParentAllowsTasks = parent.allowsTasks !== false;
      }
    }

    if (
      parentIntentionId !== undefined &&
      previousParentId !== intention.parentIntentionId
    ) {
      await this.statisticsService.updateIntentionParentStats(
        userId,
        previousSlug,
        type,
        previousParentSlug,
        nextParentSlug
      );
    }

    const shouldUnlinkTasks =
      previouslyAllowedTasks &&
      intention.parentIntentionId === null &&
      intention.allowsTasks === false;
    const movedParent =
      parentIntentionId !== undefined &&
      previousParentId !== intention.parentIntentionId;
    const saved =
      intention.slug !== previousSlug
        ? await this.saveWithSlugCascade(
            intention,
            previousSlug,
            intention.parentIntentionId !== null,
            shouldUnlinkTasks,
            movedParent
              ? {
                  userId,
                  type,
                  nextParentSlug,
                  nextParentAllowsTasks,
                }
              : undefined
          )
        : movedParent
          ? await this.saveMovedSubIntention(
              intention,
              userId,
              type,
              nextParentSlug,
              nextParentAllowsTasks
            )
          : shouldUnlinkTasks
            ? await this.intentionsRepository.manager.transaction(
                async manager => {
                  const savedIntention = await manager
                    .getRepository(Intention)
                    .save(intention);
                  await manager.getRepository(TaskEntity).update(
                    {
                      userId,
                      timerType: type,
                      intentionSlug: savedIntention.slug,
                      itemKind: In(['task', 'followUp']),
                    },
                    { intentionSlug: null, subIntentionSlug: null }
                  );
                  await this.unlinkFollowUpDefinitions(
                    manager.getRepository(TaskEntity),
                    userId,
                    type,
                    savedIntention.slug
                  );
                  return savedIntention;
                }
              )
            : await this.intentionsRepository.save(intention);
    if (saved.slug !== previousSlug) {
      await this.timerStore.renameIntentionSlug(
        userId,
        type,
        previousSlug,
        saved.slug
      );
    }
    if (saved.slug !== previousSlug || shouldUnlinkTasks || movedParent) {
      this.realtimeEvents.emitTasksUpdate(userId);
    }
    return saved;
  }

  private async getAvailableSlug(
    userId: string,
    type: IntentionType,
    title: string,
    excludeId?: string
  ) {
    const baseSlug = generateIntentionSlug(title);
    const existing = await this.intentionsRepository.find({
      where: { userId, type },
      select: { id: true, slug: true },
    });
    const reserved = new Set(
      existing
        .filter(intention => intention.id !== excludeId)
        .map(intention => intention.slug)
    );
    if (!reserved.has(baseSlug)) {
      return baseSlug;
    }
    let suffix = 2;
    while (reserved.has(`${baseSlug}-${suffix}`)) {
      suffix += 1;
    }
    return `${baseSlug}-${suffix}`;
  }

  private async saveWithSlugCascade(
    intention: Intention,
    previousSlug: string,
    isSubIntention: boolean,
    unlinkTasks: boolean,
    movedParent?: {
      userId: string;
      type: IntentionType;
      nextParentSlug: string | null;
      nextParentAllowsTasks: boolean;
    }
  ) {
    return this.intentionsRepository.manager.transaction(async manager => {
      const saved = await manager.getRepository(Intention).save(intention);
      const parameters = [
        intention.userId,
        intention.type,
        previousSlug,
        intention.slug,
      ];
      if (isSubIntention) {
        await manager.query(
          `UPDATE "tasks" SET "subIntentionSlug" = $4 WHERE "userId" = $1 AND "timerType" = $2 AND "subIntentionSlug" = $3`,
          parameters
        );
        await manager.query(
          `UPDATE "tasks" SET "followUpDefinition" = jsonb_set("followUpDefinition", '{subIntentionSlug}', to_jsonb($4::text), false) WHERE "userId" = $1 AND "followUpDefinition" IS NOT NULL AND "followUpDefinition" ->> 'timerType' = $2 AND "followUpDefinition" ->> 'subIntentionSlug' = $3`,
          parameters
        );
        await manager.query(
          `UPDATE "task_events" SET "subIntentionSlugSnapshot" = $4 WHERE "userId" = $1 AND "timerTypeSnapshot" = $2 AND "subIntentionSlugSnapshot" = $3`,
          parameters
        );
        await manager.query(
          `UPDATE "statistics" SET "subIntentions" = COALESCE((SELECT jsonb_object_agg(key, CASE WHEN value = to_jsonb($3::text) THEN to_jsonb($4::text) ELSE value END) FROM jsonb_each("subIntentions")), '{}'::jsonb) WHERE "userId" = $1 AND "type" = $2 AND "subIntentions" IS NOT NULL`,
          parameters
        );
      } else {
        await manager.query(
          `UPDATE "tasks" SET "intentionSlug" = $4 WHERE "userId" = $1 AND "timerType" = $2 AND "intentionSlug" = $3`,
          parameters
        );
        await manager.query(
          `UPDATE "tasks" SET "followUpDefinition" = jsonb_set("followUpDefinition", '{intentionSlug}', to_jsonb($4::text), false) WHERE "userId" = $1 AND "followUpDefinition" IS NOT NULL AND "followUpDefinition" ->> 'timerType' = $2 AND "followUpDefinition" ->> 'intentionSlug' = $3`,
          parameters
        );
        await manager.query(
          `UPDATE "task_events" SET "intentionSlugSnapshot" = $4 WHERE "userId" = $1 AND "timerTypeSnapshot" = $2 AND "intentionSlugSnapshot" = $3`,
          parameters
        );
        await manager.query(
          `UPDATE "statistics" SET "intention" = $4 WHERE "userId" = $1 AND "type" = $2 AND "intention" = $3`,
          parameters
        );
        await manager.query(
          `UPDATE "statistics" SET "intentions" = array_replace("intentions", $3, $4) WHERE "userId" = $1 AND "type" = $2 AND $3 = ANY("intentions")`,
          parameters
        );
        await manager.query(
          `UPDATE "statistics" SET "subIntentions" = ("subIntentions" - $3::text) || jsonb_build_object($4::text, "subIntentions" -> $3::text) WHERE "userId" = $1 AND "type" = $2 AND "subIntentions" ? $3::text`,
          parameters
        );
      }
      if (unlinkTasks) {
        await manager.getRepository(TaskEntity).update(
          {
            userId: intention.userId,
            timerType: intention.type,
            intentionSlug: intention.slug,
            itemKind: In(['task', 'followUp']),
          },
          { intentionSlug: null, subIntentionSlug: null }
        );
        await this.unlinkFollowUpDefinitions(
          manager.getRepository(TaskEntity),
          intention.userId,
          intention.type,
          intention.slug
        );
      }
      if (movedParent) {
        await this.updateTaskLinksForMovedSubIntention(
          manager.getRepository(TaskEntity),
          movedParent.userId,
          movedParent.type,
          saved.slug,
          movedParent.nextParentSlug,
          movedParent.nextParentAllowsTasks
        );
      }
      return saved;
    });
  }

  private async saveMovedSubIntention(
    intention: Intention,
    userId: string,
    type: IntentionType,
    nextParentSlug: string | null,
    nextParentAllowsTasks: boolean
  ): Promise<Intention> {
    return this.intentionsRepository.manager.transaction(async manager => {
      const saved = await manager.getRepository(Intention).save(intention);
      await this.updateTaskLinksForMovedSubIntention(
        manager.getRepository(TaskEntity),
        userId,
        type,
        saved.slug,
        nextParentSlug,
        nextParentAllowsTasks
      );
      return saved;
    });
  }

  private async updateTaskLinksForMovedSubIntention(
    tasksRepository: Repository<TaskEntity>,
    userId: string,
    type: IntentionType,
    subIntentionSlug: string,
    nextParentSlug: string | null,
    nextParentAllowsTasks: boolean
  ): Promise<void> {
    await tasksRepository.update(
      {
        userId,
        timerType: type,
        subIntentionSlug,
        itemKind: In(['task', 'followUp']),
      },
      nextParentSlug
        ? nextParentAllowsTasks
          ? { intentionSlug: nextParentSlug }
          : { intentionSlug: null, subIntentionSlug: null }
        : { subIntentionSlug: null }
    );
    if (nextParentSlug && nextParentAllowsTasks) {
      await tasksRepository.query(
        `UPDATE "tasks" SET "followUpDefinition" = jsonb_set("followUpDefinition", '{intentionSlug}', to_jsonb($4::text), false) WHERE "userId" = $1 AND "followUpDefinition" IS NOT NULL AND "followUpDefinition" ->> 'timerType' = $2 AND "followUpDefinition" ->> 'subIntentionSlug' = $3`,
        [userId, type, subIntentionSlug, nextParentSlug]
      );
      return;
    }
    await tasksRepository.query(
      nextParentSlug
        ? `UPDATE "tasks" SET "followUpDefinition" = jsonb_set(jsonb_set("followUpDefinition", '{intentionSlug}', 'null'::jsonb, false), '{subIntentionSlug}', 'null'::jsonb, false) WHERE "userId" = $1 AND "followUpDefinition" IS NOT NULL AND "followUpDefinition" ->> 'timerType' = $2 AND "followUpDefinition" ->> 'subIntentionSlug' = $3`
        : `UPDATE "tasks" SET "followUpDefinition" = jsonb_set("followUpDefinition", '{subIntentionSlug}', 'null'::jsonb, false) WHERE "userId" = $1 AND "followUpDefinition" IS NOT NULL AND "followUpDefinition" ->> 'timerType' = $2 AND "followUpDefinition" ->> 'subIntentionSlug' = $3`,
      [userId, type, subIntentionSlug]
    );
  }

  private async unlinkFollowUpDefinitions(
    tasksRepository: Repository<TaskEntity>,
    userId: string,
    type: IntentionType,
    intentionSlug: string
  ) {
    await tasksRepository.query(
      `UPDATE "tasks" SET "followUpDefinition" = jsonb_set(jsonb_set("followUpDefinition", '{intentionSlug}', 'null'::jsonb, false), '{subIntentionSlug}', 'null'::jsonb, false) WHERE "userId" = $1 AND "followUpDefinition" IS NOT NULL AND "followUpDefinition" ->> 'timerType' = $2 AND "followUpDefinition" ->> 'intentionSlug' = $3`,
      [userId, type, intentionSlug]
    );
  }

  async reparentIntention(
    userId: string,
    slug: string,
    type: IntentionType,
    parentSlug: string
  ): Promise<Intention> {
    const [intention, parent] = await Promise.all([
      this.findIntentionBySlug(userId, slug, type),
      this.findIntentionBySlug(userId, parentSlug, type),
    ]);

    if (intention.id === parent.id) {
      throw new BadRequestException('An intention cannot be its own parent');
    }

    if (intention.isArchived) {
      throw new BadRequestException('Archived intentions cannot be reparented');
    }

    if (parent.parentIntentionId) {
      throw new BadRequestException('Sub-intentions cannot have children');
    }

    if (parent.isArchived) {
      throw new BadRequestException('Archived intentions cannot be parents');
    }

    const childCount = await this.intentionsRepository.count({
      where: { userId, parentIntentionId: intention.id },
    });
    if (childCount > 0) {
      throw new BadRequestException(
        'Intentions with sub-intentions cannot become sub-intentions'
      );
    }

    const previousParentSlug = intention.parentIntention?.slug ?? null;
    intention.parentIntentionId = parent.id;
    intention.parentIntention = parent;
    await this.statisticsService.updateIntentionParentStats(
      userId,
      intention.slug,
      type,
      previousParentSlug,
      parent.slug
    );

    const saved = await this.saveMovedSubIntention(
      intention,
      userId,
      type,
      parent.slug,
      parent.allowsTasks !== false
    );
    if (previousParentSlug !== parent.slug) {
      this.realtimeEvents.emitTasksUpdate(userId);
    }
    return saved;
  }

  async getIntentionsBySlug(
    userId: string,
    slugs: string[],
    type?: IntentionType
  ): Promise<Record<string, Intention>> {
    if (!slugs.length) return {};

    const whereClause: {
      userId: string;
      slug: ReturnType<typeof In>;
      type?: IntentionType;
    } = {
      userId,
      slug: In(slugs),
    };
    if (type) {
      whereClause.type = type;
    }

    const intentions = await this.intentionsRepository.find({
      where: whereClause,
      relations: { parentIntention: true },
    });

    return intentions.reduce(
      (acc, intention) => {
        acc[intention.slug] = intention;
        return acc;
      },
      {} as Record<string, Intention>
    );
  }

  async getIntentionLabelsByTypeAndSlug(
    userId: string,
    lookups: Array<{ type: IntentionType; slugs: string[] }>
  ): Promise<Record<string, string>> {
    const where = lookups
      .map(({ type, slugs }) => ({
        userId,
        type,
        slugs: Array.from(new Set(slugs)),
      }))
      .filter(lookup => lookup.slugs.length > 0)
      .map(({ slugs, ...lookup }) => ({ ...lookup, slug: In(slugs) }));
    if (where.length === 0) return {};

    const intentions = await this.intentionsRepository.find({
      select: {
        type: true,
        slug: true,
        emoji: true,
        title: true,
      },
      where,
    });

    return Object.fromEntries(
      intentions.map(intention => [
        `${intention.type}:${intention.slug}`,
        `${intention.emoji} ${intention.title}`,
      ])
    );
  }

  async validateSubIntentionSelection(
    userId: string,
    selectedIntentions: string[],
    subIntentions: Record<string, string>,
    allowedTypes: IntentionType[]
  ): Promise<Record<string, Intention>> {
    if (selectedIntentions.length === 0) return {};

    const lookupSlugs = Array.from(
      new Set([...selectedIntentions, ...Object.values(subIntentions)])
    );
    const intentionData = (
      await Promise.all(
        allowedTypes.map(type =>
          this.getIntentionsBySlug(userId, lookupSlugs, type)
        )
      )
    ).reduce(
      (accumulator, current) => ({ ...accumulator, ...current }),
      {} as Record<string, Intention>
    );

    if (Object.keys(intentionData).length !== lookupSlugs.length) {
      throw new BadRequestException('Intention selection is invalid');
    }

    const subIntentionCounts = await this.getSubIntentionCountsByParentIds(
      userId,
      selectedIntentions
        .map(slug => intentionData[slug]?.id)
        .filter((id): id is string => Boolean(id))
    );

    for (const parentSlug of selectedIntentions) {
      const parent = intentionData[parentSlug];
      if (!parent || parent.parentIntentionId || parent.isArchived) {
        throw new BadRequestException('Intention selection is invalid');
      }

      const childSlug = subIntentions[parentSlug];
      if (!childSlug) {
        if ((subIntentionCounts[parent.id] ?? 0) > 0) {
          throw new BadRequestException(
            'Sub-intention is required for this intention'
          );
        }
        continue;
      }

      const child = intentionData[childSlug];
      if (
        !child ||
        child.parentIntentionId !== parent.id ||
        child.type !== parent.type ||
        child.isArchived
      ) {
        throw new BadRequestException('Sub-intention selection is invalid');
      }
    }

    return intentionData;
  }

  async validateTaskIntentionSelection(
    userId: string,
    selectedIntentions: string[],
    subIntentions: Record<string, string>,
    allowedTypes: IntentionType[]
  ): Promise<Record<string, Intention>> {
    const intentionData = await this.validateSubIntentionSelection(
      userId,
      selectedIntentions,
      subIntentions,
      allowedTypes
    );
    for (const parentSlug of selectedIntentions) {
      if (intentionData[parentSlug]?.allowsTasks === false) {
        throw new BadRequestException(
          'This Intention does not allow linked Tasks'
        );
      }
    }
    return intentionData;
  }

  async getSubIntentionCountsByParentIds(
    userId: string,
    parentIds: string[]
  ): Promise<Record<string, number>> {
    const uniqueParentIds = Array.from(new Set(parentIds.filter(Boolean)));
    if (uniqueParentIds.length === 0) return {};

    const results = await this.intentionsRepository
      .createQueryBuilder('intention')
      .select('intention.parentIntentionId', 'parentIntentionId')
      .addSelect('COUNT(*)', 'count')
      .where('intention.userId = :userId', { userId })
      .andWhere('intention.parentIntentionId IN (:...parentIds)', {
        parentIds: uniqueParentIds,
      })
      .andWhere('intention.isArchived = false')
      .groupBy('intention.parentIntentionId')
      .getRawMany();

    return results.reduce(
      (
        accumulator,
        result: { parentIntentionId: string; count: string | number }
      ) => {
        accumulator[result.parentIntentionId] = Number(result.count);
        return accumulator;
      },
      {} as Record<string, number>
    );
  }
}
