import {
  Body,
  Controller,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { apiContract } from '@pomi/shared';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { AuthGuard } from '../auth/auth.guard';
import { CreateUserActionDto } from './dto/create-user-action.dto';
import { UserActionIdParam } from './dto/user-action-id.param';
import { UserActionStatusQuery } from './dto/user-action-status.query';
import { UserActionsService } from './user-actions.service';

@Controller()
@UseGuards(AuthGuard)
export class UserActionsController {
  constructor(private readonly userActionsService: UserActionsService) {}

  @TsRestHandler(apiContract.userActions.submit)
  async submit(
    @Request() request: { user: { sub: string } },
    @Body() body: CreateUserActionDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.userActions.submit, async () => ({
      status: 202,
      body: await this.userActionsService.submit(
        request.user.sub,
        body.actionId,
        body.action
      ),
    }));
  }

  @TsRestHandler(apiContract.userActions.status)
  async getStatus(
    @Request() request: { user: { sub: string } },
    @Param() params: UserActionIdParam,
    @Query() query: UserActionStatusQuery
  ): Promise<unknown> {
    return tsRestHandler(apiContract.userActions.status, async () => ({
      status: 200,
      body: await this.userActionsService.getStatus(
        request.user.sub,
        params.id,
        query.waitMs
      ),
    }));
  }

  @TsRestHandler(apiContract.userActions.cancel)
  async cancel(
    @Request() request: { user: { sub: string } },
    @Param() params: UserActionIdParam
  ): Promise<unknown> {
    return tsRestHandler(apiContract.userActions.cancel, async () => ({
      status: 200,
      body: await this.userActionsService.cancel(request.user.sub, params.id),
    }));
  }
}
