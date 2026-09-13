import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sourceTranslationCatalogs } from '../src/i18n/catalog-source.ts';

async function main() {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const outputDirectory = resolve(packageRoot, 'src/i18n/catalogs');
  const checkOnly = process.argv.includes('--check');

  await mkdir(outputDirectory, { recursive: true });

  for (const [language, catalog] of Object.entries(sourceTranslationCatalogs)) {
    const outputPath = resolve(outputDirectory, `${language}.json`);
    const generated = `${JSON.stringify(catalog, null, 2)}\n`;
    if (checkOnly) {
      const existing = await readFile(outputPath, 'utf8');
      if (existing !== generated) {
        throw new Error(`Generated translation catalog is stale: ${language}`);
      }
    } else {
      await writeFile(outputPath, generated, 'utf8');
    }
  }
}

void main();
