import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { FaMicrophoneSlash, FaSpinner, FaStop } from 'react-icons/fa';
import { apiClient } from '../../utils/apiClient';
import { blobToBase64 } from '../../utils/blobToBase64';
import { platformName } from '../../utils/osUtils';
import { submitUserMutation } from '../../utils/userActionQueue';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { createSelectors } from '../../stores/createSelectors';
import { showToastFromStore } from '../toast/ToastContext';
import { getLanguage, translate, useI18n } from '../../i18n';

export type FeedbackRecordingStage =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'sending'
  | 'error';

type FeedbackRecorderState = {
  stage: FeedbackRecordingStage;
  seconds: number;
  error: string;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  cancelRecording: () => void;
};

const MAX_RECORDING_SECONDS = 10 * 60;

let mediaRecorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let stopIntent: 'submit' | 'cancel' = 'cancel';
let recordingRequest = 0;
let submissionRequest = 0;
let recordingStartedAt: number | null = null;

function feedbackText(key: string) {
  return translate(key, undefined, getLanguage());
}

function stopStream(value: MediaStream | null) {
  value?.getTracks().forEach(track => track.stop());
}

function cleanupRecorder(expectedRecorder?: MediaRecorder) {
  if (expectedRecorder && mediaRecorder !== expectedRecorder) return;
  stopStream(stream);
  stream = null;
  mediaRecorder = null;
  recordingStartedAt = null;
}

export async function submitFeedbackText(feedback: string) {
  const text = feedback.trim();
  if (!text) throw new Error(feedbackText('feedback.addFirst'));

  await submitUserMutation({
    kind: 'feedback',
    label: feedbackText('feedback.send'),
    payload: {
      operation: 'submit',
      text,
      diagnostics: {
        appVersion: String(import.meta.env.VITE_APP_VERSION ?? 'unknown'),
        platform: platformName,
        path: window.location.pathname,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
      },
    },
  });
}

async function submitVoice(blob: Blob, mimeType: string, request: number) {
  try {
    const response = await apiClient.feedback.transcribe({
      body: { audioBase64: await blobToBase64(blob), mimeType },
    });
    if (request !== submissionRequest) return;
    if (response.status !== 200) {
      throw new Error(feedbackText('feedback.transcribeFailed'));
    }

    await submitFeedbackText(response.body.transcript);
    if (request !== submissionRequest) return;
    showToastFromStore(feedbackText('feedback.sentThankYou'), 'success');
    useFeedbackRecorderStoreBase.setState({ stage: 'idle', error: '' });
  } catch (error) {
    if (request !== submissionRequest) return;
    useFeedbackRecorderStoreBase.setState({
      stage: 'error',
      error:
        error instanceof Error
          ? error.message
          : feedbackText('feedback.sendFailed'),
    });
  }
}

const useFeedbackRecorderStoreBase = create<FeedbackRecorderState>(
  (set, get) => ({
    stage: 'idle',
    seconds: 0,
    error: '',
    startRecording: async () => {
      if (
        get().stage === 'starting' ||
        get().stage === 'recording' ||
        get().stage === 'sending'
      ) {
        return;
      }
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === 'undefined'
      ) {
        set({
          stage: 'error',
          error: feedbackText('feedback.microphoneUnavailable'),
        });
        return;
      }

      const request = ++recordingRequest;
      submissionRequest += 1;
      stopIntent = 'cancel';
      recordingStartedAt = null;
      set({ stage: 'starting', seconds: 0, error: '' });

      try {
        const nextStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        if (request !== recordingRequest) {
          stopStream(nextStream);
          return;
        }

        stream = nextStream;
        const recorder = new MediaRecorder(nextStream);
        mediaRecorder = recorder;
        const recordedChunks: Blob[] = [];
        recorder.ondataavailable = event => {
          if (event.data.size > 0) recordedChunks.push(event.data);
        };
        recorder.onstop = () => {
          const intent = stopIntent;
          const recordedMimeType =
            recorder.mimeType || recordedChunks[0]?.type || 'audio/webm';
          const isCurrentRequest = request === recordingRequest;
          cleanupRecorder(recorder);

          if (!isCurrentRequest || intent !== 'submit') return;
          if (recordedChunks.length === 0) {
            set({ stage: 'error', error: feedbackText('feedback.noSpeech') });
            return;
          }

          const nextSubmissionRequest = ++submissionRequest;
          set({ stage: 'sending', error: '' });
          void submitVoice(
            new Blob(recordedChunks, { type: recordedMimeType }),
            recordedMimeType,
            nextSubmissionRequest
          );
        };
        recorder.start();
        if (request !== recordingRequest) {
          recorder.stop();
          return;
        }
        recordingStartedAt = Date.now();
        set({ stage: 'recording', seconds: 0, error: '' });
      } catch {
        cleanupRecorder();
        if (request !== recordingRequest) return;
        set({
          stage: 'error',
          error: feedbackText('feedback.permissionDenied'),
        });
      }
    },
    stopRecording: () => {
      if (get().stage !== 'recording') return;
      stopIntent = 'submit';
      set({ stage: 'sending', error: '' });
      const recorder = mediaRecorder;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
        return;
      }
      cleanupRecorder(recorder ?? undefined);
      set({ stage: 'error', error: feedbackText('feedback.noSpeech') });
    },
    cancelRecording: () => {
      stopIntent = 'cancel';
      recordingRequest += 1;
      submissionRequest += 1;
      const recorder = mediaRecorder;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      cleanupRecorder(recorder ?? undefined);
      set({ stage: 'idle', seconds: 0, error: '' });
    },
  })
);

