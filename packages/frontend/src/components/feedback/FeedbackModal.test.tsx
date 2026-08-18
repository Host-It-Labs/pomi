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

  it('waits for the user to choose recording or typing', () => {
    render(<FeedbackModal isOpen onClose={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: /^Record feedback/ })
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: /^Type feedback/ })
    ).toBeVisible();
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

    fireEvent.click(screen.getByRole('button', { name: /^Type feedback/ }));
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

    fireEvent.click(screen.getByRole('button', { name: /^Type feedback/ }));
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

  it('cancels recording without transcription or submission', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: /^Record feedback/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Stop & send/ })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(useFeedbackRecorderStore.getState().stage).toBe('idle');
    expect(onClose).toHaveBeenCalledOnce();
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
    fireEvent.click(screen.getByRole('button', { name: /^Record feedback/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Stop & send/ })).toBeEnabled()
    );
    first.unmount();

    render(<FeedbackModal isOpen onClose={onClose} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Stop & send/ })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: /Stop & send/ }));
    fireEvent.click(screen.getByRole('button', { name: /Stop & send/ }));

    await waitFor(() => expect(mocks.transcribe).toHaveBeenCalledOnce());
    await waitFor(() => expect(submitUserMutation).toHaveBeenCalledOnce());
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(stopTrack).toHaveBeenCalledOnce();
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
    render(<FeedbackModal isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /^Record feedback/ }));

    await waitFor(() => expect(stopTrack).toHaveBeenCalledOnce());
    expect(
      screen.getByText(
        'Microphone permission was not granted. You can type instead.'
      )
    ).toBeVisible();
  });
});
