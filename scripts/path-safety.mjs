import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function pathExistsForValidation(candidate) {
  // codeql[js/path-injection] -- This read-only probe is part of canonical path validation.
  return fs.lstatSync(candidate, { throwIfNoEntry: false }) !== undefined;
}

function pathMetadataForValidation(candidate) {
  // codeql[js/path-injection] -- This read-only metadata lookup rejects links and unsafe file types.
  return fs.lstatSync(candidate);
}

function canonicalPathForValidation(candidate) {
  // codeql[js/path-injection] -- Canonicalization is required before containment is decided.
  return fs.realpathSync.native(candidate);
}

export function pathIsInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export function resolvePathForSafety(candidate) {
  let current = path.resolve(candidate);
  const missingSegments = [];

  while (!pathExistsForValidation(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`No existing ancestor for path: ${candidate}`);
    }
    missingSegments.unshift(path.basename(current));
    current = parent;
  }

  return path.join(canonicalPathForValidation(current), ...missingSegments);
}

function assertNotRootOrHome(candidate, label) {
  const filesystemRoot = path.parse(candidate).root;
  const home = fs.realpathSync.native(os.homedir());
  if (candidate === filesystemRoot || candidate === home) {
    throw new Error(`${label} cannot be the filesystem root or home directory`);
  }
}

export function resolveSafeNewDirectory({ candidate, forbiddenTrees, label }) {
  const absoluteCandidate = path.resolve(candidate);
  if (pathExistsForValidation(absoluteCandidate)) {
    throw new Error(`${label} already exists: ${absoluteCandidate}`);
  }

  const resolved = resolvePathForSafety(absoluteCandidate);
  assertNotRootOrHome(resolved, label);
  for (const forbiddenTree of forbiddenTrees) {
    const resolvedTree = resolvePathForSafety(forbiddenTree);
    if (resolved === resolvedTree || pathIsInside(resolvedTree, resolved)) {
      throw new Error(`${label} must be outside ${resolvedTree}`);
    }
  }
  return resolved;
}

export function resolveContainedPath({ root, relativePath, label }) {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be relative`);
  }

  const resolvedRoot = resolvePathForSafety(root);
  const resolved = resolvePathForSafety(path.join(resolvedRoot, relativePath));
  if (!pathIsInside(resolvedRoot, resolved)) {
    throw new Error(`${label} escapes ${resolvedRoot}`);
  }
  return resolved;
}

export function resolveSafeStateFile({ candidate, allowedRoots, label }) {
  const absoluteCandidate = path.resolve(candidate);
  if (pathExistsForValidation(absoluteCandidate)) {
    const metadata = pathMetadataForValidation(absoluteCandidate);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`${label} must be a regular file, not a link`);
    }
  }

  const resolved = resolvePathForSafety(absoluteCandidate);
  assertNotRootOrHome(resolved, label);
  const isAllowed = allowedRoots.some(root => {
    const resolvedRoot = resolvePathForSafety(root);
    return pathIsInside(resolvedRoot, resolved);
  });
  if (!isAllowed) {
    throw new Error(`${label} must stay inside a Pomi state directory`);
  }
  return resolved;
}

export function resolveExistingFileInside({ candidate, root, label }) {
  const absoluteCandidate = path.resolve(candidate);
  const metadata = pathMetadataForValidation(absoluteCandidate);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${label} must be a regular file, not a link`);
  }

  const resolvedRoot = resolvePathForSafety(root);
  const resolved = canonicalPathForValidation(absoluteCandidate);
  if (!pathIsInside(resolvedRoot, resolved)) {
    throw new Error(`${label} must stay inside ${resolvedRoot}`);
  }
  return resolved;
}

export function resolveManagedDirectory({
  allowedRoot,
  candidate,
  label,
  sentinelName,
  trustedDirectory,
}) {
  const absoluteCandidate = path.resolve(candidate);
  const absoluteTrustedDirectory = path.resolve(trustedDirectory);
  for (const [directory, directoryLabel] of [
    [absoluteCandidate, label],
    [absoluteTrustedDirectory, `${label} trusted path`],
  ]) {
    if (pathExistsForValidation(directory)) {
      const metadata = pathMetadataForValidation(directory);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error(
          `${directoryLabel} must be a real directory, not a link or file`
        );
      }
    }
  }

  const resolved = resolvePathForSafety(absoluteCandidate);
  const resolvedAllowedRoot = resolvePathForSafety(allowedRoot);
  const resolvedTrustedDirectory = resolvePathForSafety(
    absoluteTrustedDirectory
  );
  assertNotRootOrHome(resolved, label);

  if (!pathIsInside(resolvedAllowedRoot, resolvedTrustedDirectory)) {
    throw new Error(
      `${label} trusted path must stay inside ${resolvedAllowedRoot}`
    );
  }

  if (resolved === resolvedTrustedDirectory) {
    return resolved;
  }
  if (!pathIsInside(resolvedAllowedRoot, resolved)) {
    throw new Error(`${label} must stay inside ${resolvedAllowedRoot}`);
  }

  const sentinel = path.join(
    path.dirname(resolved),
    `.${path.basename(resolved)}.${sentinelName}`
  );
  if (
    !pathExistsForValidation(sentinel) ||
    !pathMetadataForValidation(sentinel).isFile()
  ) {
    throw new Error(`${label} requires the sentinel ${sentinel}`);
  }
  return resolved;
}
