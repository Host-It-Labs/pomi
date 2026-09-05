import {
  Body,
  Controller,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { apiContract } from '@pomi/shared';
import {
  TsRestHandler,
  tsRestHandler,
} from '../validation/ts-rest-zod4.adapter';
import { AuthGuard } from '../auth/auth.guard';
import { ListsService } from './lists.service';
import {
  CreateListDto,
  CreateListItemDto,
  ListIdDto,
  ListItemsQueryDto,
  ListsQueryDto,
  UpdateListDto,
  UpdateListItemDto,
} from './lists.dto';

@Controller()
@UseGuards(AuthGuard)
export class ListsController {
  constructor(private readonly listsService: ListsService) {}

  @TsRestHandler(apiContract.lists.list)
  list(@Request() request, @Query() query: ListsQueryDto): unknown {
    return tsRestHandler(apiContract.lists.list, async () => ({
      status: 200,
      body: (
        await this.listsService.list(
          request.user.sub,
          query.includeArchived === true
        )
      ).map(list => this.formatList(list)),
    }));
  }

  @TsRestHandler(apiContract.lists.items)
  items(@Request() request, @Query() query: ListItemsQueryDto): unknown {
    return tsRestHandler(apiContract.lists.items, async () => ({
      status: 200,
      body: (
        await this.listsService.listItems(
          request.user.sub,
          query.listId,
          query.status
        )
      ).map(item => this.formatItem(item)),
    }));
  }

  @TsRestHandler(apiContract.lists.create)
  create(@Request() request, @Body() body: CreateListDto): unknown {
    return tsRestHandler(apiContract.lists.create, async () => ({
      status: 201,
      body: this.formatList(
        await this.listsService.create(request.user.sub, body)
      ),
    }));
  }

  @TsRestHandler(apiContract.lists.update)
  update(
    @Request() request,
    @Param() params: ListIdDto,
    @Body() body: UpdateListDto
  ): unknown {
    return tsRestHandler(apiContract.lists.update, async () => ({
      status: 200,
      body: this.formatList(
        await this.listsService.update(request.user.sub, params.id, body)
      ),
    }));
  }

  @TsRestHandler(apiContract.lists.createItem)
  createItem(
    @Request() request,
    @Param() params: ListIdDto,
    @Body() body: CreateListItemDto
  ): unknown {
    return tsRestHandler(apiContract.lists.createItem, async () => ({
      status: 201,
      body: this.formatItem(
        await this.listsService.createItem(request.user.sub, params.id, body)
      ),
    }));
  }

  @TsRestHandler(apiContract.lists.updateItem)
  updateItem(
    @Request() request,
    @Param() params: ListIdDto,
    @Body() body: UpdateListItemDto
  ): unknown {
    return tsRestHandler(apiContract.lists.updateItem, async () => ({
      status: 200,
      body: this.formatItem(
        await this.listsService.updateItem(request.user.sub, params.id, body)
      ),
    }));
  }

  private formatList(list: Awaited<ReturnType<ListsService['create']>>) {
    return {
      id: list.id,
      userId: list.userId,
      title: list.title,
      emoji: list.emoji,
      description: list.description,
      vacationDefault: list.vacationDefault,
      isArchived: list.isArchived,
      isFavorite: list.isFavorite,
      sourceIntentionId: list.sourceIntentionId,
      createdAt: list.createdAt.toISOString(),
      updatedAt: list.updatedAt.toISOString(),
    };
  }

  private formatItem(item: Awaited<ReturnType<ListsService['createItem']>>) {
    return {
      id: item.id,
      userId: item.userId,
      listId: item.listId!,
      title: item.title,
      dueDate: item.dueDate,
      priority: item.priority,
      status: item.status,
      itemKind: 'listItem' as const,
      vacationEligible: item.vacationEligible,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }
}
