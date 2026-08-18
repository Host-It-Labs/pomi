import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimerModule } from 'src/timer/timer.module';
import { UsersModule } from '../users/users.module';
import { PreferencesController } from './preferences.controller';
import { Preferences } from './preferences.entity';
import { PreferencesService } from './preferences.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Preferences]),
    forwardRef(() => TimerModule),
    UsersModule,
  ],
  controllers: [PreferencesController],
  providers: [PreferencesService],
  exports: [PreferencesService],
})
export class PreferencesModule {}
