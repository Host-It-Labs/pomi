import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthSessionEntity } from './auth-session.entity';
import { SessionService } from './session.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuthSessionEntity])],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionsModule {}
