import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

const require = createRequire(
  new URL('../packages/shared/package.json', import.meta.url)
);
const { z: zod3 } = require('zod/v3');
const { z: zod4 } = require('zod/v4');

const ITERATIONS = 100_000;
const SAMPLE_COUNT = 40;
const WARMUP_ITERATIONS = 20_000;

function createObjectSchema(z) {
  return z.object({
    id: z.string(),
    title: z.string(),
    priority: z.number(),
    active: z.boolean(),
  });
}

const objectValue = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  title: 'Review the performance implementation',
  priority: 2,
  active: true,
};
const arrayValue = Array.from({ length: 100 }, (_, index) => index);

const schemas = {
  object: {
    zod3: createObjectSchema(zod3),
    zod4: createObjectSchema(zod4),
    value: objectValue,
  },
  array: {
    zod3: zod3.array(zod3.number()),
    zod4: zod4.array(zod4.number()),
    value: arrayValue,
  },
};

for (let index = 0; index < WARMUP_ITERATIONS; index += 1) {
  schemas.object.zod3.parse(objectValue);
  schemas.object.zod4.parse(objectValue);
  schemas.array.zod3.parse(arrayValue);
  schemas.array.zod4.parse(arrayValue);
}

function measure(schema, value) {
  const startedAt = performance.now();
  for (let index = 0; index < ITERATIONS; index += 1) {
    schema.parse(value);
  }
  return performance.now() - startedAt;
}

function benchmarkCase({ zod3: legacySchema, zod4: currentSchema, value }) {
  const legacySamples = [];
  const currentSamples = [];
  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    const order =
      sample % 2 === 0
        ? [
            [legacySchema, legacySamples],
            [currentSchema, currentSamples],
          ]
        : [
            [currentSchema, currentSamples],
            [legacySchema, legacySamples],
          ];
    for (const [schema, samples] of order) {
      samples.push(measure(schema, value));
    }
  }
  legacySamples.sort((left, right) => left - right);
  currentSamples.sort((left, right) => left - right);
  const zod3Result = {
    medianMs: legacySamples[Math.floor(legacySamples.length / 2)],
    p95Ms: legacySamples[Math.floor(legacySamples.length * 0.95) - 1],
  };
  const zod4Result = {
    medianMs: currentSamples[Math.floor(currentSamples.length / 2)],
    p95Ms: currentSamples[Math.floor(currentSamples.length * 0.95) - 1],
  };
  return {
    zod3: zod3Result,
    zod4: zod4Result,
    medianSpeedup: zod3Result.medianMs / zod4Result.medianMs,
    p95Speedup: zod3Result.p95Ms / zod4Result.p95Ms,
  };
}

const results = {
  iterationsPerSample: ITERATIONS,
  samples: SAMPLE_COUNT,
  object: benchmarkCase(schemas.object),
  array: benchmarkCase(schemas.array),
};

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
if (
  results.object.medianSpeedup < 2 ||
  results.object.p95Speedup < 2 ||
  results.array.medianSpeedup < 2 ||
  results.array.p95Speedup < 2
) {
  process.exitCode = 1;
}
