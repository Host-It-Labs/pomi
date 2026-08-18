import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Intention } from '../intentions/intentions.entity';
import { ListEntity } from '../lists/lists.entity';
import { PreferencesModule } from '../preferences/preferences.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TaskEntity } from '../tasks/tasks.entity';
import { UsersModule } from '../users/users.module';
import { VacationController } from './vacation.controller';
import { VacationEntity } from './vacation.entity';
import { VacationService } from './vacation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      VacationEntity,
      TaskEntity,
      Intention,
      ListEntity,
    ]),
    PreferencesModule,
    RealtimeModule,
    UsersModule,
  ],
  controllers: [VacationController],
  providers: [VacationService],
  exports: [VacationService],
})
export class VacationModule {}