export const useFeedbackRecorderStore = createSelectors(
  useFeedbackRecorderStoreBase
);

export function resetFeedbackRecorderForTests() {
  useFeedbackRecorderStoreBase.getState().cancelRecording();
  useFeedbackRecorderStoreBase.setState({
    stage: 'idle',
    seconds: 0,
    error: '',
  });
}

export function FeedbackRecorder() {
  const { t } = useI18n();
  const stage = useFeedbackRecorderStore.use.stage();
  const seconds = useFeedbackRecorderStore.use.seconds();
  const startRecording = useFeedbackRecorderStore.use.startRecording();
  const stopRecording = useFeedbackRecorderStore.use.stopRecording();
  const cancelRecording = useFeedbackRecorderStore.use.cancelRecording();
  const expanded = useUiStore.use.expanded();
  const activeTab = useUiStore.use.activeTab();
  const authToken = useAuthStore.use.token();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const previousAuthTokenRef = useRef(authToken);

  useEffect(() => {
    if (stage !== 'recording') return;

    const interval = window.setInterval(() => {
      const startedAt = recordingStartedAt;
      if (startedAt === null) return;
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      useFeedbackRecorderStoreBase.setState({ seconds: elapsed });
      if (elapsed >= MAX_RECORDING_SECONDS) {
        showToastFromStore(t('feedback.maximumDuration'), 'info');
        stopRecording();
      }
    }, 500);
    return () => window.clearInterval(interval);
  }, [stage, stopRecording]);

  useEffect(() => {
    if (stage !== 'recording') return;
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        showToastFromStore(t('feedback.backgroundStopped'), 'info');
        stopRecording();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () =>
      document.removeEventListener('visibilitychange', handleVisibility);
  }, [stage, stopRecording]);

  useEffect(() => {
    if (
      previousAuthTokenRef.current !== authToken &&
      (stage === 'starting' || stage === 'recording')
    ) {
      cancelRecording();
      showToastFromStore(t('feedback.discardedAfterSignOut'), 'info');
    }
    previousAuthTokenRef.current = authToken;
  }, [authToken, cancelRecording, stage]);

  useEffect(
    () => () => {
      useFeedbackRecorderStoreBase.getState().cancelRecording();
    },
    []
  );

  useLayoutEffect(() => {
    const slotId = !expanded
      ? 'feedback-session-slot-compact'
      : activeTab === 'timer'
        ? 'feedback-session-slot-timer'
        : 'feedback-session-slot-page';
    setPortalTarget(document.getElementById(slotId));
  }, [activeTab, expanded, stage]);

  if (stage === 'idle' || stage === 'starting' || !portalTarget) return null;

  const control =
    stage === 'recording' ? (
      <div className="relative z-[1100] flex items-center">
        <button
          type="button"
          onClick={cancelRecording}
          className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] text-slate-400 hover:text-white"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          aria-label={t('feedback.stopRecording')}
          title={t('feedback.stopRecording')}
          onClick={stopRecording}
          className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-red-600 text-white shadow-sm shadow-red-950/30 transition hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-400/60"
        >
          <FaStop size={9} />
        </button>
        <span
          data-testid="feedback-recording-elapsed"
          className="ml-1.5 whitespace-nowrap font-mono text-[10px] tabular-nums text-slate-300"
        >
          {formatDuration(seconds)}
        </span>
      </div>
    ) : stage === 'sending' ? (
      <div
        role="status"
        aria-label={t('feedback.sending')}
        title={t('feedback.sending')}
        className="relative z-[1100] flex h-[38px] w-[38px] items-center justify-center rounded-full border border-slate-700/40 bg-indigo-600/90 text-white shadow-sm shadow-indigo-950/30"
      >
        <FaSpinner className="animate-spin" />
      </div>
    ) : (
      <div className="relative z-[1100] flex h-[38px] w-[38px] items-center justify-center">
        <button
          type="button"
          onClick={() => void startRecording()}
          aria-label={t('feedback.recordAgain')}
          title={t('feedback.recordAgain')}
          className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-red-500/40 bg-red-950/90 text-red-300 transition hover:bg-red-900/90 focus:outline-none focus:ring-2 focus:ring-red-400/60"
        >
          <FaMicrophoneSlash />
        </button>
        <button
          type="button"
          onClick={cancelRecording}
          className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] text-slate-400 hover:text-white"
        >
          {t('common.dismiss')}
        </button>
      </div>
    );

  return createPortal(control, portalTarget);
}

function formatDuration(seconds: number) {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}
