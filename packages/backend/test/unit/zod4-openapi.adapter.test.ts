import { apiContract } from '@pomi/shared';
import { generateOpenApi } from '@ts-rest/open-api';
import { expect, test } from 'vitest';

test('Zod 4 contracts retain OpenAPI parameter and response schemas', () => {
  const document = generateOpenApi(apiContract as never, {
    info: { title: 'Pomi test API', version: '1' },
  }) as unknown as {
    paths: Record<
      string,
      {
        get: {
          parameters: Array<{ name: string; schema: Record<string, unknown> }>;
          responses: Record<
            string,
            {
              content: Record<
                string,
                { schema: { properties: Record<string, unknown> } }
              >;
            }
          >;
        };
      }
    >;
  };
  const archive = document.paths['/tasks/archive'].get;

  expect(archive.parameters).toContainEqual(
    expect.objectContaining({
      name: 'limit',
      schema: expect.objectContaining({
        type: 'integer',
        minimum: 1,
        maximum: 100,
      }),
    })
  );
  expect(
    archive.responses['200'].content['application/json'].schema.properties
  ).toEqual(
    expect.objectContaining({
      items: expect.objectContaining({ type: 'array' }),
      nextCursor: expect.objectContaining({ nullable: true }),
    })
  );
});
