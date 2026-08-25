import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'path';

const DATABASE_RETRY_ATTEMPTS = 10;
const DATABASE_RETRY_DELAY_MS = 3_000;

export const createDatabaseOptions = (
  configService: ConfigService
): TypeOrmModuleOptions => ({
  type: 'postgres' as const,
  url: configService.getOrThrow<string>('DATABASE_URL'),
  retryAttempts: DATABASE_RETRY_ATTEMPTS,
  retryDelay: DATABASE_RETRY_DELAY_MS,
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [join(__dirname, '../../migrations/*{.ts,.js}')],
  migrationsRun: true,
  synchronize: false,
  logging:
    configService.get<string>('NODE_ENV') !== 'production'
      ? ['error', 'warn']
      : false,
});

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createDatabaseOptions,
    }),
  ],
})
export class DatabaseModule {}
