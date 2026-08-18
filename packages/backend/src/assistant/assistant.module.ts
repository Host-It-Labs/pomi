import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminGuard } from '../auth/admin.guard';
import { DebugGuard } from '../auth/debug.guard';
import { IntentionsModule } from '../intentions/intentions.module';
import { ListsModule } from '../lists/lists.module';
import { PreferencesModule } from '../preferences/preferences.module';
import { RedisModule } from '../redis/redis.module';
import { TasksModule } from '../tasks/tasks.module';
import { TimerModule } from '../timer/timer.module';
import { UsersModule } from '../users/users.module';
import {
  AssistantDebugLogEntity,
  AssistantDebugSettingEntity,
} from './assistant-debug.entity';
import { AssistantDebugService } from './assistant-debug.service';
import { AssistantSettingsEntity } from './assistant-settings.entity';
import { AssistantUsageEntity } from './assistant-usage.entity';
import { AssistantController } from './assistant.controller';
import { AssistantCaptureService } from './assistant-capture.service';
import { AssistantService } from './assistant.service';
import { AssistantPreparationStore } from './assistant-task-preparation.store';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AssistantSettingsEntity,
      AssistantUsageEntity,
      AssistantDebugSettingEntity,
      AssistantDebugLogEntity,
    ]),
    UsersModule,
    PreferencesModule,
    TasksModule,
    forwardRef(() => TimerModule),
    IntentionsModule,
    ListsModule,
    RedisModule,
  ],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    AssistantCaptureService,
    AssistantDebugService,
    AssistantPreparationStore,
    AdminGuard,
    DebugGuard,
  ],
  exports: [AssistantService, AssistantCaptureService, AssistantDebugService],
})
export class AssistantModule {}
