import {
  ConflictException,
  Inject,
  Injectable,
  forwardRef,
} from '@nestjs/common';
import { TIMER_STATUSES, TIMER_TYPES, Timer } from '@pomi/shared';
import { PreferencesService } from '../preferences/preferences.service';
import { TimerEvents } from './timer-events';
import { TimerSessionState, TimerStore, timerVersion } from './timer-store';

@Injectable()
export class TimerSessionService {
  constructor(
    @Inject(forwardRef(() => PreferencesService))
    private preferencesService: PreferencesService,
    private timerStore: TimerStore,
    private timerEvents: TimerEvents
  ) {}

  async applySessionToCurrentTimer(userId: string): Promise<Timer | null> {
    const timer = await this.timerStore.getCurrentTimer(userId);
    if (!timer) {
      return null;
    }

    if (
      timer.type !== TIMER_TYPES.WORK ||
      (timer.sessionPosition && timer.sessionTotal)
    ) {
      return timer;
    }

    const preferences = await this.preferencesService.getPreferences(userId);
    const expected = timerVersion(timer);

    timer.sessionPosition = 1;
    timer.sessionTotal = preferences.sessionPomodorosCount;
    timer.sessionIntentionEmojis = undefined;

    const write = await this.timerStore.replaceCurrentTimer(
      userId,
      expected,
      timer,
      {
        sessionState: {
          currentPosition: 1,
          totalPomodoros: preferences.sessionPomodorosCount,
        },
      }
    );
    if (write.kind === 'conflict') return write.current;
    this.timerEvents.emitTimerUpdate(userId, write.timer);

    return write.timer;
  }

  async updateSessionTotal(userId: string): Promise<Timer | null> {
    const timer = await this.timerStore.getCurrentTimer(userId);
    if (!timer) {
      return null;
    }

    const preferences = await this.preferencesService.getPreferences(userId);

    if (!timer.sessionPosition || !timer.sessionTotal) {
      if (timer.type === TIMER_TYPES.WORK) {
        const expected = timerVersion(timer);
        timer.sessionPosition = 1;
        timer.sessionTotal = preferences.sessionPomodorosCount;
        timer.sessionIntentionEmojis = undefined;
        const write = await this.timerStore.replaceCurrentTimer(
          userId,
          expected,
          timer,
          {
            sessionState: {
              currentPosition: 1,
              totalPomodoros: preferences.sessionPomodorosCount,
            },
          }
        );
        if (write.kind === 'conflict') return write.current;
        this.timerEvents.emitTimerUpdate(userId, write.timer);
        return write.timer;
      }
      return timer;
    }

    const sessionState = await this.timerStore.getSessionState(userId);
    if (!sessionState) {
      return timer;
    }

    const expected = timerVersion(timer);
    timer.sessionTotal = preferences.sessionPomodorosCount;
    timer.sessionIntentionEmojis = sessionState.completedIntentionEmojis;
    sessionState.totalPomodoros = preferences.sessionPomodorosCount;

    if (timer.sessionPosition > preferences.sessionPomodorosCount) {
      timer.sessionPosition = preferences.sessionPomodorosCount;
      sessionState.currentPosition = preferences.sessionPomodorosCount;
    }

    const write = await this.timerStore.replaceCurrentTimer(
      userId,
      expected,
      timer,
      { sessionState }
    );
    if (write.kind === 'conflict') return write.current;
    this.timerEvents.emitTimerUpdate(userId, write.timer);

    return write.timer;
  }

  async setSessionPosition(
    userId: string,
    position: number
  ): Promise<Timer | null> {
    const timer = await this.timerStore.getCurrentTimer(userId);
    if (!timer) {
      return null;
    }

    if (!timer.sessionTotal || position < 1 || position > timer.sessionTotal) {
      return timer;
    }

    const expected = timerVersion(timer);
    if (timer.status === TIMER_STATUSES.RUNNING) {
      timer.remainingTime = Math.max(
        0,
        timer.duration - (Date.now() - timer.startTime)
      );
    }

    const sessionState = await this.timerStore.getSessionState(userId);
    timer.sessionPosition = position;
    timer.sessionIntentionEmojis = sessionState?.completedIntentionEmojis;

    const updatedState: TimerSessionState | undefined = sessionState
      ? {
          ...sessionState,
          currentPosition: position,
        }
      : undefined;
    const write = await this.timerStore.replaceCurrentTimer(
      userId,
      expected,
      timer,
      updatedState ? { sessionState: updatedState } : undefined
    );
    if (write.kind === 'conflict') {
      throw new ConflictException('Timer changed while action was processing');
    }

    this.timerEvents.emitTimerUpdate(userId, write.timer);

    return write.timer;
  }
}
