import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module';
import { UsersModule } from '../users/users.module';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { GitHubAppTokenService } from './github-app-token.service';

@Module({
  imports: [AssistantModule, UsersModule],
  controllers: [FeedbackController],
  providers: [FeedbackService, GitHubAppTokenService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
