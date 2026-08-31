import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const lockDirectoryName = 'radar-automation-lock';
const ownerFileName = 'owner.json';
const validStages = new Set(['parent', 'child']);

function assertTrackAndStage(track, stage) {
  if (!track || !/^[a-z0-9-]+$/.test(track)) {
    throw new Error(
      'track must contain only lowercase letters, numbers, and hyphens'
    );
  }
  if (!validStages.has(stage)) {
    throw new Error('stage must be parent or child');
  }
}

function assertRealDirectory(candidate, label) {
  const metadata = fs.lstatSync(candidate, { throwIfNoEntry: false });
  if (metadata?.isSymbolicLink() || (metadata && !metadata.isDirectory())) {
    throw new Error(`${label} must be a real directory, not a link or file`);
  }
  return metadata;
}

function ensureDirectory(candidate, label) {
  const existing = assertRealDirectory(candidate, label);
  if (existing) {
    return;
  }

  try {
    fs.mkdirSync(candidate, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
    assertRealDirectory(candidate, label);
  }
}

export function resolveLockDirectory(cwd) {
  const absoluteCwd = path.resolve(cwd);
  const cwdMetadata = fs.lstatSync(absoluteCwd, { throwIfNoEntry: false });
  if (
    !cwdMetadata ||
    cwdMetadata.isSymbolicLink() ||
    !cwdMetadata.isDirectory()
  ) {
    throw new Error(`worktree must be a real directory: ${absoluteCwd}`);
  }

  const realCwd = fs.realpathSync.native(absoluteCwd);
  const stateDirectory = path.join(realCwd, '.pomi');
  ensureDirectory(stateDirectory, 'Pomi state directory');
  return path.join(stateDirectory, lockDirectoryName);
}

function ownerPath(lockDirectory) {
  return path.join(lockDirectory, ownerFileName);
}

function readOwnerFile(lockDirectory) {
  const lockMetadata = fs.lstatSync(lockDirectory, { throwIfNoEntry: false });
  if (!lockMetadata) {
    return null;
  }
  if (lockMetadata.isSymbolicLink() || !lockMetadata.isDirectory()) {
    throw new Error(
      'automation lock must be a real directory, not a link or file'
    );
  }

  const candidate = ownerPath(lockDirectory);
  const metadata = fs.lstatSync(candidate, { throwIfNoEntry: false });
  if (!metadata || metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(
      'automation lock has no valid owner metadata; manual recovery is required'
    );
  }

  let owner;
  try {
    owner = JSON.parse(fs.readFileSync(candidate, 'utf8'));
  } catch (error) {
    throw new Error(
      `automation lock owner metadata is invalid: ${error.message}`
    );
  }
  if (
    owner?.version !== 1 ||
    typeof owner.track !== 'string' ||
    typeof owner.stage !== 'string' ||
    typeof owner.cwd !== 'string' ||
    typeof owner.acquiredAt !== 'string'
  ) {
    throw new Error(
      'automation lock owner metadata is incomplete; manual recovery is required'
    );
  }
  return owner;
}

function publicOwner(owner) {
  return {
    version: owner.version,
    track: owner.track,
    stage: owner.stage,
    cwd: owner.cwd,
    hostname: owner.hostname,
    pid: owner.pid,
    acquiredAt: owner.acquiredAt,
  };
}

export function readLockOwner(cwd) {
  const lockDirectory = resolveLockDirectory(cwd);
  const owner = readOwnerFile(lockDirectory);
  return owner ? publicOwner(owner) : null;
}

export function acquireLock({ cwd, track, stage }) {
  assertTrackAndStage(track, stage);
  const lockDirectory = resolveLockDirectory(cwd);

  try {
    fs.mkdirSync(lockDirectory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
    const existingOwner = readOwnerFile(lockDirectory);
    return {
      acquired: false,
      owner: existingOwner ? publicOwner(existingOwner) : null,
    };
  }

  const owner = {
    version: 1,
    track,
    stage,
    cwd: fs.realpathSync.native(path.resolve(cwd)),
    hostname: os.hostname(),
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(
      ownerPath(lockDirectory),
      `${JSON.stringify(owner, null, 2)}\n`,
      {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      }
    );
  } catch (error) {
    fs.rmdirSync(lockDirectory);
    throw error;
  }

  return { acquired: true, owner: publicOwner(owner) };
}

export function releaseLock({ cwd, track, stage }) {
  assertTrackAndStage(track, stage);
  const lockDirectory = resolveLockDirectory(cwd);
  const owner = readOwnerFile(lockDirectory);
  if (!owner) {
    throw new Error('automation lock is not held');
  }
  if (owner.track !== track || owner.stage !== stage) {
    throw new Error(
      `automation lock belongs to ${owner.track}/${owner.stage}; refusing release as ${track}/${stage}`
    );
  }

  fs.unlinkSync(ownerPath(lockDirectory));
  fs.rmdirSync(lockDirectory);
  return publicOwner(owner);
}

export function recoverLock({ cwd, track, stage, confirm }) {
  if (!confirm) {
    throw new Error(
      'recovery requires --confirm after verifying that no run is active'
    );
  }
  assertTrackAndStage(track, stage);
  const lockDirectory = resolveLockDirectory(cwd);
  const owner = readOwnerFile(lockDirectory);
  if (!owner) {
    throw new Error('automation lock is not held');
  }
  if (owner.track !== track || owner.stage !== stage) {
    throw new Error(
      `automation lock belongs to ${owner.track}/${owner.stage}; refusing recovery as ${track}/${stage}`
    );
  }

  fs.unlinkSync(ownerPath(lockDirectory));
  fs.rmdirSync(lockDirectory);
  return publicOwner(owner);
}

function parseOptions(argumentsList) {
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!argument.startsWith('--')) {
      throw new Error(`unexpected argument: ${argument}`);
    }
    const key = argument.slice(2);
    if (key === 'confirm') {
      options[key] = true;
      continue;
    }
    const value = argumentsList[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`missing value for --${key}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function requiredOption(options, name) {
  if (!options[name]) {
    throw new Error(`missing --${name}`);
  }
  return options[name];
}

function printOwner(owner) {
  process.stdout.write(`${JSON.stringify(owner)}\n`);
}

export function runCli(argumentsList, cwd) {
  const [command, ...optionArguments] = argumentsList;
  const options = parseOptions(optionArguments);

  if (command === 'acquire') {
    const result = acquireLock({
      cwd,
      track: requiredOption(options, 'track'),
      stage: requiredOption(options, 'stage'),
    });
    if (!result.acquired) {
      if (!result.owner) {
        throw new Error(
          'automation lock disappeared while it was being inspected'
        );
      }
      process.stderr.write(
        `automation lock is already held by ${result.owner.track}/${result.owner.stage} since ${result.owner.acquiredAt} in ${result.owner.cwd}\n`
      );
      return 75;
    }
    process.stdout.write(
      `acquired ${result.owner.track}/${result.owner.stage} in ${result.owner.cwd}\n`
    );
    return 0;
  }

  if (command === 'release') {
    const owner = releaseLock({
      cwd,
      track: requiredOption(options, 'track'),
      stage: requiredOption(options, 'stage'),
    });
    process.stdout.write(
      `released ${owner.track}/${owner.stage} in ${owner.cwd}\n`
    );
    return 0;
  }

  if (command === 'status') {
    printOwner(readLockOwner(cwd));
    return 0;
  }

  if (command === 'recover') {
    const owner = recoverLock({
      cwd,
      track: requiredOption(options, 'track'),
      stage: requiredOption(options, 'stage'),
      confirm: options.confirm === true,
    });
    process.stdout.write(
      `recovered ${owner.track}/${owner.stage} in ${owner.cwd}\n`
    );
    return 0;
  }

  throw new Error('command must be acquire, release, status, or recover');
}

function main() {
  try {
    return runCli(process.argv.slice(2), process.cwd());
  } catch (error) {
    process.stderr.write(`radar-automation-lock: ${error.message}\n`);
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main();
}
