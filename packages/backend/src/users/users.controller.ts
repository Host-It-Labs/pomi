import {
  Body,
  Controller,
  ForbiddenException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { apiContract } from '@pomi/shared';
import {
  TsRestHandler,
  tsRestHandler,
} from '../validation/ts-rest-zod4.adapter';
import { AuthGuard } from '../auth/auth.guard';
import { UpdatePushTokenDto } from './dto/update-push-token.dto';
import { UserIdParamDto } from './dto/user-id.param';
import { UsernameParamDto } from './dto/username.param';
import { User as UserDecorator } from './users.decorator';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(private usersService: UsersService) {}

  @UseGuards(AuthGuard)
  @TsRestHandler(apiContract.users.byUsername)
  async getUserByUsername(@Param() params: UsernameParamDto): Promise<unknown> {
    return tsRestHandler(apiContract.users.byUsername, async () => {
      const normalized = params.username.toLowerCase();
      const user = await this.usersService.findUserByUsername(normalized);
      if (!user) {
        return { status: 200, body: null };
      }

      const { id, username, createdAt, isAdmin } = user;
      const safeUser = {
        id,
        username,
        createdAt: createdAt.toISOString(),
        isAdmin,
      };

      return { status: 200, body: safeUser };
    });
  }

  @UseGuards(AuthGuard)
  @TsRestHandler(apiContract.users.timers)
  async getUserTimers(
    @UserDecorator('sub') authenticatedUserId: string,
    @Param() params: UserIdParamDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.users.timers, async () => {
      this.assertOwnUser(authenticatedUserId, params.userId);
      const timers = await this.usersService.getUserTimers(params.userId);
      return { status: 200, body: timers };
    });
  }

  @UseGuards(AuthGuard)
  @TsRestHandler(apiContract.users.updatePushToken)
  async updatePushToken(
    @UserDecorator('sub') authenticatedUserId: string,
    @Param() params: UserIdParamDto,
    @Body() body: UpdatePushTokenDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.users.updatePushToken, async () => {
      this.assertOwnUser(authenticatedUserId, params.userId);
      await this.usersService.updatePushToken(
        params.userId,
        body.token,
        body.platform
      );
      return { status: 200, body: { success: true } };
    });
  }

  @UseGuards(AuthGuard)
  @TsRestHandler(apiContract.users.getPushToken)
  async checkPushToken(
    @UserDecorator('sub') authenticatedUserId: string,
    @Param() params: UserIdParamDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.users.getPushToken, async () => {
      this.assertOwnUser(authenticatedUserId, params.userId);
      const hasToken = await this.usersService.hasPushToken(params.userId);
      return { status: 200, body: { hasToken } };
    });
  }

  private assertOwnUser(
    authenticatedUserId: string,
    requestedUserId: string
  ): void {
    if (authenticatedUserId !== requestedUserId) {
      throw new ForbiddenException('Cannot access another user');
    }
  }
}
