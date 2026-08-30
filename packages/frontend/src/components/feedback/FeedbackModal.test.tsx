import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { submitUserMutation } from '../../utils/userActionQueue';
import {
  resetFeedbackRecorderForTests,
  useFeedbackRecorderStore,
} from './FeedbackRecorder';
import { FeedbackModal } from './FeedbackModal';

const mocks = vi.hoisted(() => ({
  getUserMedia: vi.fn(),
  transcribe: vi.fn(),
}));

vi.mock('../../utils/userActionQueue', () => ({
  submitUserMutation: vi.fn(),
}));

vi.mock('../toast/ToastContext', () => ({
  showToastFromStore: vi.fn(),
}));

vi.mock('../../utils/apiClient', () => ({
  apiClient: { feedback: { transcribe: mocks.transcribe } },
}));

vi.mock('../../utils/blobToBase64', () => ({
  blobToBase64: vi.fn(async () => 'audio-data'),
}));

describe('FeedbackModal', () => {
  afterEach(() => {
    resetFeedbackRecorderForTests();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    mocks.getUserMedia.mockReset();
    mocks.transcribe.mockReset();
    vi.mocked(submitUserMutation).mockReset();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: mocks.getUserMedia },
    });
  });

  it('opens with typed feedback focused and offers recording in the header', () => {
    render(<FeedbackModal isOpen onClose={vi.fn()} />);

    expect(
      screen.getByPlaceholderText('What should we improve?')
    ).toHaveFocus();
    expect(
      screen.getByRole('button', { name: 'Record feedback' })
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Type feedback/ })).toBeNull();
    expect(mocks.getUserMedia).not.toHaveBeenCalled();
  });

  it('closes untouched feedback without a confirmation', () => {
    const onClose = vi.fn();
    render(<FeedbackModal isOpen onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(
      screen.queryByText('Submit this feedback before closing?')
    ).toBeNull();
  });

  it('asks before discarding typed feedback', () => {
    render(<FeedbackModal isOpen onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('What should we improve?'), {
      target: { value: 'The mobile list is difficult to use.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(
      screen.getByText('Submit this feedback before closing?')
    ).toBeVisible();
  });

  it('preserves typed feedback when the parent rerenders while open', () => {
    const { rerender } = render(
      <FeedbackModal isOpen onClose={() => undefined} />
    );

    fireEvent.change(screen.getByPlaceholderText('What should we improve?'), {
      target: { value: 'Keep this draft while the app updates.' },
    });

    rerender(<FeedbackModal isOpen onClose={() => undefined} />);

    expect(
      screen.getByPlaceholderText('What should we improve?')
    ).toBeVisible();
    expect(
      (
        screen.getByPlaceholderText(
          'What should we improve?'
        ) as HTMLTextAreaElement
      ).value
    ).toBe('Keep this draft while the app updates.');
  });

  it('closes after recording starts and leaves cancellation to the global recorder', async () => {
    const stopTrack = vi.fn();
    mocks.getUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: stopTrack }],
    });
    class FakeMediaRecorder {
      state = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['voice']) });
        this.onstop?.();
      }
    }
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const onClose = vi.fn();
    render(<FeedbackModal isOpen onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Record feedback' }));
    await waitFor(() =>
      expect(useFeedbackRecorderStore.getState().stage).toBe('recording')
    );

    expect(useFeedbackRecorderStore.getState().stage).toBe('recording');
    expect(onClose).toHaveBeenCalledOnce();
    useFeedbackRecorderStore.getState().cancelRecording();
    expect(useFeedbackRecorderStore.getState().stage).toBe('idle');
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(submitUserMutation).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalled();
  });

  it('keeps recording after the modal unmounts and submits exactly once', async () => {
    mocks.transcribe.mockResolvedValue({
      status: 200,
      body: { transcript: 'Keep this feedback', costUsd: 0 },
    });
    const stopTrack = vi.fn();
    mocks.getUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: stopTrack }],
    });
    class FakeMediaRecorder {
      state = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['voice']) });
        this.onstop?.();
      }
    }
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

    const onClose = vi.fn();
    const first = render(<FeedbackModal isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record feedback' }));
    await waitFor(() =>
      expect(useFeedbackRecorderStore.getState().stage).toBe('recording')
    );
    expect(onClose).toHaveBeenCalledOnce();
    first.unmount();

    useFeedbackRecorderStore.getState().stopRecording();
    useFeedbackRecorderStore.getState().stopRecording();

    await waitFor(() => expect(mocks.transcribe).toHaveBeenCalledOnce());
    await waitFor(() => expect(submitUserMutation).toHaveBeenCalledOnce());
    expect(stopTrack).toHaveBeenCalledOnce();
  });

  it('keeps the modal open while microphone startup is pending', async () => {
    mocks.getUserMedia.mockReturnValue(new Promise(() => undefined));
    vi.stubGlobal('MediaRecorder', class {});
    const onClose = vi.fn();
    render(<FeedbackModal isOpen onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Record feedback' }));

    await waitFor(() =>
      expect(useFeedbackRecorderStore.getState().stage).toBe('starting')
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByPlaceholderText('What should we improve?')
    ).toBeVisible();
  });

  it('releases an acquired stream when recorder startup fails', async () => {
    const stopTrack = vi.fn();
    mocks.getUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: stopTrack }],
    });
    vi.stubGlobal(
      'MediaRecorder',
      class {
        constructor() {
          throw new Error('Recorder unavailable');
        }
      }
    );
    const onClose = vi.fn();
    render(<FeedbackModal isOpen onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Record feedback' }));

    await waitFor(() => expect(stopTrack).toHaveBeenCalledOnce());
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'Microphone permission was not granted. You can type instead.'
      )
    ).toBeVisible();
  });
});
