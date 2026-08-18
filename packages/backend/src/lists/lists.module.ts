import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RealtimeModule } from '../realtime/realtime.module';
import { Intention } from '../intentions/intentions.entity';
import { TimerModule } from '../timer/timer.module';
import { TaskEntity } from '../tasks/tasks.entity';
import { UsersModule } from '../users/users.module';
import { ListEntity } from './lists.entity';
import { ListsController } from './lists.controller';
import { ListsService } from './lists.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ListEntity, TaskEntity, Intention]),
    RealtimeModule,
    TimerModule,
    UsersModule,
  ],
  controllers: [ListsController],
  providers: [ListsService],
  exports: [ListsService],
})
export class ListsModule {}
