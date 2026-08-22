import * as dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

export function resolveBackendLocalEnvironmentFile(): string | undefined {
  const configured = process.env.POMI_LOCAL_ENV_FILE?.trim();
  const candidates = [
    configured && path.resolve(configured),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '../../.env.local'),
  ].filter((value): value is string => Boolean(value));
  return candidates.find(candidate => existsSync(candidate));
}

export function loadBackendLocalEnvironment(): void {
  const envFile = resolveBackendLocalEnvironmentFile();
  if (envFile) dotenv.config({ path: envFile, override: false });
}
