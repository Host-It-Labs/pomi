const DEVELOPMENT_JWT_SECRET =
  'pomi-development-only-secret-never-use-in-production';

const UNSAFE_JWT_SECRETS = new Set([
  'your-secret-key',
  'change-me',
  'changeme',
  DEVELOPMENT_JWT_SECRET,
]);

function readString(
  environment: Record<string, unknown>,
  key: string
): string | undefined {
  const value = environment[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function encodeUrlComponent(value: string): string {
  return encodeURIComponent(value);
}

export function resolveDatabaseUrl(
  environment: Record<string, unknown>
): string | undefined {
  const configuredUrl = readString(environment, 'DATABASE_URL');
  if (configuredUrl) return configuredUrl;

  const username = readString(environment, 'POSTGRES_USER');
  const password = readString(environment, 'POSTGRES_PASSWORD');
  const database = readString(environment, 'POSTGRES_DB');
  if (!username || !password || !database) return undefined;

  const host = readString(environment, 'POSTGRES_HOST') || 'db';
  const port = readString(environment, 'POSTGRES_PORT') || '5432';
  return `postgres://${encodeUrlComponent(username)}:${encodeUrlComponent(password)}@${host}:${port}/${encodeUrlComponent(database)}`;
}

export function resolveRedisUrl(
  environment: Record<string, unknown>
): string | undefined {
  const configuredUrl = readString(environment, 'REDIS_URL');
  if (configuredUrl) return configuredUrl;

  const password = readString(environment, 'REDIS_PASSWORD');
  if (!password) return undefined;

  const host = readString(environment, 'REDIS_HOST') || 'redis';
  const port = readString(environment, 'REDIS_PORT') || '6379';
  return `redis://:${encodeUrlComponent(password)}@${host}:${port}`;
}

function parseBoolean(
  environment: Record<string, unknown>,
  key: string,
  fallback: boolean
): boolean {
  const value = environment[key];
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`${key} must be true or false`);
}

export function validateEnvironment(
  input: Record<string, unknown>
): Record<string, unknown> {
  const environment = { ...input };
  const nodeEnvironment = readString(environment, 'NODE_ENV') || 'development';
  const jwtSecret = readString(environment, 'JWT_SECRET');
  const adminBootstrapToken = readString(
    environment,
    'POMI_ADMIN_BOOTSTRAP_TOKEN'
  );
  const selfHosted =
    readString(environment, 'POMI_HOSTING_MODE')?.toLowerCase() !== 'hosted';
  const databaseUrl = resolveDatabaseUrl(environment);
  const redisUrl = resolveRedisUrl(environment);

  if (databaseUrl) environment.DATABASE_URL = databaseUrl;
  if (redisUrl) environment.REDIS_URL = redisUrl;
  environment.APN_PRODUCTION = parseBoolean(
    environment,
    'APN_PRODUCTION',
    false
  );

  if (nodeEnvironment !== 'production') {
    environment.JWT_SECRET = jwtSecret || DEVELOPMENT_JWT_SECRET;
    return environment;
  }

  const missing = [
    [databaseUrl, 'DATABASE_URL or PostgreSQL connection fields'],
    [redisUrl, 'REDIS_URL or REDIS_PASSWORD'],
    [jwtSecret, 'JWT_SECRET'],
    [
      selfHosted ? adminBootstrapToken : 'not-required',
      'POMI_ADMIN_BOOTSTRAP_TOKEN',
    ],
    [readString(environment, 'CORS_ORIGINS'), 'CORS_ORIGINS'],
  ]
    .filter(([value]) => !value)
    .map(([, label]) => label);
  if (missing.length > 0) {
    throw new Error(
      `Missing required production environment variables: ${missing.join(', ')}`
    );
  }

  if (
    !jwtSecret ||
    jwtSecret.length < 32 ||
    UNSAFE_JWT_SECRETS.has(jwtSecret)
  ) {
    throw new Error(
      'JWT_SECRET must be at least 32 characters and must not use a documented default'
    );
  }

  if (selfHosted && (!adminBootstrapToken || adminBootstrapToken.length < 32)) {
    throw new Error(
      'POMI_ADMIN_BOOTSTRAP_TOKEN must be at least 32 characters'
    );
  }

  parseCorsOrigins(readString(environment, 'CORS_ORIGINS'), nodeEnvironment);
  return environment;
}

export function parseCorsOrigins(
  configuredOrigins: string | undefined,
  nodeEnvironment: string = process.env.NODE_ENV || 'development'
): string[] {
  const values = configuredOrigins
    ?.split(',')
    .map(value => value.trim())
    .filter(Boolean);

  if (!values?.length) {
    if (nodeEnvironment === 'production') {
      throw new Error('CORS_ORIGINS is required in production');
    }
    return ['http://localhost:1420', 'http://127.0.0.1:1420'];
  }

  return values.map(value => {
    if (value === 'null') return value;

    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol)) {
      if (url.origin !== value) {
        throw new Error(`CORS origin must not contain a path: ${value}`);
      }
      return url.origin;
    }

    const customOrigin = `${url.protocol}//${url.host}`;
    if (
      !url.host ||
      value !== customOrigin ||
      url.pathname ||
      url.search ||
      url.hash
    ) {
      throw new Error(`CORS origin must be an exact origin: ${value}`);
    }
    return customOrigin;
  });
}

export function isCorsOriginAllowed(
  origin: string | undefined,
  configuredOrigins: string | undefined = process.env.CORS_ORIGINS,
  nodeEnvironment: string = process.env.NODE_ENV || 'development'
): boolean {
  if (!origin) return true;

  if (nodeEnvironment !== 'production') {
    try {
      const url = new URL(origin);
      const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(
        url.hostname
      );
      if (isLoopback && ['http:', 'https:'].includes(url.protocol)) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return parseCorsOrigins(configuredOrigins, nodeEnvironment).includes(origin);
}
