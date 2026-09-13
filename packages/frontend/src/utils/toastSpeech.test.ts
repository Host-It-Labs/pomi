import { afterEach, describe, expect, it, vi } from 'vitest';
import { createToastSpeechAdapter } from './toastSpeech';

describe('toast speech adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cancels stale speech before speaking in the active language', () => {
    const cancel = vi.fn();
    const speak = vi.fn();
    class Utterance {
      lang = '';
      constructor(readonly text: string) {}
    }
    vi.stubGlobal('speechSynthesis', { cancel, speak });
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);

    createToastSpeechAdapter().speak('Saved', 'fr-CH');

    expect(cancel).toHaveBeenCalledOnce();
    expect(speak).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Saved', lang: 'fr-CH' })
    );
  });

  it('falls back silently when speech is unavailable', () => {
    vi.stubGlobal('speechSynthesis', undefined);
    expect(() => createToastSpeechAdapter().speak('Saved', 'en')).not.toThrow();
  });
});
