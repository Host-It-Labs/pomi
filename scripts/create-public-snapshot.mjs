import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveContainedPath,
  resolveSafeNewDirectory,
} from './path-safety.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const outputArgument = process.argv[2];
const publicEmail = process.env.POMI_PUBLIC_GIT_EMAIL?.trim();
const publicName =
  process.env.POMI_PUBLIC_GIT_NAME?.trim() || 'William Guinaudie';

if (!outputArgument || !publicEmail) {
  console.error(
    'Usage: POMI_PUBLIC_GIT_EMAIL=<public noreply email> node scripts/create-public-snapshot.mjs <new-output-directory>'
  );
  process.exit(2);
}

const output = resolveSafeNewDirectory({
  candidate: outputArgument,
  forbiddenTrees: [root],
  label: 'Public snapshot output',
});
if (
  !readFileSync(path.join(root, 'LICENSE'), 'utf8').includes(
    'PolyForm Noncommercial License 1.0.0'
  )
) {
  throw new Error('The public PolyForm Noncommercial license is missing');
}

const status = execFileSync('git', ['status', '--porcelain'], {
  cwd: root,
  encoding: 'utf8',
});
if (status.trim()) {
  throw new Error(
    'Commit or remove private worktree changes before creating a snapshot'
  );
}

execFileSync(process.execPath, ['scripts/audit-public-source.mjs'], {
  cwd: root,
  stdio: 'inherit',
});

const files = execFileSync('git', ['ls-files', '-z'], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);

// codeql[js/path-injection] -- The explicit CLI destination is canonicalized, new, outside the repository, root, and home.
mkdirSync(output, { recursive: false });
for (const relativePath of files) {
  const source = resolveContainedPath({
    root,
    relativePath,
    label: 'Public snapshot source',
  });
  const destination = resolveContainedPath({
    root: output,
    relativePath,
    label: 'Public snapshot destination',
  });

  // codeql[js/path-injection] -- Git-tracked relative paths are canonicalized and required to remain inside the new snapshot.
  mkdirSync(path.dirname(destination), { recursive: true });
  // codeql[js/path-injection] -- Source and destination are canonicalized into the repository and snapshot roots respectively.
  cpSync(source, destination, {
    preserveTimestamps: true,
  });
}

// codeql[js/path-injection] -- The working directory is the validated, newly created snapshot root.
execFileSync('git', ['init', '--initial-branch=main'], {
  cwd: output,
  stdio: 'inherit',
});
// codeql[js/path-injection] -- The working directory is the validated, newly created snapshot root.
execFileSync('git', ['add', '--force', '--all'], {
  cwd: output,
  stdio: 'inherit',
});
// codeql[js/path-injection] -- The working directory is the validated, newly created snapshot root.
execFileSync(
  'git',
  [
    '-c',
    `user.name=${publicName}`,
    '-c',
    `user.email=${publicEmail}`,
    'commit',
    '-m',
    'Initial public source release',
  ],
  { cwd: output, stdio: 'inherit' }
);

process.stdout.write(`Created one-commit public snapshot at ${output}\n`);
process.stdout.write('Verify the snapshot audit before publishing it.\n');
