import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

export const defaultLocalEnvironmentFile = path.join(
  repositoryRoot,
  '.env.local'
);

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

export function readLocalEnvironment(
  file = process.env.POMI_LOCAL_ENV_FILE || defaultLocalEnvironmentFile
) {
  if (!existsSync(file)) return {};
  return parseEnvironmentFile(readFileSync(file, 'utf8'));
}

export function loadLocalEnvironment({
  environment = process.env,
  file = environment.POMI_LOCAL_ENV_FILE || defaultLocalEnvironmentFile,
} = {}) {
  const values = readLocalEnvironment(file);
  for (const [key, value] of Object.entries(values)) {
    if (environment[key] === undefined) environment[key] = value;
  }
  return environment;
}

export function resolveRepositoryPath(value) {
  if (!value) return undefined;
  return path.isAbsolute(value) ? value : path.resolve(repositoryRoot, value);
}

function quoteForShell(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--shell-exports') {
    process.stderr.write('Usage: node scripts/local-env.mjs --shell-exports\n');
    process.exitCode = 2;
  } else {
    const values = readLocalEnvironment();
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined) {
        process.stdout.write(`export ${key}=${quoteForShell(value)}\n`);
      }
    }
  }
}
