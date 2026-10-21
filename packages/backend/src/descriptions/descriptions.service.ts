import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  assistantDescriptionsSchema,
  MAX_DESCRIPTION_DESTINATIONS,
} from '../assistant/assistant-output-schemas';
import { AssistantService } from '../assistant/assistant.service';
import { Intention } from '../intentions/intentions.entity';
import { ListEntity } from '../lists/lists.entity';
import { TaskEntity } from '../tasks/tasks.entity';

const MAX_TASK_TITLES = 8;

@Injectable()
export class DescriptionsService {
  constructor(
    @InjectRepository(Intention)
    private readonly intentions: Repository<Intention>,
    @InjectRepository(ListEntity)
    private readonly lists: Repository<ListEntity>,
    @InjectRepository(TaskEntity)
    private readonly tasks: Repository<TaskEntity>,
    private readonly assistantService: AssistantService
  ) {}

  async generate(userId: string) {
    const context = await this.assistantService.prepareRequest(
      userId,
      'descriptionGeneration'
    );
    if (!context.preferences.destinationDescriptionsEnabled) {
      throw new BadRequestException('Destination descriptions are not enabled');
    }
    const [intentions, lists, tasks] = await Promise.all([
      this.intentions.find({
        where: { userId, isArchived: false },
        relations: { parentIntention: true },
        order: { title: 'ASC' },
      }),
      this.lists.find({
        where: { userId, isArchived: false },
        order: { title: 'ASC' },
      }),
      this.tasks.find({
        where: { userId, status: 'active' },
        order: { updatedAt: 'DESC' },
      }),
    ]);
    const destinations = [
      ...intentions
        .filter(intention =>
          intention.parentIntention
            ? intention.parentIntention.allowsTasks
            : intention.allowsTasks
        )
        .map(intention => ({
          kind: 'intention' as const,
          id: intention.slug,
          title: intention.title,
          titles: tasks
            .filter(
              task =>
                (task.itemKind === 'task' || task.itemKind === 'followUp') &&
                task.intentionSlug === intention.slug
            )
            .slice(0, MAX_TASK_TITLES)
            .map(task => task.title.slice(0, 120)),
        })),
      ...lists.map(list => ({
        kind: 'list' as const,
        id: list.id,
        title: list.title,
        titles: tasks
          .filter(
            task => task.itemKind === 'listItem' && task.listId === list.id
          )
          .slice(0, MAX_TASK_TITLES)
          .map(task => task.title.slice(0, 120)),
      })),
    ].slice(0, MAX_DESCRIPTION_DESTINATIONS);
    if (!destinations.length) return { drafts: [], costUsd: 0 };
    const response = await this.assistantService.requestObject(
      userId,
      context.settings.textModel,
      [
        {
          role: 'system',
          content:
            'Write one concise plain-language description per destination. Use at most 18 words. Explain what belongs there. Return JSON only, matching the supplied schema.',
        },
        { role: 'user', content: JSON.stringify(destinations) },
      ],
      {
        schema: assistantDescriptionsSchema,
        schemaName: 'destinationDescriptions',
        debugStage: 'initial',
        language: context.preferences.language,
      },
      context.today
    );
    const rows = response.object.descriptions;
    const drafts = destinations
      .map(destination => {
        const match = rows.find(
          row => row.kind === destination.kind && row.id === destination.id
        );
        return {
          kind: destination.kind,
          id: destination.id,
          title: destination.title,
          description: match?.description.trim().slice(0, 240) ?? '',
        };
      })
      .filter(draft => draft.description);
    return { drafts, costUsd: response.costUsd };
  }
}
