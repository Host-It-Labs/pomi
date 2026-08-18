import * as dotenv from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { resolveDatabaseUrl } from './src/config/environment';

dotenv.config();

export default new DataSource({
  type: 'postgres',
  url: resolveDatabaseUrl(process.env),
  entities: [join(__dirname, 'src', '**', '*.entity{.ts,.js}')],
  migrations: [join(__dirname, 'migrations', '*{.ts,.js}')],
  synchronize: false,
  logging: process.env.NODE_ENV !== 'production' ? ['error', 'warn'] : false,
});
