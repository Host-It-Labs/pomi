import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssistantModule } from '../assistant/assistant.module';
import { Intention } from '../intentions/intentions.entity';
import { ListEntity } from '../lists/lists.entity';
import { TaskEntity } from '../tasks/tasks.entity';
import { UsersModule } from '../users/users.module';
import { DescriptionsController } from './descriptions.controller';
import { DescriptionsService } from './descriptions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Intention, ListEntity, TaskEntity]),
    AssistantModule,
    UsersModule,
  ],
  controllers: [DescriptionsController],
  providers: [DescriptionsService],
})
export class DescriptionsModule {}
