import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { v4 as uuid } from 'uuid';
import { ASSISTANT_MAX_RECORDING_MINUTES } from '@pomi/shared/src/constants';
import {
  FaMicrophone,
  FaMicrophoneSlash,
  FaSpinner,
  FaStop,
} from 'react-icons/fa';
import { showToastFromStore } from '../toast/ToastContext';
import { apiClient } from '../../utils/apiClient';
import { submitUserMutation } from '../../utils/userActionQueue';
import { blobToBase64 } from '../../utils/blobToBase64';
import { useAssistantStore } from '../../stores/assistantStore';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { useTasksStore } from '../../stores/tasksStore';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { hasOpenModal } from '../../utils/modalRegistry';
import {
  prepareAssistantVoiceWithRetry,
  waitForAssistantRetry,
} from '../../utils/assistantVoicePreparation';
import { forceReconnect } from '../../utils/socketManager';
import { IconButton } from '../ui/IconButton';
import { KeyboardShortcut } from '../ui/KeyboardShortcut';
import { useI18n } from '../../i18n';

type AssistantStage = 'idle' | 'recording' | 'processing' | 'result' | 'error';

const DEFAULT_RECORDING_MAX_MINUTES = 10;
const RECORDER_SEGMENT_MS = 60_000;

type AssistantVoiceStatus = {
  assistantRecordingMaxMinutes?: number | null;
};

type AssistantVoiceCommandBody = {
  audioBase64: string;
  mimeType: string;
};

type AssistantVoiceTranscriptBody = {
  transcript: string;
  transcriptionCostUsd: number;
  debugLogId: string | null;
};

type AssistantVoiceChunkBody = AssistantVoiceCommandBody & {
  preparationId: string;
  index: number;
  debugLogId: string | null;
};

type AssistantVoiceResult = {
  transcript: string;
  message: string;
  spokenAudioBase64: string | null;
  spokenAudioMimeType: string | null;
  tasks: unknown[];
};

function normalizeVoiceResponse(result: unknown): {
  status: number;
  body: AssistantVoiceResult;
} {
  if (
    result &&
    typeof result === 'object' &&
    'status' in result &&
    'body' in result
  ) {
    return {
      status: (result as { status: number }).status,
      body: (result as { body: AssistantVoiceResult }).body,
    };
  }
  return { status: 200, body: result as AssistantVoiceResult };
}

