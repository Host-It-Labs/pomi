import * as dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

export function resolveBackendLocalEnvironmentFile(): string | undefined {
  const candidates = [
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '../../.env.local'),
  ];
  return candidates.find(candidate => existsSync(candidate));
}

export function loadBackendLocalEnvironment(): void {
  const envFile = resolveBackendLocalEnvironmentFile();
  if (envFile) dotenv.config({ path: envFile, override: false });
}
