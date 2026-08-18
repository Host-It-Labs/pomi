import { apiContract } from '@pomi/shared/src/api/contract';
import { generateOpenApi } from '@ts-rest/open-api';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const document = generateOpenApi(apiContract, {
  info: {
    title: 'Pomi API',
    version: '1.0.0',
  },
});

const outputPath = resolve(__dirname, '..', 'openapi.json');
writeFileSync(outputPath, JSON.stringify(document, null, 2));