export function AssistantLauncher() {
  const { t } = useI18n();
  const status = useAssistantStore.use.status();
  const loadStatus = useAssistantStore.use.loadStatus();
  const loadTasks = useTasksStore.use.loadTasks();
  const preferences = usePreferencesStore.use.preferences();
  const [isOpen, setIsOpen] = useState(false);
  const [stage, setStage] = useState<AssistantStage>('idle');
  const [message, setMessage] = useState('');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const segmentChunksRef = useRef<Blob[]>([]);
  const recordingSegmentsRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelRecordingRef = useRef(false);
  const rotateRecordingRef = useRef(false);
  const rotationTimerRef = useRef<number | null>(null);
  const recordingRequestIdRef = useRef(0);
  const recordingStartedAtRef = useRef<number | null>(null);
  const expanded = useUiStore.use.expanded();
  const activeTab = useUiStore.use.activeTab();
  const authToken = useAuthStore.use.token();

  const configuredMaxRecordingMinutes = (
    status as unknown as AssistantVoiceStatus | null
  )?.assistantRecordingMaxMinutes;
  const maxRecordingMinutes = Math.min(
    configuredMaxRecordingMinutes === undefined
      ? DEFAULT_RECORDING_MAX_MINUTES
      : (configuredMaxRecordingMinutes ?? ASSISTANT_MAX_RECORDING_MINUTES),
    ASSISTANT_MAX_RECORDING_MINUTES
  );
  const maxRecordingSeconds = Math.max(1, maxRecordingMinutes * 60);

  useEffect(() => {
    if (authToken) {
      void loadStatus();
    }
  }, [authToken, loadStatus]);

  useEffect(() => {
    return () => {
      cancelRecordingRef.current = true;
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== 'inactive'
      ) {
        mediaRecorderRef.current.stop();
        return;
      }
      stopStream(streamRef.current);
    };
  }, []);

  const startRecording = useCallback(async () => {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setStage('error');
      setMessage(t('assistant.microphoneUnavailable'));
      return;
    }

    const requestId = recordingRequestIdRef.current + 1;
    recordingRequestIdRef.current = requestId;
    try {
      setMessage('');
      setStage('recording');
      setRecordingSeconds(0);
      recordingStartedAtRef.current = Date.now();
      segmentChunksRef.current = [];
      recordingSegmentsRef.current = [];
      cancelRecordingRef.current = false;
      rotateRecordingRef.current = false;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (
        requestId !== recordingRequestIdRef.current ||
        cancelRecordingRef.current
      ) {
        stopStream(stream);
        recordingStartedAtRef.current = null;
        return;
      }
      streamRef.current = stream;
      const startSegment = () => {
        const recorder = new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        segmentChunksRef.current = [];
        recorder.ondataavailable = event => {
          if (event.data.size > 0) {
            segmentChunksRef.current.push(event.data);
          }
        };
        recorder.onstop = () => {
          if (rotationTimerRef.current !== null) {
            window.clearTimeout(rotationTimerRef.current);
            rotationTimerRef.current = null;
          }
          const wasCancelled = cancelRecordingRef.current;
          const shouldRotate = rotateRecordingRef.current;
          rotateRecordingRef.current = false;
          const segmentChunks = segmentChunksRef.current;
          segmentChunksRef.current = [];
          if (segmentChunks.length > 0) {
            recordingSegmentsRef.current.push(
              new Blob(segmentChunks, { type: recorder.mimeType })
            );
          }
          if (
            shouldRotate &&
            !wasCancelled &&
            requestId === recordingRequestIdRef.current
          ) {
            startSegment();
            return;
          }

          const segments = recordingSegmentsRef.current;
          recordingSegmentsRef.current = [];
          cancelRecordingRef.current = false;
          recordingStartedAtRef.current = null;
          stopStream(stream);
          streamRef.current = null;
          mediaRecorderRef.current = null;
          if (wasCancelled) {
            return;
          }
          void submitRecording(segments, recorder.mimeType);
        };
        recorder.start();
        rotationTimerRef.current = window.setTimeout(() => {
          if (
            requestId === recordingRequestIdRef.current &&
            recorder.state !== 'inactive'
          ) {
            rotateRecordingRef.current = true;
            recorder.stop();
          }
        }, RECORDER_SEGMENT_MS);
      };
      startSegment();
    } catch (error) {
      stopStream(streamRef.current);
      streamRef.current = null;
      mediaRecorderRef.current = null;
      if (
        requestId !== recordingRequestIdRef.current ||
        cancelRecordingRef.current
      ) {
        return;
      }
      console.error('Failed to start Assistant recording:', error);
      setStage('error');
      setMessage(t('assistant.microphoneBlocked'));
      recordingStartedAtRef.current = null;
    }
  }, [t]);

  const closeAssistantResult = async (resultCompletion: Promise<void>) => {
    await Promise.all([wait(3000), resultCompletion]);
    setIsOpen(false);
    setStage('idle');
  };

  const submitRecording = async (chunks: Blob[], mimeType: string) => {
    setStage('processing');
    try {
      const firstChunk = chunks[0];
      if (!firstChunk) {
        setMessage(t('feedback.noSpeech'));
        setStage('result');
        void loadStatus();
        await closeAssistantResult(Promise.resolve());
        return;
      }
      let response: { status: number; body: AssistantVoiceResult };
      if (chunks.length === 1) {
        const audioBase64 = await blobToBase64(firstChunk);
        const voicePayload: AssistantVoiceCommandBody = {
          audioBase64,
          mimeType: mimeType || firstChunk.type || 'audio/webm',
        };
        response = await runPreparedVoiceCommand({
          kind: 'audio',
          audioBase64: voicePayload.audioBase64,
          mimeType: voicePayload.mimeType,
        });
      } else {
        const preparationId = uuid();
        const manifest: Array<{ audioSha256: string; mimeType: string }> = [];
        for (const chunk of chunks) {
          const audioBase64 = await blobToBase64(chunk);
          manifest.push({
            audioSha256: await sha256(audioBase64),
            mimeType: mimeType || chunk.type || 'audio/webm',
          });
        }
        const registration = await prepareAssistantVoiceWithRetry({
          body: { preparationId, manifest },
          prepare: body => apiClient.assistant.registerVoiceChunks({ body }),
          isAuthenticated: () => Boolean(useAuthStore.getState().token),
          onRetry: () => forceReconnect(false),
          waitForRetry: waitForAssistantRetry,
        });
        if (registration.status !== 202) {
          throw new Error(
            `Assistant audio manifest registration failed (${registration.status})`
          );
        }
        for (const [index, chunk] of chunks.entries()) {
          const audioBase64 = await blobToBase64(chunk);
          const body: AssistantVoiceChunkBody = {
            preparationId,
            index,
            audioBase64,
            mimeType: manifest[index].mimeType,
            debugLogId: null,
          };
          const chunkResponse = await prepareAssistantVoiceWithRetry({
            body,
            prepare: requestBody =>
              apiClient.assistant.transcribeVoiceChunk({ body: requestBody }),
            isAuthenticated: () => Boolean(useAuthStore.getState().token),
            onRetry: () => forceReconnect(false),
            waitForRetry: waitForAssistantRetry,
          });
          if (chunkResponse.status !== 200) {
            throw new Error(
              `Assistant audio chunk transcription failed (${chunkResponse.status})`
            );
          }
        }
        response = await runPreparedVoiceCommand({
          kind: 'chunks',
          preparationId,
        });
      }
      if (response.status !== 200) {
        setStage('error');
        setMessage(t('assistant.failed'));
        return;
      }

      setMessage(response.body.message);
      setStage('result');
      showToastFromStore(
        response.body.message || t('assistant.completed'),
        'success'
      );
      const audioFinished =
        response.body.spokenAudioBase64 && response.body.spokenAudioMimeType
          ? playAssistantAudio(
              response.body.spokenAudioBase64,
              response.body.spokenAudioMimeType
            )
          : Promise.resolve();
      await closeAssistantResult(audioFinished);
    } catch (error) {
      console.error('Failed to submit Assistant recording:', error);
      setStage('error');
      setMessage(t('assistant.failed'));
    }
  };

  const runPreparedVoiceCommand = async (
    preparationInput:
      | ({ kind: 'audio' } & AssistantVoiceCommandBody)
      | { kind: 'chunks'; preparationId: string }
      | ({ kind: 'transcript' } & AssistantVoiceTranscriptBody & {
            preparationId?: string;
          })
  ): Promise<{ status: number; body: AssistantVoiceResult }> => {
    const preparationId =
      'preparationId' in preparationInput && preparationInput.preparationId
        ? preparationInput.preparationId
        : uuid();
    const preparationBody = { ...preparationInput, preparationId };
    const preparation = await prepareAssistantVoiceWithRetry({
      body: preparationBody,
      prepare: body =>
        apiClient.assistant.prepareVoiceCommand({
          body,
        }),
      isAuthenticated: () => Boolean(useAuthStore.getState().token),
      onRetry: () => forceReconnect(false),
      waitForRetry: waitForAssistantRetry,
    });
    if (preparation.status !== 202) {
      throw new Error(`Assistant preparation failed (${preparation.status})`);
    }

    const committed = await submitUserMutation({
      id: preparationId,
      kind: 'assistant',
      label: t('assistant.runVoiceCommand'),
      payload: {
        operation: 'commitPreparedVoiceCommand',
        payload: { preparationId },
      },
      reconcile: async () => {
        await Promise.all([loadTasks(), loadStatus()]);
      },
    });
    const response = normalizeVoiceResponse(committed);
    try {
      const finalized = await apiClient.assistant.finalizeVoiceCommand({
        body: { preparationId },
      });
      if (finalized.status === 200) {
        return {
          status: finalized.status,
          body: finalized.body as AssistantVoiceResult,
        };
      }
    } catch (error) {
      console.warn('Assistant speech finalization failed:', error);
    }
    return response;
  };

  const stopRecording = useCallback(() => {
    rotateRecordingRef.current = false;
    if (rotationTimerRef.current !== null) {
      window.clearTimeout(rotationTimerRef.current);
      rotationTimerRef.current = null;
    }
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      mediaRecorderRef.current.stop();
      return;
    }
    cancelRecordingRef.current = true;
    recordingRequestIdRef.current += 1;
    recordingStartedAtRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    mediaRecorderRef.current = null;
    setStage('idle');
  }, []);

  const cancelRecording = useCallback(() => {
    cancelRecordingRef.current = true;
    rotateRecordingRef.current = false;
    recordingRequestIdRef.current += 1;
    if (rotationTimerRef.current !== null) {
      window.clearTimeout(rotationTimerRef.current);
      rotationTimerRef.current = null;
    }
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      mediaRecorderRef.current.stop();
    } else {
      stopStream(streamRef.current);
      streamRef.current = null;
      mediaRecorderRef.current = null;
    }
    recordingSegmentsRef.current = [];
    segmentChunksRef.current = [];
    recordingStartedAtRef.current = null;
    setIsOpen(false);
    setMessage('');
    setStage('idle');
  }, []);

  useEffect(() => {
    if (stage !== 'recording') {
      return;
    }

    const timer = window.setInterval(() => {
      const startedAt = recordingStartedAtRef.current;
      if (startedAt === null) {
        return;
      }

      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      setRecordingSeconds(elapsedSeconds);
      if (elapsedSeconds >= maxRecordingSeconds) {
        showToastFromStore(t('feedback.maximumDuration'), 'info');
        stopRecording();
      }
    }, 500);

    return () => window.clearInterval(timer);
  }, [maxRecordingSeconds, stage, stopRecording, t]);

  const startAssistantRecording = useCallback(() => {
    setIsOpen(true);
    setStage('idle');
    setMessage('');
    void startRecording();
  }, [startRecording]);

  const toggleAssistantRecording = useCallback(() => {
    if (stage === 'recording') {
      stopRecording();
      return;
    }
    if (stage === 'processing') {
      return;
    }
    startAssistantRecording();
  }, [stage, startAssistantRecording, stopRecording]);

  useEffect(() => {
    if (!isOpen || stage !== 'recording') return;
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        showToastFromStore(t('feedback.backgroundStopped'), 'info');
        stopRecording();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () =>
      document.removeEventListener('visibilitychange', handleVisibility);
  }, [isOpen, stage, stopRecording, t]);

  const previousAuthTokenRef = useRef(authToken);
  useEffect(() => {
    if (previousAuthTokenRef.current !== authToken && stage === 'recording') {
      cancelRecording();
      showToastFromStore(t('feedback.discardedAfterSignOut'), 'info');
    }
    previousAuthTokenRef.current = authToken;
  }, [authToken, cancelRecording, stage, t]);

  useLayoutEffect(() => {
    const slotId = !expanded
      ? 'assistant-session-slot-compact'
      : activeTab === 'timer'
        ? 'assistant-session-slot-timer'
        : 'assistant-session-slot-page';
    setPortalTarget(document.getElementById(slotId));
  }, [activeTab, expanded, isOpen, stage, status?.assistantEnabled]);

  useEffect(() => {
    if (!status?.assistantEnabled || !preferences?.keyboardShortcuts) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.code !== 'KeyB' ||
        hasOpenModal()
      ) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) {
        return;
      }

      event.preventDefault();
      toggleAssistantRecording();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    preferences?.keyboardShortcuts,
    status?.assistantEnabled,
    toggleAssistantRecording,
  ]);

  if (!status?.assistantEnabled) {
    return null;
  }

  if (!portalTarget || (!isOpen && (activeTab !== 'timer' || !expanded))) {
    return null;
  }

  return createPortal(
    <div className="relative z-[110] flex items-center">
      {stage === 'idle' ? (
        <IconButton
          label={t('assistant.title')}
          title={t('assistant.title')}
          size="md"
          variant="secondary"
          onClick={toggleAssistantRecording}
          className="h-[38px] w-[38px] !p-0"
        >
          <FaMicrophone />
          <KeyboardShortcut text="B" showModIcon={false} />
        </IconButton>
      ) : stage === 'recording' ? (
        <div className="relative h-[38px] w-[38px]">
          <button
            type="button"
            onClick={cancelRecording}
            className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] text-slate-400 hover:text-white"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            aria-label={t('assistant.stopRecording')}
            title={t('assistant.stopRecording')}
            onClick={stopRecording}
            className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-red-600 text-white shadow-sm shadow-red-950/30 transition hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-400/60"
          >
            <FaStop size={9} />
          </button>
          <span
            data-testid="assistant-recording-elapsed"
            className="absolute left-full top-1/2 ml-1.5 -translate-y-1/2 whitespace-nowrap font-mono text-[10px] tabular-nums text-slate-300"
          >
            {formatDuration(recordingSeconds)}
          </span>
        </div>
      ) : stage === 'processing' ? (
        <div
          role="status"
          aria-label={t('assistant.processing')}
          title={t('navigation.assistantProcessing')}
          className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-slate-700/40 bg-indigo-600/90 text-white shadow-sm shadow-indigo-950/30"
        >
          <FaSpinner className="animate-spin" />
        </div>
      ) : stage === 'result' ? (
        <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-emerald-500/35 bg-emerald-950/90 text-[9px] text-emerald-300">
          {t('common.done')}
        </div>
      ) : (
        <div className="relative h-[38px] w-[38px]">
          <button
            type="button"
            onClick={() => void startRecording()}
            aria-label={t('assistant.recordAgain')}
            title={t('navigation.recordAssistantAgain')}
            className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-red-500/40 bg-red-950/90 text-red-300 transition hover:bg-red-900/90 focus:outline-none focus:ring-2 focus:ring-red-400/60"
          >
            <FaMicrophoneSlash />
          </button>
          <span className="sr-only" aria-live="polite">
            {message}
          </span>
          <button
            type="button"
            onClick={cancelRecording}
            className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] text-slate-400 hover:text-white"
          >
            {t('common.dismiss')}
          </button>
        </div>
      )}
    </div>,
    portalTarget
  );
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach(track => track.stop());
}

function formatDuration(seconds: number) {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

async function playAssistantAudio(audioBase64: string, mimeType: string) {
  const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
  try {
    await audio.play();
    await new Promise<void>(resolve => {
      audio.addEventListener('ended', () => resolve(), { once: true });
      audio.addEventListener('error', () => resolve(), { once: true });
    });
  } catch (error) {
    console.warn('Failed to play Assistant audio:', error);
  }
}

function wait(milliseconds: number) {
  return new Promise<void>(resolve => window.setTimeout(resolve, milliseconds));
}
