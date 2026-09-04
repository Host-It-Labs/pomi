export {};

if (!process.env.DATABASE_URL) {
  const dbPort = process.env.POMI_DB_PORT || '5433';
  process.env.DATABASE_URL = `postgres://user:password@localhost:${dbPort}/pomodoro`;
}

const username = process.env.POMI_COPYME_USERNAME || 'copyme';
const password = process.env.POMI_COPYME_PASSWORD || username;
const fixtureName = process.env.POMI_COPYME_FIXTURE_NAME || 'copyme';

process.stdout.write(
  'Rebuilding disposable Copyme fixture; existing Copyme data will be deleted.\n'
);

void import('./seed-user-fixture').then(({ runSeedUserFixture }) =>
  runSeedUserFixture({
    username,
    password,
    successLabel: 'Copyme user',
    isAdmin: true,
    includeCanonicalLists: true,
    fixtureMarker: { fixtureName, seedVersion: 16 },
  })
);
