import { Global, Module } from '@nestjs/common';
import { RealtimeEvents } from './realtime-events';

@Global()
@Module({
  providers: [RealtimeEvents],
  exports: [RealtimeEvents],
})
export class RealtimeModule {}
