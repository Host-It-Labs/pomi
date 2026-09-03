import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStoreBase } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { submitUserMutation } from '../../utils/userActionQueue';
import { FeedbackRecorder } from './FeedbackRecorder';
import {
  resetFeedbackRecorderForTests,
  useFeedbackRecorderStore,
} from './FeedbackRecorder';

const mocks = vi.hoisted(() => ({
  getUserMedia: vi.fn(),
  transcribe: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../utils/userActionQueue', () => ({
  submitUserMutation: vi.fn(),
}));

vi.mock('../../utils/apiClient', () => ({
  apiClient: { feedback: { transcribe: mocks.transcribe } },
}));

vi.mock('../../utils/blobToBase64', () => ({
  blobToBase64: vi.fn(async () => 'audio-data'),
}));

vi.mock('../toast/ToastContext', () => ({
  showToastFromStore: mocks.showToast,
}));

function Harness() {
  return (
    <>
      <div id="assistant-session-slot-timer" />
      <FeedbackRecorder />
    </>
  );
}

function createRecorderClass(options?: { startError?: Error }) {
  let latest: FakeMediaRecorder | null = null;
  const instances: FakeMediaRecorder[] = [];

  class FakeMediaRecorder {
    state = 'inactive';
    mimeType = 'audio/webm';
    stopCalls = 0;
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;

    constructor(_stream: MediaStream) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- retain the fake instance for assertions
      latest = this;
      instances.push(this);
    }

    start() {
      if (options?.startError) throw options.startError;
      this.state = 'recording';
    }

    stop() {
      this.stopCalls += 1;
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['voice']) });
      this.onstop?.();
    }
  }

  return {
    Recorder: FakeMediaRecorder,
    getLatest: () => latest,
    getInstances: () => instances,
  };
}

describe('FeedbackRecorder', () => {
  beforeEach(() => {
    resetFeedbackRecorderForTests();
    mocks.getUserMedia.mockReset();
    mocks.transcribe.mockReset();
    mocks.showToast.mockReset();
    vi.mocked(submitUserMutation).mockReset();
    vi.mocked(submitUserMutation).mockResolvedValue(undefined);
    mocks.getUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: mocks.getUserMedia },
    });
    useAuthStoreBase.setState({
      token: 'token-a',
      isAuthenticated: true,
    });
    useUiStore.setState({ expanded: true, activeTab: 'timer' });
  });

  afterEach(() => {
    resetFeedbackRecorderForTests();
    useAuthStoreBase.setState({
      token: null,
      user: null,
      isAuthenticated: false,
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    vi.unstubAllGlobals();
  });

  it('only enters recording after MediaRecorder.start succeeds', async () => {
    const stopTrack = vi.fn();
    mocks.getUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: stopTrack }],
    });
    const { Recorder } = createRecorderClass({
      startError: new Error('Recorder unavailable'),
    });
    vi.stubGlobal('MediaRecorder', Recorder);
    render(<Harness />);

    await act(async () => {
      await useFeedbackRecorderStore.getState().startRecording();
    });

    expect(useFeedbackRecorderStore.getState().stage).toBe('error');
    expect(stopTrack).toHaveBeenCalledOnce();
  });

  it('stops and submits exactly once from the application-scoped control', async () => {
    const { Recorder, getLatest } = createRecorderClass();
    vi.stubGlobal('MediaRecorder', Recorder);
    mocks.transcribe.mockResolvedValue({
      status: 200,
      body: { transcript: 'Voice feedback', costUsd: 0 },
    });
    render(<Harness />);

    await act(async () => {
      await useFeedbackRecorderStore.getState().startRecording();
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Stop feedback recording' })
      ).toBeVisible()
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Stop feedback recording' })
    );
    useFeedbackRecorderStore.getState().stopRecording();

    await waitFor(() => expect(mocks.transcribe).toHaveBeenCalledOnce());
    await waitFor(() => expect(submitUserMutation).toHaveBeenCalledOnce());
    expect(getLatest()?.stopCalls).toBe(1);
  });

  it('rotates complete recorder segments before transcribing them', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { Recorder, getInstances } = createRecorderClass();
    vi.stubGlobal('MediaRecorder', Recorder);
    mocks.transcribe
      .mockResolvedValueOnce({
        status: 200,
        body: { transcript: 'First minute', costUsd: 0 },
      })
      .mockResolvedValueOnce({
        status: 200,
        body: { transcript: 'Second minute', costUsd: 0 },
      });
    render(<Harness />);

    await act(async () => {
      await useFeedbackRecorderStore.getState().startRecording();
    });
    act(() => {
      vi.advanceTimersByTime(60 * 1000);
    });

    expect(getInstances()).toHaveLength(2);
    expect(getInstances()[0].stopCalls).toBe(1);

    useFeedbackRecorderStore.getState().stopRecording();

    await waitFor(() => expect(mocks.transcribe).toHaveBeenCalledTimes(2));
    expect(submitUserMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          text: 'First minute Second minute',
        }),
      })
    );
    const firstKey = mocks.transcribe.mock.calls[0][0].body.idempotencyKey;
    const secondKey = mocks.transcribe.mock.calls[1][0].body.idempotencyKey;
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(secondKey).not.toBe(firstKey);
    vi.useRealTimers();
  });

  it('discards the recording when authentication is lost', async () => {
    const stopTrack = vi.fn();
    mocks.getUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: stopTrack }],
    });
    const { Recorder, getLatest } = createRecorderClass();
    vi.stubGlobal('MediaRecorder', Recorder);
    render(<Harness />);

    await act(async () => {
      await useFeedbackRecorderStore.getState().startRecording();
    });
    await waitFor(() =>
      expect(useFeedbackRecorderStore.getState().stage).toBe('recording')
    );

    act(() => {
      useAuthStoreBase.setState({ token: null, isAuthenticated: false });
    });

    await waitFor(() =>
      expect(useFeedbackRecorderStore.getState().stage).toBe('idle')
    );
    expect(getLatest()?.stopCalls).toBe(1);
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it('auto-stops and submits when the app is backgrounded', async () => {
    const { Recorder, getLatest } = createRecorderClass();
    vi.stubGlobal('MediaRecorder', Recorder);
    mocks.transcribe.mockResolvedValue({
      status: 200,
      body: { transcript: 'Backgrounded feedback', costUsd: 0 },
    });
    render(<Harness />);

    await act(async () => {
      await useFeedbackRecorderStore.getState().startRecording();
    });
    await waitFor(() =>
      expect(useFeedbackRecorderStore.getState().stage).toBe('recording')
    );

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(mocks.transcribe).toHaveBeenCalledOnce());
    await waitFor(() => expect(submitUserMutation).toHaveBeenCalledOnce());
    expect(getLatest()?.stopCalls).toBe(1);
    expect(mocks.showToast).toHaveBeenCalledWith(
      'Recording stopped while app was backgrounded.',
      'info'
    );
  });
});
