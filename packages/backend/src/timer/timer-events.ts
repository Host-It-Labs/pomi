import { Injectable } from '@nestjs/common';
import {
  ClientNotificationType,
  NotificationGroup,
  Timer,
  TimerExtensionState,
} from '@pomi/shared';
import { Subject } from 'rxjs';

export type TimerHistoryAppliedAction = {
  direction: 'undo' | 'redo';
  label: string;
  logEffect?: 'added' | 'removed' | 'restored' | 'updated';
};

export interface ClientNotificationEvent {
  userId: string;
  type: ClientNotificationType;
  timer: Timer;
  timestamp: number;
  isLastWorkTimerInSession?: boolean;
  minutesLeft?: number;
  notificationTitle?: string;
  notificationBody?: string;
  notificationPriority?: number;
  notificationTags?: string[];
  notificationGroup?: NotificationGroup;
  task?: {
    id: string;
    title: string;
    dueDate: string | null;
    dueTime: string | null;
    priority: string;
  };
}

@Injectable()
export class TimerEvents {
  readonly onTimerUpdate = new Subject<{ userId: string; timer: Timer }>();
  readonly onClientNotification = new Subject<ClientNotificationEvent>();
  readonly onExtensionStateUpdate = new Subject<{
    userId: string;
    extensionState: TimerExtensionState | null;
  }>();
  readonly onTimerHistoryUpdate = new Subject<{
    userId: string;
    canUndo: boolean;
    canRedo: boolean;
    appliedAction?: TimerHistoryAppliedAction;
  }>();

  emitTimerUpdate(userId: string, timer: Timer) {
    this.onTimerUpdate.next({ userId, timer });
  }

  emitClientNotification(event: ClientNotificationEvent) {
    this.onClientNotification.next(event);
  }

  emitExtensionStateUpdate(
    userId: string,
    extensionState: TimerExtensionState | null
  ) {
    this.onExtensionStateUpdate.next({ userId, extensionState });
  }

  emitTimerHistoryUpdate(
    userId: string,
    status: { canUndo: boolean; canRedo: boolean },
    appliedAction?: TimerHistoryAppliedAction
  ) {
    this.onTimerHistoryUpdate.next({ userId, ...status, appliedAction });
  }
}
