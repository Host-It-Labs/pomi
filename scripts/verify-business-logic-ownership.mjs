import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifestPath = resolve(root, 'config/business-logic-ownership.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const requiredDomainIds = new Set([
  'auth-preferences',
  'intentions',
  'timer-session',
  'tasks',
  'accepted-actions',
  'statistics',
  'user-data-transfer',
  'watch-wear',
]);
const failures = [];
const seenIds = new Set();

for (const domain of manifest.domains ?? []) {
  if (!domain.id || seenIds.has(domain.id)) {
    failures.push(
      `domain has a missing or duplicate id: ${domain.id ?? '<missing>'}`
    );
  }
  seenIds.add(domain.id);

  if (!Array.isArray(domain.sources) || domain.sources.length === 0) {
    failures.push(`${domain.id}: no production sources declared`);
  }
  if (
    !Array.isArray(domain.specifications) ||
    domain.specifications.length === 0
  ) {
    failures.push(`${domain.id}: no executable specifications declared`);
  }
  if (!Array.isArray(domain.rules) || domain.rules.length === 0) {
    failures.push(`${domain.id}: no named business rules declared`);
  }

  for (const file of [
    ...(domain.sources ?? []),
    ...(domain.specifications ?? []),
  ]) {
    if (!existsSync(resolve(root, file))) {
      failures.push(`${domain.id}: missing declared file ${file}`);
    }
  }

  const journeys = domain.journeys ?? (domain.journey ? [domain.journey] : []);
  for (const journey of journeys) {
    if (!Number.isInteger(journey) || journey < 1 || journey > 13) {
      failures.push(`${domain.id}: invalid retained journey ${journey}`);
    }
  }

  for (const rule of domain.rules ?? []) {
    if (!rule.name || !rule.specification || !rule.title) {
      failures.push(
        `${domain.id}: rule is missing name, specification, or title`
      );
      continue;
    }
    if (!domain.specifications?.includes(rule.specification)) {
      failures.push(
        `${domain.id}: rule ${JSON.stringify(rule.name)} references undeclared specification ${rule.specification}`
      );
      continue;
    }

    const rulePath = resolve(root, rule.specification);
    if (!existsSync(rulePath)) continue;
    if (!readFileSync(rulePath, 'utf8').includes(rule.title)) {
      failures.push(
        `${domain.id}: rule ${JSON.stringify(rule.name)} has no matching test title in ${rule.specification}: ${JSON.stringify(rule.title)}`
      );
    }

    if (rule.journey !== undefined) {
      if (
        !Number.isInteger(rule.journey) ||
        rule.journey < 1 ||
        rule.journey > 13
      ) {
        failures.push(
          `${domain.id}: rule ${JSON.stringify(rule.name)} has invalid journey ${rule.journey}`
        );
      }
      if (!journeys.includes(rule.journey)) {
        failures.push(
          `${domain.id}: rule ${JSON.stringify(rule.name)} journey ${rule.journey} is not declared by the domain`
        );
      }
      if (rule.specification !== 'e2e/journeys.spec.ts') {
        failures.push(
          `${domain.id}: rule ${JSON.stringify(rule.name)} declares a journey but is not mapped to e2e/journeys.spec.ts`
        );
      }
    }
  }
}

for (const id of requiredDomainIds) {
  if (!seenIds.has(id)) failures.push(`missing required business domain ${id}`);
}

if (failures.length > 0) {
  throw new Error(
    `Business-logic ownership check failed:\n${failures.join('\n')}`
  );
}

console.warn(
  `Business-logic ownership verified for ${manifest.domains.length} domains.`
);
