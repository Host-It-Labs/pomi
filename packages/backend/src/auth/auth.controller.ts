import {
  Body,
  Controller,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { apiContract } from '@pomi/shared';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { Request } from 'express';
import { UsersService } from '../users/users.service';
import { TimerService } from '../timer/timer.service';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { AuthenticateDto } from './dto/authenticate.dto';
import { LogoutDto } from './dto/logout.dto';

@Controller()
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
    private timerService: TimerService
  ) {}

  @TsRestHandler(apiContract.sessions.create)
  async authenticate(@Body() body: AuthenticateDto): Promise<unknown> {
    return tsRestHandler(apiContract.sessions.create, async () => {
      const result = await this.authService.authenticateUser(
        body.username,
        body.password,
        body.language
      );
      const createdAt = result.user.createdAt;
      const user = {
        ...result.user,
        createdAt:
          createdAt instanceof Date
            ? createdAt.toISOString()
            : String(createdAt),
      };

      return {
        status: 200,
        body: {
          ...result,
          user,
        },
      };
    });
  }

  @UseGuards(AuthGuard)
  @TsRestHandler(apiContract.sessions.deleteCurrent)
  async logout(
    @Req() request: Request,
    @Query() query: LogoutDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.sessions.deleteCurrent, async () => {
      const userId = request['user']?.sub;
      if (!userId) {
        throw new UnauthorizedException();
      }

      if (query.platform === 'android' || query.platform === 'ios') {
        await this.usersService.clearPushToken(userId, query.platform);
      }
      await this.timerService.clearTimerHistory(userId);

      return {
        status: 200,
        body: { success: true },
      };
    });
  }
}
