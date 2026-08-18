import { spawnSync } from 'node:child_process';

for (let seed = 1; seed <= 10; seed += 1) {
  for (const script of ['test:unit', 'test:integration']) {
    process.stderr.write(`${script}, shuffled seed ${seed}/10\n`);
    const result = spawnSync(
      'pnpm',
      [
        script,
        '--',
        '--sequence.shuffle',
        `--sequence.seed=${seed}`,
      ],
      {
        env: { ...process.env, POMI_TEST_SEED: String(seed) },
        stdio: 'inherit',
      }
    );
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
