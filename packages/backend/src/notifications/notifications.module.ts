import { Module, forwardRef } from '@nestjs/common';
import { PreferencesModule } from '../preferences/preferences.module';
import { UsersModule } from 'src/users/users.module';
import { NotificationsController } from './notifications.controller';
import { NotificationService } from './notifications.service';

@Module({
  imports: [UsersModule, forwardRef(() => PreferencesModule)],
  providers: [NotificationService],
  exports: [NotificationService],
  controllers: [NotificationsController],
})
export class NotificationsModule {}
