import { Global, Module } from '@nestjs/common';
import { RealtimeEvents } from './realtime-events';
import { TaskListChangeFeedService } from './task-list-change-feed.service';

@Global()
@Module({
  providers: [RealtimeEvents, TaskListChangeFeedService],
  exports: [RealtimeEvents, TaskListChangeFeedService],
})
export class RealtimeModule {}
