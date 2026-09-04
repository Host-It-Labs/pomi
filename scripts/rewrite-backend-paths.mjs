#!/usr/bin/env node

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(scriptDirectory, '..', 'packages', 'backend');
const outputDirectory = path.resolve(
  backendRoot,
  process.argv[2] ?? 'dist'
);
const sourceDirectory = path.join(outputDirectory, 'src');

function listJavaScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? listJavaScriptFiles(entryPath)
      : entry.isFile() && entry.name.endsWith('.js')
        ? [entryPath]
        : [];
  });
}

if (!statSync(sourceDirectory, { throwIfNoEntry: false })) {
  throw new Error(`Backend build output is missing: ${sourceDirectory}`);
}

for (const filePath of listJavaScriptFiles(sourceDirectory)) {
  const original = readFileSync(filePath, 'utf8');
  const rewritten = original.replace(
    /(['"])src\/([^'"]+)\1/g,
    (match, quote, modulePath) => {
      const targetPath = path.join(sourceDirectory, modulePath);
      let relativePath = path.relative(path.dirname(filePath), targetPath);
      if (!relativePath.startsWith('.')) {
        relativePath = `./${relativePath}`;
      }
      return `${quote}${relativePath}${quote}`;
    }
  );

  if (rewritten !== original) {
    writeFileSync(filePath, rewritten);
  }
}
