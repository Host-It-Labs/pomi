#!/usr/bin/env node
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { loadReleaseEnvironment, repositoryRoot } from './local-env.mjs';

loadReleaseEnvironment();

const androidRoot = path.join(
  repositoryRoot,
  'packages/frontend/src-tauri/gen/android'
);
const googleServicesTarget = path.join(androidRoot, 'app/google-services.json');
const keystorePropertiesTarget = path.join(androidRoot, 'keystore.properties');
rmSync(keystorePropertiesTarget, { force: true });
const secretPaths = {
  'config/secrets/google-services.json': path.join(
    repositoryRoot,
    'config/secrets/google-services.json'
  ),
  'config/secrets/pomi-release.jks': path.join(
    repositoryRoot,
    'config/secrets/pomi-release.jks'
  ),
};

function configuredSecretPath(value, expected, label) {
  if (!value) return undefined;
  if (value !== expected) {
    throw new Error(`${label} must use ${expected}.`);
  }
  return secretPaths[expected];
}

function copyOptionalSecret(source, target, label, validate) {
  if (!source || !existsSync(source)) {
    process.stdout.write(
      `[pomi] ${label} is not configured; integration remains disabled.\n`
    );
    return false;
  }
  validate?.(source);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
  chmodSync(target, 0o600);
  process.stdout.write(`[pomi] prepared ${label}.\n`);
  return true;
}

copyOptionalSecret(
  configuredSecretPath(
    process.env.POMI_GOOGLE_SERVICES_JSON_PATH,
    'config/secrets/google-services.json',
    'Android Firebase configuration'
  ),
  googleServicesTarget,
  'Android Firebase configuration',
  source => {
    const configuration = JSON.parse(readFileSync(source, 'utf8'));
    const packageNames = (configuration.client || [])
      .map(client => client.client_info?.android_client_info?.package_name)
      .filter(Boolean);
    if (configuration.project_info?.project_id !== 'pomi-d8ea6') {
      throw new Error(
        'Android Firebase configuration must use project pomi-d8ea6.'
      );
    }
    if (!packageNames.includes('app.pomi.community')) {
      throw new Error(
        'Android Firebase configuration must include package app.pomi.community.'
      );
    }
  }
);

const keystore = configuredSecretPath(
  process.env.POMI_ANDROID_KEYSTORE_PATH,
  'config/secrets/pomi-release.jks',
  'Android keystore'
);
const password = process.env.ANDROID_KEY_PASSWORD?.trim();
const alias = process.env.ANDROID_KEY_ALIAS?.trim() || 'pomi';
if (keystore && existsSync(keystore) && password) {
  writeFileSync(
    keystorePropertiesTarget,
    [
      `storeFile=${keystore}`,
      `storePassword=${password}`,
      `keyAlias=${alias}`,
      `keyPassword=${password}`,
      '',
    ].join('\n'),
    { mode: 0o600 }
  );
  chmodSync(keystorePropertiesTarget, 0o600);
  process.stdout.write('[pomi] prepared Android signing configuration.\n');
} else {
  process.stdout.write(
    '[pomi] Android signing is incomplete; unsigned/debug builds remain available.\n'
  );
}
