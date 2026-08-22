import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);

const forbiddenPaths = [
  /^\.codex\/(?!config\.toml$|environments\/pomi(?:-worktree)?\.toml$|hooks\/start-pomi-tmux\.sh$|rules\/default\.rules$)/,
  /^\.vscode\/sessions\.json$/,
  /^notes\.txt$/,
  /vikunja-export\.zip$/,
  /google-services\.json$/,
  /(?:^|\/)keystore(?:\.properties|\.jks)$/,
  /(?:^|\/)\.env(?:\.|$)/,
  /(?:^|\/)pgdata\//,
];
const allowedEnvironmentExamples = /\.env(?:\.production)?\.example$/;
const forbiddenContent = [
  { label: 'absolute macOS user path', pattern: /\/Users\/[A-Za-z0-9._-]+\// },
  { label: 'owner application identifier', pattern: /com\.hostitlabs\.pomi/ },
  {
    label: 'embedded Sentry DSN',
    pattern: /https:\/\/[a-f0-9]{24,}@[^\s"']*sentry\.io/i,
  },
  {
    label: 'private IPv4 address',
    pattern:
      /\b(?:192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|10\.(?!0\.2\.2\b)\d{1,3}\.\d{1,3}\.\d{1,3})\b/,
  },
];
const binaryExtensions = new Set([
  '.gif',
  '.icns',
  '.ico',
  '.jar',
  '.jpeg',
  '.jpg',
  '.mp3',
  '.otf',
  '.png',
  '.ttf',
  '.wav',
  '.woff',
  '.woff2',
]);
const textExtensions = new Set([
  '',
  '.bat',
  '.cargo-ok',
  '.cjs',
  '.css',
  '.dev',
  '.dockerignore',
  '.editorconfig',
  '.entitlements',
  '.env',
  '.example',
  '.gradle',
  '.h',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.kts',
  '.lock',
  '.md',
  '.mjs',
  '.mm',
  '.nvmrc',
  '.orig',
  '.pbxproj',
  '.plist',
  '.prettierignore',
  '.pro',
  '.properties',
  '.resolved',
  '.rs',
  '.rules',
  '.sh',
  '.storyboard',
  '.storekit',
  '.swift',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.xcscheme',
  '.xcsettings',
  '.xcworkspacedata',
  '.yml',
  '.yaml',
]);

const failures = [];
for (const relativePath of trackedFiles) {
  const absolutePath = path.join(root, relativePath);
  if (lstatSync(absolutePath).isSymbolicLink()) {
    failures.push(`${relativePath}: tracked symlink`);
    continue;
  }
  if (
    forbiddenPaths.some(pattern => pattern.test(relativePath)) &&
    !allowedEnvironmentExamples.test(relativePath)
  ) {
    failures.push(`${relativePath}: forbidden public path`);
  }

  const extension = path.extname(relativePath).toLowerCase();
  if (binaryExtensions.has(extension)) continue;
  if (!textExtensions.has(extension)) {
    failures.push(
      `${relativePath}: unreviewed file type ${extension || '(none)'}`
    );
    continue;
  }

  const content = readFileSync(absolutePath, 'utf8');
  for (const rule of forbiddenContent) {
    if (rule.pattern.test(content)) {
      failures.push(`${relativePath}: ${rule.label}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Public-source audit failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

process.stdout.write(
  `Public-source audit passed for ${trackedFiles.length} tracked files.\n`
);
