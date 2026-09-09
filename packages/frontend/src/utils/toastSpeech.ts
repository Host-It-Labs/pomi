export interface ToastSpeechAdapter {
  speak(message: string, language: string): void;
  cancel(): void;
}

export function createToastSpeechAdapter(): ToastSpeechAdapter {
  const synthesis = globalThis.speechSynthesis;

  return {
    speak(message, language) {
      if (!synthesis || typeof SpeechSynthesisUtterance === 'undefined') return;
      try {
        synthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.lang = language;
        synthesis.speak(utterance);
      } catch {
        // Speech is progressive enhancement; visual and aria-live output remain.
      }
    },
    cancel() {
      try {
        synthesis?.cancel();
      } catch {
        // Unsupported engines must never affect toast presentation.
      }
    },
  };
}
