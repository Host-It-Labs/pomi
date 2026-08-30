import { describe, expect, it, vi } from 'vitest';
import { AssistantCaptureService } from '../../src/assistant/assistant-capture.service';
import type { PreparedAssistantTaskCapture } from '../../src/assistant/assistant-task-preparation.store';

describe('Assistant task capture commit', () => {
  it('rejects prepared List drafts when Lists were disabled after preparation', async () => {
    const recordLog = vi.fn(async () => undefined);
    const service = new AssistantCaptureService(
      {} as never,
      {
        getPreferences: vi.fn(async () => ({
          language: 'en',
          listsExtension: false,
        })),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      { recordLog } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    const prepared: PreparedAssistantTaskCapture = {
      normalizedText: 'Add milk to Groceries',
      listId: null,
      responseLanguage: 'en',
      debugLogId: null,
      taskDrafts: [{ title: 'Milk', listId: 'list-1' }],
      usedFallback: false,
      invalidParserOutput: null,
      interpretationError: null,
      resolutionNotes: [],
      modelCalls: [],
      timings: {},
      preparationMs: 0,
      costUsd: 0,
    };
    const commitTaskCapture = (
      service as unknown as {
        commitTaskCapture(
          userId: string,
          capture: PreparedAssistantTaskCapture,
          listId?: string | null
        ): Promise<unknown>;
      }
    ).commitTaskCapture.bind(service);

    await expect(commitTaskCapture('user-1', prepared)).rejects.toThrow(
      'That List is unavailable. Choose an existing List before saving'
    );
    expect(recordLog).toHaveBeenCalledOnce();
  });
});
