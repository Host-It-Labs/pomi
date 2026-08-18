import dataSource from '../data-source';
import { findUnknownAppliedMigrations } from '../src/development-fixtures/migration-history';

async function verifyMigrationHistory(): Promise<boolean> {
  await dataSource.initialize();

  const queryRunner = dataSource.createQueryRunner();
  try {
    if (!(await queryRunner.hasTable('migrations'))) {
      process.stdout.write(
        '[pomi] migration history is empty and compatible with this branch\n'
      );
      return true;
    }

    const appliedMigrations = (await queryRunner.query(
      `SELECT "name" FROM "migrations" ORDER BY "timestamp", "id"`
    )) as Array<{ name: string }>;
    const availableMigrationNames = dataSource.migrations.map(
      migration => migration.name || migration.constructor.name
    );
    const unknownMigrations = findUnknownAppliedMigrations(
      appliedMigrations.map(migration => migration.name),
      availableMigrationNames
    );

    if (unknownMigrations.length === 0) {
      process.stdout.write(
        '[pomi] applied migration history is compatible with this branch\n'
      );
      return true;
    }

    console.error(
      '[pomi] this database contains migrations that do not exist on the current branch:'
    );
    for (const migrationName of unknownMigrations) {
      console.error(`[pomi]   - ${migrationName}`);
    }
    console.error(
      '[pomi] reset the disposable dev database with: pnpm db:reset'
    );
    return false;
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
}

void verifyMigrationHistory()
  .then(isCompatible => {
    if (!isCompatible) process.exitCode = 2;
  })
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
