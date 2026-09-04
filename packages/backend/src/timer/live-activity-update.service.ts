import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription } from 'rxjs';
import { PomiLogger } from '../logging/pomi-logger';
import { NotificationService } from '../notifications/notifications.service';
import { TimerEvents } from './timer-events';

@Injectable()
export class LiveActivityUpdateService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new PomiLogger(LiveActivityUpdateService.name);
  private subscription: Subscription | null = null;

  constructor(
    private readonly timerEvents: TimerEvents,
    private readonly notificationService: NotificationService
  ) {}

  onModuleInit(): void {
    this.subscription = this.timerEvents.onTimerUpdate.subscribe(
      ({ userId, timer }) => {
        void this.notificationService
          .sendLiveActivityTimerUpdate(userId, timer)
          .catch(error => {
            this.logger.error(
              `Failed to update Live Activity for user ${userId}:`,
              error
            );
          });
      }
    );
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }
}
