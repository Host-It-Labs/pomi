import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  TASK_CREATION_SOURCES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TIMER_TYPES,
  TaskPriority,
  TaskStatus,
} from '@pomi/shared';
import { DataSource, In, Repository } from 'typeorm';
import { Intention } from '../intentions/intentions.entity';
import { generateIntentionSlug } from '../intentions/intention-slug';
import { RealtimeEvents } from '../realtime/realtime-events';
import { TaskEntity } from '../tasks/tasks.entity';
import { TimerStore } from '../timer/timer-store';
import { ListEntity } from './lists.entity';

@Injectable()
export class ListsService {
  constructor(
    @InjectRepository(ListEntity)
    private readonly listsRepository: Repository<ListEntity>,
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
    @InjectRepository(Intention)
    private readonly intentionsRepository: Repository<Intention>,
    private readonly dataSource: DataSource,
    private readonly timerStore: TimerStore,
    private readonly realtimeEvents: RealtimeEvents
  ) {}

  list(userId: string, includeArchived: boolean) {
    return this.listsRepository.find({
      where: includeArchived ? { userId } : { userId, isArchived: false },
      order: { title: 'ASC' },
    });
  }

  listItems(userId: string, listId?: string, status?: TaskStatus) {
    return this.tasksRepository
      .createQueryBuilder('item')
      .innerJoin(ListEntity, 'list', 'list.id = item.listId')
      .where('item.userId = :userId', { userId })
      .andWhere("item.itemKind = 'listItem'")
      .andWhere('list.isArchived = false')
      .andWhere(listId ? 'item.listId = :listId' : 'TRUE', { listId })
      .andWhere(status ? 'item.status = :status' : 'TRUE', { status })
      .orderBy('item.dueDate', 'ASC')
      .addOrderBy('item.manualOrder', 'ASC')
      .addOrderBy('item.createdAt', 'ASC')
      .getMany();
  }

  async create(
    userId: string,
    input: { title: string; emoji?: string | null; description?: string | null }
  ) {
    const title = input.title.trim();
    if (!title) throw new BadRequestException('List title is required');
    const duplicate = await this.listsRepository.findOne({
      where: { userId, title },
    });
    if (duplicate) throw new ConflictException('List already exists');
    const saved = await this.listsRepository.save(
      this.listsRepository.create({
        userId,
        title,
        emoji: input.emoji?.trim() || null,
        description: input.description?.trim() || null,
        vacationDefault: false,
        isArchived: false,
        isFavorite: false,
        sourceIntentionId: null,
      })
    );
    this.realtimeEvents.emitTasksUpdate(userId);
    return saved;
  }

