import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { AssistantModule } from './assistant/assistant.module';
import { DatabaseModule } from './database/database.module';
import { IntentionsModule } from './intentions/intentions.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PreferencesModule } from './preferences/preferences.module';
import { RealtimeModule } from './realtime/realtime.module';
import { StatisticsModule } from './statistics/statistics.module';
import { SystemModule } from './system/system.module';
import { TasksModule } from './tasks/tasks.module';
import { TimerModule } from './timer/timer.module';
import { UsersModule } from './users/users.module';
import { WatchModule } from './watch/watch.module';
import { UserActionsModule } from './user-actions/user-actions.module';
import { ListsModule } from './lists/lists.module';
import { VacationModule } from './vacation/vacation.module';
import { FeedbackModule } from './feedback/feedback.module';
import { DescriptionsModule } from './descriptions/descriptions.module';
import { validateEnvironment } from './config/environment';
import { resolveBackendLocalEnvironmentFile } from './config/local-environment';
import { BillingModule } from './billing/billing.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolveBackendLocalEnvironmentFile(),
      validate: validateEnvironment,
    }),
    DatabaseModule,
    RealtimeModule,
    TimerModule,
    UsersModule,
    AuthModule,
    PreferencesModule,
    NotificationsModule,
    StatisticsModule,
    IntentionsModule,
    TasksModule,
    AssistantModule,
    WatchModule,
    UserActionsModule,
    ListsModule,
    VacationModule,
    FeedbackModule,
    DescriptionsModule,
    SystemModule,
    BillingModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
  ],
})
export class AppModule {}
