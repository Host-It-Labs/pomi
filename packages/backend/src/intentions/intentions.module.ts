import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StatisticsModule } from '../statistics/statistics.module';
import { TaskEntity } from '../tasks/tasks.entity';
import { IntentionsController } from './intentions.controller';
import { Intention } from './intentions.entity';
import { IntentionsService } from './intentions.service';
import { RedisModule } from '../redis/redis.module';
import { TimerStore } from '../timer/timer-store';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Intention, TaskEntity]),
    forwardRef(() => StatisticsModule),
    RedisModule,
    UsersModule,
  ],
  controllers: [IntentionsController],
  providers: [IntentionsService, TimerStore],
  exports: [IntentionsService],
})
export class IntentionsModule {}
