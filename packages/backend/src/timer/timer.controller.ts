import {
  BadRequestException,
  Body,
  Controller,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  apiContract,
  CLIENT_NOTIFICATION_TYPES,
  TIMER_TYPES,
} from '@pomi/shared';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { Request as ExpressRequest } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { DebugGuard } from '../auth/debug.guard';
import { TestNotificationDto } from './dto/test-notification.dto';
import { TestNotificationRequest } from './timer-notification.service';
import { TimerService } from './timer.service';

@Controller()
export class TimerController {
  constructor(private readonly timerService: TimerService) {}

  @UseGuards(AuthGuard, DebugGuard)
  @TsRestHandler(apiContract.notifications.test)
  async sendTestNotification(
    @Request() request: ExpressRequest,
    @Body() body: TestNotificationDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.notifications.test, async () => {
      const userId = request['user']?.sub as string | undefined;

      if (!userId) {
        throw new BadRequestException('Missing user context');
      }

      if (
        (body.type === CLIENT_NOTIFICATION_TYPES.WARNING ||
          body.type === CLIENT_NOTIFICATION_TYPES.PAUSED_TIMER_REMINDER) &&
        body.timerType !== TIMER_TYPES.WORK
      ) {
        throw new BadRequestException(
          'Warning and paused reminder notifications require a work timer'
        );
      }

      const minutesLeft =
        typeof body.minutesLeft === 'number' && body.minutesLeft > 0
          ? body.minutesLeft
          : undefined;

      const payload: TestNotificationRequest = {
        userId,
        type: body.type,
        timerType: body.timerType,
        minutesLeft,
        isLastWorkTimerInSession: body.isLastWorkTimerInSession === true,
      };

      await this.timerService.sendTestNotification(payload);

      return {
        status: 200,
        body: { success: true },
      };
    });
  }
}
