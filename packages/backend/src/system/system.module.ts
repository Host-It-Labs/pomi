import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AdminGuard } from '../auth/admin.guard';
import { DebugGuard } from '../auth/debug.guard';
import { PreferencesModule } from '../preferences/preferences.module';
import { TimerModule } from '../timer/timer.module';
import { SelfHostedGuard } from './self-hosted.guard';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';
import { UserDataTransferService } from './user-data-transfer.service';

@Module({
  imports: [UsersModule, TimerModule, PreferencesModule],
  providers: [
    SystemService,
    UserDataTransferService,
    SelfHostedGuard,
    AdminGuard,
    DebugGuard,
  ],
  controllers: [SystemController],
  exports: [SystemService, SelfHostedGuard, UserDataTransferService],
})
export class SystemModule {}
