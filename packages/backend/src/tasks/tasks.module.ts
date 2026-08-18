import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntentionsModule } from '../intentions/intentions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PreferencesModule } from '../preferences/preferences.module';
import { TimerModule } from '../timer/timer.module';
import { UsersModule } from '../users/users.module';
import { TasksController } from './tasks.controller';
import { TaskNotificationService } from './task-notification.service';
import {
  TaskEntity,
  TaskEventEntity,
  TaskImportRunEntity,
} from './tasks.entity';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TaskEntity,
      TaskEventEntity,
      TaskImportRunEntity,
    ]),
    IntentionsModule,
    NotificationsModule,
    PreferencesModule,
    TimerModule,
    UsersModule,
  ],
  controllers: [TasksController],
  providers: [TasksService, TaskNotificationService],
  exports: [TasksService],
})
export class TasksModule {}
