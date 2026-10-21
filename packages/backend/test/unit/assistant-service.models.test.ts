import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantService } from '../../src/assistant/assistant.service';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('AssistantService model list', () => {
  it.each([{ inputModalities: 'text', outputModalities: 'text' }, {}])(
    'requires structured text output for %j',
    async filter => {
      vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'structured-text',
                architecture: {
                  input_modalities: ['text'],
                  output_modalities: ['text'],
                },
                supported_parameters: ['response_format', 'structured_outputs'],
              },
              ...[['response_format'], [], undefined].map(
                (supportedParameters, index) => ({
                  id: `unstructured-text-${index}`,
                  architecture: {
                    input_modalities: ['text'],
                    output_modalities: ['text'],
                  },
                  supported_parameters: supportedParameters,
                })
              ),
              {
                id: 'structured-image',
                architecture: {
                  input_modalities: ['text'],
                  output_modalities: ['image'],
                },
                supported_parameters: ['structured_outputs'],
              },
            ],
          }),
        }))
      );
      const service = new AssistantService(
        {} as never,
        {} as never,
        {} as never
      );

      const models = await service.listModels(filter);

      expect(models).toEqual([
        {
          id: 'structured-text',
          name: 'structured-text',
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportedParameters: ['response_format', 'structured_outputs'],
          supportedVoices: null,
        },
      ]);
    }
  );

  it.each([
    ['audio', 'transcription', ['transcription', 'text']],
    ['text', 'speech', ['speech']],
    ['text', 'audio', ['audio']],
    ['text', 'image', ['image']],
  ])(
    'keeps %s-to-%s models without structured output support',
    async (inputModality, outputModality, outputModalities) => {
      vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
      const fetch = vi.fn(async (_input: string) => ({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'other-model',
              architecture: {
                input_modalities: [inputModality],
                output_modalities: outputModalities,
              },
            },
          ],
        }),
      }));
      vi.stubGlobal('fetch', fetch);
      const service = new AssistantService(
        {} as never,
        {} as never,
        {} as never
      );

      const models = await service.listModels({
        inputModalities: inputModality,
        outputModalities: outputModality,
      });

      expect(models.map(model => model.id)).toEqual(['other-model']);
      const url = new URL(fetch.mock.calls[0][0]);
      expect(url.searchParams.get('output_modalities')).toBe(outputModality);
    }
  );
});
