import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetFeedbackRecorderForTests,
  useFeedbackRecorderStore,
} from './FeedbackRecorder';

const mocks = vi.hoisted(() => ({
  transcribe: vi.fn(),
  submitUserMutation: vi.fn(),
}));

vi.mock('../../utils/apiClient', () => ({
  apiClient: { feedback: { transcribe: mocks.transcribe } },
}));
vi.mock('../../utils/userActionQueue', () => ({
  submitUserMutation: mocks.submitUserMutation,
}));
vi.mock('../../utils/blobToBase64', () => ({
  blobToBase64: vi.fn(async (blob: Blob) => await blob.text()),
}));
vi.mock('../toast/ToastContext', () => ({
  showToastFromStore: vi.fn(),
}));

describe('FeedbackRecorder browser segmentation', () => {
  const recorders: FakeMediaRecorder[] = [];

  class FakeMediaRecorder {
    state = 'inactive';
    mimeType = 'audio/webm';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;

    constructor(_stream: MediaStream) {
      recorders.push(this);
    }

    start() {
      this.state = 'recording';
    }

    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({
        data: new Blob([`segment-${recorders.indexOf(this) + 1}`], {
          type: this.mimeType,
        }),
      });
      this.onstop?.();
    }
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    recorders.length = 0;
    mocks.transcribe.mockReset();
    mocks.submitUserMutation.mockReset();
    mocks.transcribe
      .mockResolvedValueOnce({
        status: 200,
        body: { transcript: 'First', costUsd: 0 },
      })
      .mockResolvedValueOnce({
        status: 200,
        body: { transcript: 'Second', costUsd: 0 },
      });
    mocks.submitUserMutation.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  });

  afterEach(() => {
    resetFeedbackRecorderForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('starts a fresh recorder for each submitted minute', async () => {
    await useFeedbackRecorderStore.getState().startRecording();
    vi.advanceTimersByTime(60 * 1000);

    expect(recorders).toHaveLength(2);
    useFeedbackRecorderStore.getState().stopRecording();

    await vi.waitFor(() => expect(mocks.transcribe).toHaveBeenCalledTimes(2));
    expect(
      mocks.transcribe.mock.calls.map(call => call[0].body.audioBase64)
    ).toEqual(['segment-1', 'segment-2']);
    expect(mocks.submitUserMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ text: 'First Second' }),
      })
    );
  });
});
