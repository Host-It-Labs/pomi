export function findUnknownAppliedMigrations(
  appliedMigrationNames: readonly string[],
  availableMigrationNames: readonly string[]
): string[] {
  const available = new Set(availableMigrationNames);

  return [
    ...new Set(appliedMigrationNames.filter(name => !available.has(name))),
  ];
}