  async update(
    userId: string,
    id: string,
    updates: Partial<
      Pick<
        ListEntity,
        | 'title'
        | 'emoji'
        | 'description'
        | 'vacationDefault'
        | 'isArchived'
        | 'isFavorite'
      >
    >
  ) {
    const list = await this.requireList(userId, id);
    if (updates.title !== undefined) {
      const title = updates.title.trim();
      if (!title) throw new BadRequestException('List title is required');
      const duplicate = await this.listsRepository.findOne({
        where: { userId, title },
      });
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException('List already exists');
      }
      list.title = title;
    }
    if (updates.emoji !== undefined) list.emoji = updates.emoji?.trim() || null;
    if (updates.description !== undefined) {
      list.description = updates.description?.trim() || null;
    }
    if (updates.vacationDefault !== undefined) {
      list.vacationDefault = updates.vacationDefault;
    }
    if (updates.isArchived !== undefined) list.isArchived = updates.isArchived;
    if (updates.isFavorite !== undefined) list.isFavorite = updates.isFavorite;
    const saved = await this.listsRepository.save(list);
    this.realtimeEvents.emitTasksUpdate(userId);
    return saved;
  }

  async createItem(
    userId: string,
    listId: string,
    input: {
      title: string;
      dueDate?: string | null;
      priority?: TaskPriority;
      creationSource?: 'manual' | 'assistant' | 'voice';
      vacationEligible?: boolean;
    }
  ) {
    const list = await this.requireList(userId, listId);
    if (list.isArchived) throw new BadRequestException('List is archived');
    const title = input.title.trim();
    if (!title) throw new BadRequestException('List item title is required');
    const item = this.tasksRepository.create({
      userId,
      title,
      description: null,
      sourceTranscript: null,
      creationSource: input.creationSource ?? TASK_CREATION_SOURCES.MANUAL,
      importSource: null,
      importSourceTaskId: null,
      dueDate: input.dueDate ?? null,
      dueTime: null,
      manualOrder: null,
      manualOrderOverride: false,
      lastReminderKey: null,
      priority: input.priority ?? TASK_PRIORITIES.NORMAL,
      status: TASK_STATUSES.ACTIVE,
      timerType: TIMER_TYPES.WORK,
      pinnedAt: null,
      intentionSlug: null,
      subIntentionSlug: null,
      recurrenceRule: null,
      recurrenceInterval: null,
      recurrenceSequenceIndex: 0,
      recurrenceAnchorMode: 'planned',
      followUpTaskId: null,
      followUpDelayDays: null,
      followUpSourceTaskId: null,
      itemKind: 'listItem',
      listId,
      taskRestoreState: null,
      vacationEligible: input.vacationEligible ?? list.vacationDefault,
      lastVacationRunId: null,
      lastVacationShiftedOn: null,
    });
    const saved = await this.tasksRepository.save(item);
    this.realtimeEvents.emitTasksUpdate(userId);
    return saved;
  }

  async updateItem(
    userId: string,
    id: string,
    updates: {
      title?: string;
      dueDate?: string | null;
      priority?: TaskPriority;
      status?: TaskStatus;
      vacationEligible?: boolean;
    }
  ) {
    const item = await this.tasksRepository.findOne({
      where: { id, userId, itemKind: 'listItem' },
    });
    if (!item) throw new NotFoundException('List item not found');
    if (updates.title !== undefined) item.title = updates.title.trim();
    if (updates.dueDate !== undefined) item.dueDate = updates.dueDate;
    if (updates.priority !== undefined) item.priority = updates.priority;
    if (updates.status !== undefined) item.status = updates.status;
    if (updates.vacationEligible !== undefined) {
      item.vacationEligible = updates.vacationEligible;
    }
    const saved = await this.tasksRepository.save(item);
    this.realtimeEvents.emitTasksUpdate(userId);
    return saved;
  }

  async resetCompletedItems(userId: string, listId: string) {
    await this.requireList(userId, listId);
    const result = await this.dataSource.transaction(manager =>
      manager.getRepository(TaskEntity).update(
        {
          userId,
          listId,
          itemKind: 'listItem',
          status: TASK_STATUSES.COMPLETED,
        },
        { status: TASK_STATUSES.ACTIVE }
      )
    );
    this.realtimeEvents.emitTasksUpdate(userId);
    return { restoredCount: result.affected ?? 0 };
  }

  async convertIntention(userId: string, intentionSlug: string) {
    const intention = await this.intentionsRepository.findOne({
      where: { userId, slug: intentionSlug, isArchived: false },
    });
    if (!intention) throw new NotFoundException('Intention not found');
    const activeChildren = await this.intentionsRepository.find({
      where: { userId, parentIntentionId: intention.id, isArchived: false },
      order: { title: 'ASC' },
    });
    const tasks = await this.tasksRepository.find({
      where: {
        userId,
        timerType: intention.type,
        intentionSlug,
        itemKind: 'task',
      },
    });
    if (activeChildren.length > 0) {
      const childSlugs = new Set(activeChildren.map(child => child.slug));
      if (
        tasks.some(
          task =>
            !task.subIntentionSlug || !childSlugs.has(task.subIntentionSlug)
        )
      ) {
        throw new BadRequestException(
          'Move Tasks linked directly to the Parent before converting it'
        );
      }
      const duplicateTitles = activeChildren.filter(
        (child, index) =>
          activeChildren.findIndex(
            candidate => candidate.title === child.title
          ) !== index
      );
      if (duplicateTitles.length > 0) {
        throw new ConflictException('Sub-intention List titles must be unique');
      }
    }
    await this.assertNoRunningFocusedItem(
      userId,
      tasks.map(task => task.id)
    );
    const convertedLists = await this.dataSource.transaction(async manager => {
      const lists = manager.getRepository(ListEntity);
      const taskRepository = manager.getRepository(TaskEntity);
      const intentionRepository = manager.getRepository(Intention);
      const sources = activeChildren.length > 0 ? activeChildren : [intention];
      const existing = await lists.find({
        where: { userId, title: In(sources.map(source => source.title)) },
      });
      if (existing.length > 0)
        throw new ConflictException('List already exists');

      const created: ListEntity[] = [];
      for (const source of sources) {
        const createdList = await lists.save(
          lists.create({
            userId,
            title: source.title,
            emoji: source.emoji,
            description: source.description,
            vacationDefault: source.vacationDefault,
            isArchived: false,
            isFavorite: source.isFavorite,
            sourceIntentionId: source.id,
          })
        );
        const matchingTasks = activeChildren.length
          ? tasks.filter(task => task.subIntentionSlug === source.slug)
          : tasks;
        matchingTasks.forEach(task =>
          this.prepareTaskAsListItem(task, createdList.id)
        );
        if (matchingTasks.length > 0) await taskRepository.save(matchingTasks);
        source.isArchived = true;
        await intentionRepository.save(source);
        created.push(createdList);
      }
      if (activeChildren.length > 0) {
        intention.isArchived = true;
        await intentionRepository.save(intention);
      }
      return created;
    });
    this.realtimeEvents.emitTasksUpdate(userId);
    return convertedLists;
  }

  async convertTaskToListItem(
    userId: string,
    taskId: string,
    listId: string,
    updates: {
      title?: string;
      dueDate?: string | null;
      priority?: TaskPriority;
      vacationEligible?: boolean;
    }
  ) {
    const [list, task] = await Promise.all([
      this.requireList(userId, listId),
      this.tasksRepository.findOne({
        where: { id: taskId, userId, itemKind: 'task' },
      }),
    ]);
    if (!task) throw new NotFoundException('Task not found');
    if (list.isArchived) throw new BadRequestException('List is archived');
    await this.assertNoRunningFocusedItem(userId, [task.id]);
    const saved = await this.dataSource.transaction(async manager => {
      if (updates.title !== undefined) {
        const title = updates.title.trim();
        if (!title)
          throw new BadRequestException('List item title is required');
        task.title = title;
      }
      if (updates.dueDate !== undefined) task.dueDate = updates.dueDate;
      if (updates.priority !== undefined) task.priority = updates.priority;
      task.vacationEligible = updates.vacationEligible ?? task.vacationEligible;
      this.prepareTaskAsListItem(task, list.id);
      return manager.getRepository(TaskEntity).save(task);
    });
    this.realtimeEvents.emitTasksUpdate(userId);
    return saved;
  }

  async convertToIntention(userId: string, listId: string) {
    const list = await this.requireList(userId, listId);
    const items = await this.tasksRepository.find({
      where: { userId, listId, itemKind: 'listItem' },
    });
    await this.assertNoRunningFocusedItem(
      userId,
      items.map(item => item.id)
    );
    let intention = list.sourceIntentionId
      ? await this.intentionsRepository.findOne({
          where: { id: list.sourceIntentionId, userId },
        })
      : null;
    if (!intention) {
      let slug = generateIntentionSlug(list.title);
      let suffix = 2;
      while (
        await this.intentionsRepository.findOne({
          where: { userId, slug, type: TIMER_TYPES.WORK },
        })
      ) {
        slug = `${generateIntentionSlug(list.title)}-${suffix++}`;
      }
      intention = this.intentionsRepository.create({
        userId,
        title: list.title,
        emoji: list.emoji || '📋',
        slug,
        type: TIMER_TYPES.WORK,
        parentIntentionId: null,
        hasCustomDuration: false,
        customDuration: null,
        keepScreenAwake: false,
        isHabit: false,
        isArchived: false,
        isFavorite: list.isFavorite,
        allowsTasks: true,
        description: list.description,
        vacationDefault: list.vacationDefault,
      });
    }
    const parentIntention = intention.parentIntentionId
      ? await this.intentionsRepository.findOne({
          where: { id: intention.parentIntentionId, userId },
        })
      : null;
    const restoreAsTopLevel =
      Boolean(intention.parentIntentionId) &&
      (!parentIntention || parentIntention.isArchived);
    if (restoreAsTopLevel) {
      intention.parentIntentionId = null;
      intention.parentIntention = null;
    }
    intention.isArchived = false;
    intention.title = list.title;
    intention.emoji = list.emoji || '📋';
    intention.isFavorite = list.isFavorite;
    intention.allowsTasks = true;
    intention.description = list.description;
    intention.vacationDefault = list.vacationDefault;
    await this.intentionsRepository.save(intention);
    for (const item of items) {
      const restore = (item.taskRestoreState ?? {}) as Partial<TaskEntity>;
      if (item.status !== TASK_STATUSES.ACTIVE) {
        restore.recurrenceRule = null;
        restore.recurrenceInterval = null;
      }
      Object.assign(item, restore, {
        itemKind: 'task' as const,
        listId: null,
        taskRestoreState: null,
        intentionSlug: restoreAsTopLevel
          ? intention.slug
          : (restore.intentionSlug ?? intention.slug),
        subIntentionSlug: restoreAsTopLevel
          ? null
          : (restore.subIntentionSlug ?? null),
      });
      await this.tasksRepository.save(item);
    }
    list.isArchived = true;
    await this.listsRepository.save(list);
    this.realtimeEvents.emitTasksUpdate(userId);
    return intention;
  }

  private async assertNoRunningFocusedItem(userId: string, itemIds: string[]) {
    const timer = await this.timerStore.getCurrentTimer(userId);
    if (timer?.focusedTaskIds?.some(id => itemIds.includes(id))) {
      throw new BadRequestException(
        'Clear focused Tasks before converting this group'
      );
    }
  }

  private prepareTaskAsListItem(task: TaskEntity, listId: string) {
    task.taskRestoreState = {
      description: task.description,
      sourceTranscript: task.sourceTranscript,
      creationSource: task.creationSource,
      importSource: task.importSource,
      importSourceTaskId: task.importSourceTaskId,
      dueTime: task.dueTime,
      timerType: task.timerType,
      pinnedAt: task.pinnedAt,
      intentionSlug: task.intentionSlug,
      subIntentionSlug: task.subIntentionSlug,
      recurrenceRule: task.recurrenceRule,
      recurrenceInterval: task.recurrenceInterval,
      recurrenceAnchorMode: task.recurrenceAnchorMode,
      followUpTaskId: task.followUpTaskId,
      followUpDelayDays: task.followUpDelayDays,
      followUpSourceTaskId: task.followUpSourceTaskId,
      lastReminderKey: task.lastReminderKey,
      recurrenceSequenceIndex: task.recurrenceSequenceIndex,
      manualOrder: task.manualOrder,
      manualOrderOverride: task.manualOrderOverride,
    };
    task.itemKind = 'listItem';
    task.listId = listId;
    task.description = null;
    task.sourceTranscript = null;
    task.dueTime = null;
    task.timerType = TIMER_TYPES.WORK;
    task.pinnedAt = null;
    task.intentionSlug = null;
    task.subIntentionSlug = null;
    task.recurrenceRule = null;
    task.recurrenceInterval = null;
    task.recurrenceSequenceIndex = 0;
    task.recurrenceAnchorMode = 'planned';
    task.followUpTaskId = null;
    task.followUpDelayDays = null;
    task.followUpSourceTaskId = null;
    task.lastReminderKey = null;
    task.manualOrder = null;
    task.manualOrderOverride = false;
  }

  private async requireList(userId: string, id: string) {
    const list = await this.listsRepository.findOne({ where: { id, userId } });
    if (!list) throw new NotFoundException('List not found');
    return list;
  }
}
