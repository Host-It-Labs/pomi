import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

const DATABASE_RETRY_ATTEMPTS = 10;
const DATABASE_RETRY_DELAY_MS = 3_000;

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres' as const,
        url: configService.getOrThrow<string>('DATABASE_URL'),
        retryAttempts: DATABASE_RETRY_ATTEMPTS,
        retryDelay: DATABASE_RETRY_DELAY_MS,
        entities: [__dirname + '/../**/*.entity{.ts,.js}'],
        migrations: [__dirname + '/../migrations/*{.ts,.js}'],
        synchronize: false,
        logging:
          configService.get<string>('NODE_ENV') !== 'production'
            ? ['error', 'warn']
            : false,
      }),
    }),
  ],
})
export class DatabaseModule {}
