import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

export const environmentFiles = Object.freeze({
  local: path.join(repositoryRoot, '.env.local'),
  automation: path.join(repositoryRoot, 'config/pomi-automation.env'),
  release: path.join(repositoryRoot, 'config/pomi-release.env'),
});

export const defaultLocalEnvironmentFile = environmentFiles.local;

function unquote(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function parseEnvironmentFile(contents) {
  const values = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line
      .slice(0, separator)
      .replace(/^export\s+/, '')
      .trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    values[key] = unquote(line.slice(separator + 1).trim());
  }
  return values;
}

export function resolveEnvironmentFile(options) {
  const { profile, filePath } = options ?? {};
  if (filePath) return resolveRepositoryPath(filePath) ?? filePath;
  if (!profile) {
    throw new Error(
      `Pomi environment profile is required. Expected one of: ${Object.keys(environmentFiles).join(', ')}.`
    );
  }
  const environmentFile = environmentFiles[profile];
  if (!environmentFile) {
    throw new Error(
      `Unknown Pomi environment profile: ${profile}. Expected one of: ${Object.keys(environmentFiles).join(', ')}.`
    );
  }
  return environmentFile;
}

export function readEnvironmentFile(filePath) {
  if (!existsSync(filePath)) return {};
  return parseEnvironmentFile(readFileSync(filePath, 'utf8'));
}

export function readLocalEnvironment() {
  return readEnvironmentFile(defaultLocalEnvironmentFile);
}

export function mergeEnvironment(environment, values) {
  for (const [key, value] of Object.entries(values)) {
    if (environment[key] === undefined) environment[key] = value;
  }
  return environment;
}

export function loadEnvironment(options) {
  const { environment, profile, filePath } = options ?? {};
  return mergeEnvironment(
    environment ?? process.env,
    readEnvironmentFile(resolveEnvironmentFile({ profile, filePath }))
  );
}

export function loadLocalEnvironment(options) {
  const { environment = process.env, filePath } = options ?? {};
  return loadEnvironment({ environment, profile: 'local', filePath });
}

export function loadAutomationEnvironment(options) {
  const { environment = process.env, filePath } = options ?? {};
  return loadEnvironment({ environment, profile: 'automation', filePath });
}

export function loadReleaseEnvironment(options) {
  const { environment = process.env, filePath } = options ?? {};
  return loadEnvironment({ environment, profile: 'release', filePath });
}

export function resolveRepositoryPath(value) {
  if (!value) return undefined;
  return path.isAbsolute(value) ? value : path.resolve(repositoryRoot, value);
}

function quoteForShell(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let profile;
  let filePath;
  let valid = args[0] === '--shell-exports';

  for (let index = 1; valid && index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--profile' && args[index + 1]) {
      profile = args[++index];
    } else if (argument === '--env-file' && args[index + 1]) {
      filePath = args[++index];
    } else {
      valid = false;
    }
  }

  if (!valid || !profile) {
    process.stderr.write(
      'Usage: node scripts/local-env.mjs --shell-exports --profile local|automation|release [--env-file path]\n'
    );
    process.exitCode = 2;
  } else {
    const values = readEnvironmentFile(
      resolveEnvironmentFile({ profile, filePath })
    );
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined) {
        process.stdout.write(`export ${key}=${quoteForShell(value)}\n`);
      }
    }
  }
}
