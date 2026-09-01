import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription } from 'rxjs';
import { NotificationService } from '../notifications/notifications.service';
import { TimerEvents } from './timer-events';

@Injectable()
export class LiveActivityUpdateService
  implements OnModuleInit, OnModuleDestroy
{
  private subscription: Subscription | null = null;

  constructor(
    private readonly timerEvents: TimerEvents,
    private readonly notificationService: NotificationService
  ) {}

  onModuleInit(): void {
    this.subscription = this.timerEvents.onTimerUpdate.subscribe(
      ({ userId, timer }) => {
        void this.notificationService.sendLiveActivityTimerUpdate(
          userId,
          timer
        );
      }
    );
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }
}
