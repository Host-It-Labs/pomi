import { CLIENT_NOTIFICATION_TYPES, TIMER_TYPES } from '@pomi/shared';
import { IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';

export class TestNotificationDto {
  @IsIn([
    CLIENT_NOTIFICATION_TYPES.COMPLETE,
    CLIENT_NOTIFICATION_TYPES.WARNING,
    CLIENT_NOTIFICATION_TYPES.LONG_BREAK_DETECTED,
    CLIENT_NOTIFICATION_TYPES.PAUSED_TIMER_REMINDER,
  ])
  type: (typeof CLIENT_NOTIFICATION_TYPES)[keyof typeof CLIENT_NOTIFICATION_TYPES];

  @IsIn([TIMER_TYPES.WORK, TIMER_TYPES.BREAK, TIMER_TYPES.LONG_BREAK])
  timerType:
    | typeof TIMER_TYPES.WORK
    | typeof TIMER_TYPES.BREAK
    | typeof TIMER_TYPES.LONG_BREAK;

  @IsOptional()
  @IsInt()
  @Min(1)
  minutesLeft?: number;

  @IsOptional()
  @IsBoolean()
  isLastWorkTimerInSession?: boolean;
}
