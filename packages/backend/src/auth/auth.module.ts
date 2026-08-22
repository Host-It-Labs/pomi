import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PreferencesModule } from 'src/preferences/preferences.module';
import { SystemModule } from 'src/system/system.module';
import { TimerModule } from 'src/timer/timer.module';
import { UsersModule } from '../users/users.module';
import { AdminGuard } from './admin.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DebugGuard } from './debug.guard';
import { RedisModule } from '../redis/redis.module';
import { SocialIdentityEntity } from './social-identity.entity';
import { SocialIdentityService } from './social-identity.service';
import { SocialTokenService } from './social-token.service';
import { SocialChallengeStore } from './social-challenge.store';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '90d' },
      }),
    }),
    PreferencesModule,
    SystemModule,
    TimerModule,
    RedisModule,
    TypeOrmModule.forFeature([SocialIdentityEntity]),
  ],
  providers: [
    AuthService,
    AdminGuard,
    DebugGuard,
    SocialIdentityService,
    SocialChallengeStore,
    SocialTokenService,
  ],
  controllers: [AuthController],
  exports: [AuthService, AdminGuard, DebugGuard, SocialTokenService],
})
export class AuthModule {}
