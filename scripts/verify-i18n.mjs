import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const frontendRoot = path.join(repoRoot, 'packages', 'frontend', 'src');
const wearRoot = path.join(
  repoRoot,
  'packages',
  'frontend',
  'src-tauri',
  'gen',
  'android',
  'wear',
  'src',
  'main',
  'res'
);

const errors = [];
const wearResourceKeyPattern = /^[a-z][a-z0-9_]*$/;

function walk(directory, predicate) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(entryPath, predicate));
    } else if (predicate(entryPath)) {
      files.push(entryPath);
    }
  }
  return files;
}

function relative(filePath) {
  return path.relative(repoRoot, filePath);
}

function isAllowedUiLiteral(value) {
  const text = value.trim();
  if (!text || !/[A-Za-z]/.test(text)) return true;
  if (/^&[A-Za-z0-9#]+;$/.test(text)) return true;

  // These values are product/technology names or keyboard notation, not copy
  // that should be translated in the interface.
  if (
    /^(?:Pomi|Sentry|OpenRouter|AI|URL|Markdown|Ctrl\+|Shift\+|Alt\+|Cmd\+|Enter|Escape|copyme|Android\s+\d+:\d+|iPhone\s+.+|useToast\s+must\s+be\s+used\s+within\s+a\s+ToastProvider)$/i.test(
      text
    )
  ) {
    return true;
  }

  if (/^\d+(?:\.\d+)?\s*(?:ms|s|m|h|d)$/i.test(text)) return true;
  if (/^(?:Arrow(?:Up|Down|Left|Right)|Space|Tab|Backspace)$/i.test(text)) {
    return true;
  }

  return false;
}

function addUiLiteralError(filePath, line, value) {
  if (isAllowedUiLiteral(value)) return;
  errors.push(`${relative(filePath)}:${line}: untranslated UI text: ${value}`);
}

function lineNumber(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function scanFrontendUi() {
  const files = walk(
    frontendRoot,
    filePath =>
      /\.(tsx|jsx)$/.test(filePath) &&
      !/\.test\.(tsx|jsx)$/.test(filePath) &&
      !filePath.includes(`${path.sep}i18n${path.sep}`)
  );

  const propPattern =
    /\b(?:aria-label|aria-description|title|label|description|placeholder|loadingText|message|help|alt)=(["'])(.*?)\1/g;
  const textNodePattern =
    /<([A-Za-z][\w.]*)\b[^>]*>\s*([^<{\n]*[A-Za-z][^<{\n]*?)\s*<\/\1>/g;
  const objectPropPattern =
    /\b(?:ariaLabel|ariaDescription|title|label|description|placeholder|loadingText|message|help|alt)\s*:\s*(["'])(.*?)\1/g;
  const userMessageCallPattern =
    /\b(?:showToast(?:FromStore)?|(?:set[A-Z][A-Za-z0-9]*(?:Error|Message))|window\.(?:confirm|alert)|new\s+Error)\s*\(\s*(["'])(.*?)\1/g;

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    for (const match of source.matchAll(propPattern)) {
      addUiLiteralError(
        filePath,
        lineNumber(source, match.index ?? 0),
        match[2]
      );
    }
    for (const match of source.matchAll(objectPropPattern)) {
      addUiLiteralError(
        filePath,
        lineNumber(source, match.index ?? 0),
        match[2]
      );
    }
    for (const match of source.matchAll(userMessageCallPattern)) {
      addUiLiteralError(
        filePath,
        lineNumber(source, match.index ?? 0),
        match[2]
      );
    }
    for (const match of source.matchAll(textNodePattern)) {
      addUiLiteralError(
        filePath,
        lineNumber(source, match.index ?? 0),
        match[2]
      );
    }
  }
}

function readWearResources(directory) {
  const files = walk(
    directory,
    filePath => path.basename(filePath) === 'strings.xml'
  );
  const resources = new Map();
  const resourcePattern =
    /<(?:string|plurals)\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/(?:string|plurals)>/g;
  for (const filePath of files) {
    const values = new Map();
    const source = fs.readFileSync(filePath, 'utf8');
    for (const match of source.matchAll(resourcePattern)) {
      values.set(match[1], match[2].replace(/<[^>]+>/g, '').trim());
    }
    resources.set(path.basename(path.dirname(filePath)), { filePath, values });
  }
  return resources;
}

function scanWearResources() {
  const resources = readWearResources(wearRoot);
  const base = resources.get('values');
  if (!base) {
    errors.push(
      'Wear resources are missing the base values/strings.xml catalog.'
    );
    return;
  }

  const expectedDirectories = [
    'values-zh-rCN',
    'values-hi',
    'values-es',
    'values-ar',
    'values-fr',
    'values-bn',
    'values-pt-rBR',
    'values-id',
    'values-ur',
  ];

  for (const directory of expectedDirectories) {
    const catalog = resources.get(directory);
    if (!catalog) {
      errors.push(`Wear catalog is missing ${directory}/strings.xml.`);
      continue;
    }
    for (const [name, value] of base.values) {
      if (!wearResourceKeyPattern.test(name)) {
        errors.push(
          `Wear base catalog has a non-normalized resource key ${name}.`
        );
      }
      if (!catalog.values.has(name)) {
        errors.push(`Wear ${directory} is missing string resource ${name}.`);
      } else if (!catalog.values.get(name)) {
        errors.push(`Wear ${directory} has an empty string resource ${name}.`);
      }
      if (!value) {
        errors.push(`Wear base catalog has an empty string resource ${name}.`);
      }
    }
    for (const name of catalog.values.keys()) {
      if (!wearResourceKeyPattern.test(name)) {
        errors.push(
          `Wear ${directory} has a non-normalized resource key ${name}.`
        );
      }
      if (!base.values.has(name)) {
        errors.push(
          `Wear ${directory} defines unknown string resource ${name}.`
        );
      }
    }
  }
}

scanFrontendUi();
scanWearResources();

if (errors.length > 0) {
  console.error(`i18n verification failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    'i18n verification passed: UI literals and Wear catalogs are covered.\n'
  );
}
