import { Controller } from '@nestjs/common';
import { apiContract } from '@pomi/shared';
import {
  TsRestHandler,
  tsRestHandler,
} from '../validation/ts-rest-zod4.adapter';
import { NotificationService } from './notifications.service';

@Controller()
export class NotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  @TsRestHandler(apiContract.notifications.provider)
  async getConfiguredNotificationProvider(): Promise<unknown> {
    return tsRestHandler(apiContract.notifications.provider, async () => {
      return {
        status: 200,
        body: {
          arePushNotificationsEnabled:
            this.notificationService.arePushNotificationsEnabled(),
        },
      };
    });
  }
}
