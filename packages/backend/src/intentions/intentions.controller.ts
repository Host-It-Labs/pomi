import {
  Body,
  Controller,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { apiContract, TIMER_TYPES } from '@pomi/shared';
import {
  TsRestHandler,
  tsRestHandler,
} from '../validation/ts-rest-zod4.adapter';
import { AuthGuard } from '../auth/auth.guard';
import { CreateIntentionDto } from './dto/create-intention.dto';
import { IntentionsQueryDto } from './dto/intentions-query.dto';
import { ReparentIntentionDto } from './dto/reparent-intention.dto';
import { SlugParamDto } from './dto/slug.param';
import { UpdateIntentionDto } from './dto/update-intention.dto';
import { Intention } from './intentions.entity';
import { IntentionsService } from './intentions.service';

@Controller()
@UseGuards(AuthGuard)
export class IntentionsController {
  constructor(private intentionsService: IntentionsService) {}

  private formatIntention(intention: Intention) {
    return {
      ...intention,
      parentIntentionId: intention.parentIntentionId ?? null,
      parentIntention: intention.parentIntention
        ? {
            id: intention.parentIntention.id,
            title: intention.parentIntention.title,
            emoji: intention.parentIntention.emoji,
            slug: intention.parentIntention.slug,
          }
        : null,
      description: intention.description ?? null,
      vacationDefault: intention.vacationDefault ?? false,
      createdAt:
        intention.createdAt instanceof Date
          ? intention.createdAt.toISOString()
          : String(intention.createdAt),
      updatedAt:
        intention.updatedAt instanceof Date
          ? intention.updatedAt.toISOString()
          : String(intention.updatedAt),
    };
  }

  @TsRestHandler(apiContract.intentions.list)
  async getAllIntentions(@Request() req): Promise<unknown> {
    return tsRestHandler(apiContract.intentions.list, async ({ query }) => {
      const userId = req.user.sub;
      const intentions = await this.intentionsService.getAllIntentions(
        userId,
        query.type,
        query.isArchived,
        {
          includeSubIntentions: query.includeSubIntentions,
          parentSlug: query.parentSlug,
        }
      );
      return {
        status: 200,
        body: intentions.map(intention => this.formatIntention(intention)),
      };
    });
  }

  @TsRestHandler(apiContract.intentions.create)
  async createIntention(
    @Request() req,
    @Body() data: CreateIntentionDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.intentions.create, async () => {
      const userId = req.user.sub;
      const type = data.type ?? TIMER_TYPES.WORK;
      const intention = await this.intentionsService.createIntention(
        userId,
        data.title,
        data.emoji,
        type,
        data.hasCustomDuration === true,
        data.customDuration,
        data.keepScreenAwake === true,
        data.isHabit === true,
        data.parentIntentionId ?? null,
        data.isFavorite === true,
        data.description,
        data.allowsTasks !== false
      );

      return {
        status: 201,
        body: this.formatIntention(intention),
      };
    });
  }

  @TsRestHandler(apiContract.intentions.delete)
  async deleteIntention(@Request() req): Promise<unknown> {
    return tsRestHandler(
      apiContract.intentions.delete,
      async ({ params, query }) => {
        const userId = req.user.sub;
        const resolvedType = query.type ?? TIMER_TYPES.WORK;
        await this.intentionsService.deleteIntention(
          userId,
          params.slug,
          resolvedType,
          query.keepStats
        );
        return {
          status: 204,
          body: undefined,
        };
      }
    );
  }

  @TsRestHandler(apiContract.intentions.archive)
  async archiveIntention(
    @Request() req,
    @Param() params: SlugParamDto,
    @Query() query: IntentionsQueryDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.intentions.archive, async () => {
      const userId = req.user.sub;
      const resolvedType = query.type ?? TIMER_TYPES.WORK;
      const intention = await this.intentionsService.archiveIntention(
        userId,
        params.slug,
        resolvedType
      );
      return {
        status: 200,
        body: this.formatIntention(intention),
      };
    });
  }

  @TsRestHandler(apiContract.intentions.unarchive)
  async unarchiveIntention(
    @Request() req,
    @Param() params: SlugParamDto,
    @Query() query: IntentionsQueryDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.intentions.unarchive, async () => {
      const userId = req.user.sub;
      const resolvedType = query.type ?? TIMER_TYPES.WORK;
      const intention = await this.intentionsService.unarchiveIntention(
        userId,
        params.slug,
        resolvedType
      );
      return {
        status: 200,
        body: this.formatIntention(intention),
      };
    });
  }

  @TsRestHandler(apiContract.intentions.update)
  async updateIntention(
    @Request() req,
    @Body() data: UpdateIntentionDto,
    @Param() params: SlugParamDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.intentions.update, async () => {
      const userId = req.user.sub;
      const type = data.type ?? TIMER_TYPES.WORK;
      const intention = await this.intentionsService.updateIntention(
        userId,
        params.slug,
        data.title,
        data.emoji,
        type,
        data.hasCustomDuration,
        data.customDuration,
        data.keepScreenAwake,
        data.isHabit,
        data.parentIntentionId,
        data.isFavorite,
        data.description,
        data.allowsTasks
      );

      return {
        status: 200,
        body: this.formatIntention(intention),
      };
    });
  }

  @TsRestHandler(apiContract.intentions.reparent)
  async reparentIntention(
    @Request() req,
    @Body() data: ReparentIntentionDto,
    @Param() params: SlugParamDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.intentions.reparent, async () => {
      const userId = req.user.sub;
      const type = data.type ?? TIMER_TYPES.WORK;
      const intention = await this.intentionsService.reparentIntention(
        userId,
        params.slug,
        type,
        data.parentSlug
      );

      return {
        status: 200,
        body: this.formatIntention(intention),
      };
    });
  }
}
