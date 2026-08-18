import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntentionsModule } from 'src/intentions/intentions.module';
import { UsersModule } from '../users/users.module';
import { StatisticsController } from './statistics.controller';
import { Statistic } from './statistics.entity';
import { StatisticsService } from './statistics.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Statistic]),
    forwardRef(() => IntentionsModule),
    UsersModule,
  ],
  controllers: [StatisticsController],
  providers: [StatisticsService],
  exports: [StatisticsService],
})
export class StatisticsModule {}
