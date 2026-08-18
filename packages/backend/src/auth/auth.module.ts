import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PreferencesModule } from 'src/preferences/preferences.module';
import { SystemModule } from 'src/system/system.module';
import { TimerModule } from 'src/timer/timer.module';
import { UsersModule } from '../users/users.module';
import { AdminGuard } from './admin.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DebugGuard } from './debug.guard';

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
  ],
  providers: [AuthService, AdminGuard, DebugGuard],
  controllers: [AuthController],
  exports: [AuthService, AdminGuard, DebugGuard],
})
export class AuthModule {}
