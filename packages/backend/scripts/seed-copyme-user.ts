export {};

if (!process.env.DATABASE_URL) {
  const dbPort = process.env.POMI_DB_PORT || '5433';
  process.env.DATABASE_URL = `postgres://user:password@localhost:${dbPort}/pomodoro`;
}

const username = process.env.POMI_COPYME_USERNAME || 'copyme';
const password = process.env.POMI_COPYME_PASSWORD || username;
const fixtureName = process.env.POMI_COPYME_FIXTURE_NAME || 'copyme';

void import('./seed-user-fixture').then(({ runEnsureSeedUserFixture }) =>
  runEnsureSeedUserFixture({
    username,
    password,
    successLabel: 'Copyme user',
    isAdmin: true,
    fixtureMarker: { fixtureName, seedVersion: 5 },
  })
);
