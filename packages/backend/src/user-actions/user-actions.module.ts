import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module';
import { IntentionsModule } from '../intentions/intentions.module';
import { FeedbackModule } from '../feedback/feedback.module';
import { ListsModule } from '../lists/lists.module';
import { VacationModule } from '../vacation/vacation.module';
import { PreferencesModule } from '../preferences/preferences.module';
import { RedisModule } from '../redis/redis.module';
import { StatisticsModule } from '../statistics/statistics.module';
import { SystemModule } from '../system/system.module';
import { TasksModule } from '../tasks/tasks.module';
import { TimerModule } from '../timer/timer.module';
import { UsersModule } from '../users/users.module';
import { UserActionsController } from './user-actions.controller';
import { UserActionsService } from './user-actions.service';
import { UserActionsStore } from './user-actions.store';

@Module({
  imports: [
    RedisModule,
    TimerModule,
    TasksModule,
    IntentionsModule,
    PreferencesModule,
    StatisticsModule,
    AssistantModule,
    SystemModule,
    UsersModule,
    FeedbackModule,
    ListsModule,
    VacationModule,
  ],
  controllers: [UserActionsController],
  providers: [UserActionsService, UserActionsStore],
  exports: [UserActionsService, UserActionsStore],
})
export class UserActionsModule {}
