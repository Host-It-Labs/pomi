import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const output = path.resolve(outputArgument);
if (output === root || output.startsWith(`${root}${path.sep}`)) {
  throw new Error(
    'The public snapshot must be created outside the private repository'
  );
}
if (existsSync(output)) {
  throw new Error(`Output already exists: ${output}`);
}
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

mkdirSync(output, { recursive: false });
for (const relativePath of files) {
  const source = path.join(root, relativePath);
  const destination = path.join(output, relativePath);
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, {
    preserveTimestamps: true,
  });
}

execFileSync('git', ['init', '--initial-branch=main'], {
  cwd: output,
  stdio: 'inherit',
});
execFileSync('git', ['add', '--force', '--all'], {
  cwd: output,
  stdio: 'inherit',
});
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
