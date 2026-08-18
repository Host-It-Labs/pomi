import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AssistantModule } from '../assistant/assistant.module';
import { IntentionsModule } from '../intentions/intentions.module';
import { PreferencesModule } from '../preferences/preferences.module';
import { TasksModule } from '../tasks/tasks.module';
import { TimerModule } from '../timer/timer.module';
import { WatchController } from './watch.controller';
import { WatchService } from './watch.service';

@Module({
  imports: [
    TimerModule,
    TasksModule,
    AssistantModule,
    PreferencesModule,
    IntentionsModule,
    UsersModule,
  ],
  controllers: [WatchController],
  providers: [WatchService],
})
export class WatchModule {}
