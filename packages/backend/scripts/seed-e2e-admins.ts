import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const usernamePattern =
  process.env.POMI_E2E_ADMIN_USERNAME_PATTERN ??
  'testuser_e2e_admin_{repeatIndex}_{parallelIndex}';
const password = process.env.POMI_E2E_ADMIN_PASSWORD ?? 'testpass123';
const repeatCount = Number(process.env.POMI_E2E_ADMIN_REPEAT_COUNT ?? '1');
const parallelCount = Number(process.env.POMI_E2E_ADMIN_PARALLEL_COUNT ?? '7');

if (!usernamePattern.includes('{repeatIndex}')) {
  throw new Error('Admin username pattern must include {repeatIndex}');
}
if (!usernamePattern.includes('{parallelIndex}')) {
  throw new Error('Admin username pattern must include {parallelIndex}');
}

async function run() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
      for (
        let parallelIndex = 0;
        parallelIndex < parallelCount;
        parallelIndex += 1
      ) {
        const username = usernamePattern
          .replaceAll('{repeatIndex}', String(repeatIndex))
          .replaceAll('{parallelIndex}', String(parallelIndex));
        await client.query(
          `INSERT INTO users (id, username, password, "isAdmin", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, TRUE, NOW(), NOW())
           ON CONFLICT (username) DO UPDATE
           SET password = EXCLUDED.password, "isAdmin" = TRUE, "updatedAt" = NOW()`,
          [randomUUID(), username, hashedPassword]
        );
      }
    }
  } finally {
    await client.end();
  }

  process.stdout.write(
    `Provisioned ${repeatCount * parallelCount} isolated E2E administrators.\n`
  );
}

void run();
