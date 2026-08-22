import { join } from 'path';
import { DataSource } from 'typeorm';
import { resolveDatabaseUrl } from './src/config/environment';
import { loadBackendLocalEnvironment } from './src/config/local-environment';

loadBackendLocalEnvironment();

export default new DataSource({
  type: 'postgres',
  url: resolveDatabaseUrl(process.env),
  entities: [join(__dirname, 'src', '**', '*.entity{.ts,.js}')],
  migrations: [join(__dirname, 'migrations', '*{.ts,.js}')],
  synchronize: false,
  logging: process.env.NODE_ENV !== 'production' ? ['error', 'warn'] : false,
});
