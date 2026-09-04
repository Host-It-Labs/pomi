import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimerModule } from 'src/timer/timer.module';
import { RedisModule } from '../redis/redis.module';
import { UsersModule } from '../users/users.module';
import { PreferencesController } from './preferences.controller';
import { Preferences } from './preferences.entity';
import { PreferencesService } from './preferences.service';
import { PreferencesStore } from './preferences.store';

@Module({
  imports: [
    TypeOrmModule.forFeature([Preferences]),
    RedisModule,
    forwardRef(() => TimerModule),
    UsersModule,
  ],
  controllers: [PreferencesController],
  providers: [PreferencesService, PreferencesStore],
  exports: [PreferencesService],
})
export class PreferencesModule {}
