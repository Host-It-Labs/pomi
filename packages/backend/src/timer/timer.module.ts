import { Module, forwardRef } from '@nestjs/common';
import { UsersModule } from '../users/users.module';

import { IntentionsModule } from 'src/intentions/intentions.module';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { PreferencesModule } from 'src/preferences/preferences.module';
import { RedisModule } from 'src/redis/redis.module';
import { StatisticsModule } from 'src/statistics/statistics.module';
import { DebugGuard } from '../auth/debug.guard';
import { SessionsModule } from '../auth/sessions.module';
import { TimerCountdownService } from './timer-countdown.service';
import { TimerCompletionEffectsService } from './timer-completion-effects.service';
import { TimerCompletionOutboxService } from './timer-completion-outbox.service';
import { TimerCompletionNotificationWorkerService } from './timer-completion-notification-worker.service';
import { TimerCompletionSchedulerService } from './timer-completion-scheduler.service';
import { TimerCompletionStreamService } from './timer-completion-stream.service';
import { TimerContinuationWorkerService } from './timer-continuation-worker.service';
import { TimerEvents } from './timer-events';
import { TimerIdleService } from './timer-idle.service';
import { TimerIdleDetectionStreamService } from './timer-idle-detection-stream.service';
import { TimerNotificationService } from './timer-notification.service';
import { TimerSessionService } from './timer-session.service';
import { TimerStore } from './timer-store';
import { TimerController } from './timer.controller';
import { TimerGateway } from './timer.gateway';
import { TimerService } from './timer.service';
import { LiveActivityUpdateService } from './live-activity-update.service';

@Module({
  imports: [
    UsersModule,
    RedisModule,
    forwardRef(() => PreferencesModule),
    StatisticsModule,
    forwardRef(() => NotificationsModule),
    IntentionsModule,
    SessionsModule,
  ],
  providers: [
    TimerService,
    TimerGateway,
    TimerEvents,
    TimerStore,
    TimerSessionService,
    TimerCountdownService,
    TimerCompletionEffectsService,
    TimerCompletionNotificationWorkerService,
    TimerCompletionOutboxService,
    TimerCompletionSchedulerService,
    TimerCompletionStreamService,
    TimerContinuationWorkerService,
    TimerIdleDetectionStreamService,
    TimerIdleService,
    TimerNotificationService,
    LiveActivityUpdateService,
    DebugGuard,
  ],
  controllers: [TimerController],
  exports: [TimerService, TimerStore],
})
export class TimerModule {}
