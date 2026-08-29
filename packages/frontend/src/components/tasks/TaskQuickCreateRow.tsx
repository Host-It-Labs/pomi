import type {
  AssistantTaskCreationResult,
  TaskPriority,
  TaskRecurrenceAnchorMode,
  TimerTypes,
} from '@pomi/shared';
import { ASSISTANT_MAX_RECORDING_MINUTES } from '@pomi/shared/src/constants';
import clsx from 'clsx';
import { v4 as uuid } from 'uuid';
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  FaMicrophone,
  FaPlus,
  FaSlidersH,
  FaSpinner,
  FaStop,
  FaTimes,
} from 'react-icons/fa';
import { useAssistantStore } from '../../stores/assistantStore';
import { useTasksStore } from '../../stores/tasksStore';
import { apiClient } from '../../utils/apiClient';
import { submitUserMutation } from '../../utils/userActionQueue';
import { requestListRefresh } from '../../utils/listRefresh';
import { blobToBase64 } from '../../utils/blobToBase64';
import { getApiErrorMessage } from '../../utils/apiError';
import { showToastFromStore } from '../toast/ToastContext';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { useI18n } from '../../i18n';

type TaskQuickCreateDefaults = {
  description?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: TaskPriority;
  timerType?: TimerTypes;
  intentionSlug?: string | null;
  subIntentionSlug?: string | null;
  recurrenceRule?: string | null;
  recurrenceAnchorMode?: TaskRecurrenceAnchorMode;
};

type TaskQuickCreateRowProps = {
  className?: string;
  compact?: boolean;
  autoFocus?: boolean;
  focusRequest?: number;
  createDefaults?: TaskQuickCreateDefaults;
  assistantDefaults?: Pick<
    TaskQuickCreateDefaults,
    'timerType' | 'intentionSlug' | 'subIntentionSlug'
  >;
  onOpenAdvanced?: (initialTitle: string) => void;
  listId?: string | null;
  onCancel?: () => void;
  onCreated?: () => void;
};

type PendingAssistantPreparation = { inputKey: string; preparationId: string };

const DEFAULT_RECORDING_MAX_MINUTES = 10;
const RECORDER_SEGMENT_MS = 60_000;

export function TaskQuickCreateRow({
  className,
  compact = false,
  autoFocus = false,
  focusRequest = 0,
  createDefaults,
  assistantDefaults,
  onOpenAdvanced,
  listId,
  onCancel,
  onCreated,
}: TaskQuickCreateRowProps) {
  const { t } = useI18n();
  const createTask = useTasksStore.use.createTask();
  const mergeTasks = useTasksStore.use.mergeTasks();
  const assistantStatus = useAssistantStore.use.status();
  const loadAssistantStatus = useAssistantStore.use.loadStatus();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const pendingAssistantPreparationRef =
    useRef<PendingAssistantPreparation | null>(null);
  const segmentChunksRef = useRef<Blob[]>([]);
  const recordingSegmentsRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelRef = useRef(false);
  const rotateRecordingRef = useRef(false);
  const rotationTimerRef = useRef<number | null>(null);
  const recordingRequestIdRef = useRef(0);
  const submissionGenerationRef = useRef(0);
  const recordingStartedAtRef = useRef<number | null>(null);
  const debugLogIdRef = useRef<string | null>(null);

  const canUseAssistantTasks =
    assistantStatus?.aiTaskCaptureEnabled === true &&
    assistantStatus.tasksEnabled === true;
  const canUseTaskSpeech =
    assistantStatus?.speechCaptureEnabled === true &&
    assistantStatus.tasksEnabled === true;
  const configuredMaxRecordingMinutes =
    assistantStatus?.assistantRecordingMaxMinutes;
  const maxRecordingMinutes = Math.min(
    configuredMaxRecordingMinutes === undefined
      ? DEFAULT_RECORDING_MAX_MINUTES
      : (configuredMaxRecordingMinutes ?? ASSISTANT_MAX_RECORDING_MINUTES),
    ASSISTANT_MAX_RECORDING_MINUTES
  );
  const maxRecordingSeconds = Math.max(1, maxRecordingMinutes * 60);

  useEffect(() => {
    void loadAssistantStatus();
  }, [loadAssistantStatus]);

  useEffect(() => {
    if (!autoFocus && focusRequest === 0) {
      return;
    }

    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [autoFocus, focusRequest]);

  useEffect(() => {
    return () => {
      cancelRef.current = true;
      recordingRequestIdRef.current += 1;
      submissionGenerationRef.current += 1;
      pendingAssistantPreparationRef.current = null;
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      stopStream(streamRef.current);
    };
  }, []);

  const reset = useCallback(() => {
    setText('');
    setError(null);
    debugLogIdRef.current = null;
  }, []);

  const insertTranscript = useCallback((transcript: string) => {
    const normalized = transcript.trim();
    if (!normalized) {
      return;
    }

    setText(current => {
      const input = inputRef.current;
      const start = input?.selectionStart ?? current.length;
      const end = input?.selectionEnd ?? start;
      const prefix = current.slice(0, start);
      const suffix = current.slice(end);
      const separatorBefore = prefix && !/\s$/.test(prefix) ? ' ' : '';
      const separatorAfter = suffix && !/^\s/.test(suffix) ? ' ' : '';
      const next = `${prefix}${separatorBefore}${normalized}${separatorAfter}${suffix}`;
      const nextCursor =
        prefix.length + separatorBefore.length + normalized.length;

      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(nextCursor, nextCursor);
      });

      return next;
    });
  }, []);

  const transcribeSpeech = useCallback(
    async (chunks: Blob[], mimeType: string) => {
      setIsTranscribing(true);
      setError(null);
      try {
        const transcripts: string[] = [];
        for (const chunk of chunks) {
          const audioBase64 = await blobToBase64(chunk);
          let response: Awaited<
            ReturnType<typeof apiClient.assistant.transcribeTaskInput>
          > | null = null;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              response = await apiClient.assistant.transcribeTaskInput({
                body: {
                  audioBase64,
                  mimeType: mimeType || chunk.type || 'audio/webm',
                  debugLogId: debugLogIdRef.current,
                },
              });
            } catch (transcribeError) {
              if (attempt === 1) throw transcribeError;
              continue;
            }
            if (response.status === 200) break;
          }
          if (!response || response.status !== 200) {
            throw new Error(t('task.dictationChunkFailed'));
          }
          debugLogIdRef.current = response.body.debugLogId;
          if (response.body.transcript.trim()) {
            transcripts.push(response.body.transcript.trim());
          }
        }
        if (transcripts.length === 0) {
          setError(t('feedback.noSpeech'));
          return;
        }
        insertTranscript(transcripts.join('\n\n'));
        await loadAssistantStatus();
      } catch (transcribeError) {
        console.error('Failed to transcribe Task dictation:', transcribeError);
        setError(t('task.dictationFailed'));
      } finally {
        setIsTranscribing(false);
      }
    },
    [insertTranscript, loadAssistantStatus, t]
  );

  const stopTaskSpeechStream = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
  }, []);

  const stopTaskSpeechRecording = useCallback(() => {
    rotateRecordingRef.current = false;
    if (rotationTimerRef.current !== null) {
      window.clearTimeout(rotationTimerRef.current);
      rotationTimerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
      return;
    }
    cancelRef.current = true;
    recordingRequestIdRef.current += 1;
    stopTaskSpeechStream();
    recorderRef.current = null;
    setIsRecording(false);
  }, [stopTaskSpeechStream]);

  const startTaskSpeechRecording = useCallback(async () => {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setError(t('assistant.microphoneUnavailable'));
      return;
    }

    const requestId = recordingRequestIdRef.current + 1;
    recordingRequestIdRef.current = requestId;
    try {
      setError(null);
      segmentChunksRef.current = [];
      recordingSegmentsRef.current = [];
      cancelRef.current = false;
      rotateRecordingRef.current = false;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (requestId !== recordingRequestIdRef.current || cancelRef.current) {
        stopStream(stream);
        return;
      }
      streamRef.current = stream;
      const startSegment = () => {
        const recorder = new MediaRecorder(stream);
        recorderRef.current = recorder;
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
          const wasCancelled = cancelRef.current;
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
          cancelRef.current = false;
          recordingStartedAtRef.current = null;
          recorderRef.current = null;
          setIsRecording(false);
          stopTaskSpeechStream();
          if (!wasCancelled && segments.length > 0) {
            void transcribeSpeech(segments, recorder.mimeType);
          }
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
      recordingStartedAtRef.current = Date.now();
      setIsRecording(true);
    } catch (recordError) {
      stopTaskSpeechStream();
      recorderRef.current = null;
      setIsRecording(false);
      if (requestId !== recordingRequestIdRef.current || cancelRef.current) {
        return;
      }
      console.error('Failed to start Task dictation:', recordError);
      setError(t('assistant.microphoneBlocked'));
    }
  }, [stopTaskSpeechStream, t, transcribeSpeech]);

  useEffect(() => {
    if (!isRecording) {
      return;
    }

    const startedAt = recordingStartedAtRef.current ?? Date.now();
    const remainingMs = Math.max(
      0,
      maxRecordingSeconds * 1000 - (Date.now() - startedAt)
    );
    const timeout = window.setTimeout(() => {
      if (recorderRef.current?.state !== 'inactive') {
        stopTaskSpeechRecording();
      }
    }, remainingMs);

    return () => window.clearTimeout(timeout);
  }, [isRecording, maxRecordingSeconds, stopTaskSpeechRecording]);

  const toggleTaskSpeechRecording = useCallback(() => {
    if (isRecording) {
      stopTaskSpeechRecording();
      return;
    }
    if (isTranscribing) {
      return;
    }
    void startTaskSpeechRecording();
  }, [
    isRecording,
    isTranscribing,
    startTaskSpeechRecording,
    stopTaskSpeechRecording,
  ]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = text.trim();
    if (!title || isSaving) {
      return;
    }

    setIsSaving(true);
    setError(null);
    const submissionGeneration = ++submissionGenerationRef.current;
    const isCurrentSubmission = () =>
      submissionGenerationRef.current === submissionGeneration;
    try {
      if (canUseAssistantTasks) {
        const preparationInputKey = JSON.stringify({
          text: title,
          listId,
          defaults: assistantDefaults,
          debugLogId: debugLogIdRef.current,
        });
        const pendingPreparation = pendingAssistantPreparationRef.current;
        const preparationId =
          pendingPreparation?.inputKey === preparationInputKey
            ? pendingPreparation.preparationId
            : uuid();
        pendingAssistantPreparationRef.current = {
          inputKey: preparationInputKey,
          preparationId,
        };
        const preparation = await apiClient.assistant.prepareTaskFromText({
          body: {
            preparationId,
            text: title,
            listId: listId ?? undefined,
            defaults: assistantDefaults,
            debugLogId: debugLogIdRef.current,
          },
        });
        if (!isCurrentSubmission()) {
          return;
        }
        if (preparation.status !== 202) {
          const body = preparation.body as { message?: string } | null;
          setError(body?.message ?? t('task.preparationFailed'));
          return;
        }
        pendingAssistantPreparationRef.current = null;
        const result = await submitUserMutation({
          id: preparationId,
          kind: 'assistant',
          label: t('task.captureWithAssistant'),
          payload: {
            operation: 'commitPreparedTaskFromText',
            payload: {
              preparationId,
              ...(listId ? { listId } : {}),
            },
          },
          reconcile: async result => {
            if (!isCurrentSubmission()) {
              return;
            }
            const body =
              result && typeof result === 'object' && 'body' in result
                ? (result as { body: unknown }).body
                : result;
            if (body && typeof body === 'object' && 'tasks' in body) {
              const capture = body as AssistantTaskCreationResult;
              mergeTasks(capture.tasks);
              if (capture.listItems.length > 0) requestListRefresh();
            }
            if (assistantStatus?.usageBudgetCapUsd !== null) {
              await loadAssistantStatus();
            }
          },
        });
        if (!isCurrentSubmission()) {
          return;
        }
        const response =
          result &&
          typeof result === 'object' &&
          'status' in result &&
          'body' in result
            ? {
                status: (result as { status: number }).status,
                body: (result as { body: AssistantTaskCreationResult }).body,
              }
            : { status: 201, body: result as AssistantTaskCreationResult };
        if (response.status !== 201) {
          setError(getApiErrorMessage(response.body, 'Task capture failed.'));
          return;
        }

        reset();
        showToastFromStore(
          response.body.message,
          response.body.usedFallback ? 'warning' : 'success'
        );
        onCreated?.();
        return;
      }

      if (listId) {
        await submitUserMutation({
          kind: 'lists',
          label: t('common.add'),
          payload: {
            operation: 'createItem',
            listId,
            title,
          },
          reconcile: async () => {
            requestListRefresh();
          },
        });
        if (!isCurrentSubmission()) {
          return;
        }
        reset();
        requestListRefresh();
        showToastFromStore(t('task.created'), 'success');
        onCreated?.();
        return;
      }

      const didCreate = await createTask({
        ...createDefaults,
        title,
      });
      if (!isCurrentSubmission()) {
        return;
      }
      if (didCreate) {
        reset();
        showToastFromStore(t('task.created'), 'success');
        onCreated?.();
      }
    } catch (submitError) {
      if (!isCurrentSubmission()) {
        return;
      }
      console.error('Failed to create Task:', submitError);
      setError(
        submitError instanceof Error && submitError.message.trim()
          ? submitError.message
          : t('task.creationFailed')
      );
    } finally {
      if (isCurrentSubmission()) {
        setIsSaving(false);
      }
    }
  };

  const handleCancel = useCallback(() => {
    cancelRef.current = true;
    recordingRequestIdRef.current += 1;
    submissionGenerationRef.current += 1;
    pendingAssistantPreparationRef.current = null;
    setIsSaving(false);
    stopTaskSpeechRecording();
    reset();
    onCancel?.();
  }, [onCancel, reset, stopTaskSpeechRecording]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    handleCancel();
  };

  return (
    <div className={clsx('min-w-0', className)}>
      <form
        onSubmit={handleSubmit}
        className={clsx(
          'grid gap-2',
          onOpenAdvanced && onCancel
            ? 'grid-cols-[minmax(0,1fr)_auto_auto_auto]'
            : onOpenAdvanced || onCancel
              ? 'grid-cols-[minmax(0,1fr)_auto_auto]'
              : 'grid-cols-[minmax(0,1fr)_auto]',
          compact && 'gap-1.5'
        )}
      >
        <label className="relative min-w-0">
          <span className="sr-only">{t('task.add')}</span>
          <FaPlus
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-500"
          />
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={event => {
              setText(event.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('task.add')}
            aria-label={t('task.add')}
            className={clsx(
              'h-9 w-full rounded-md border border-slate-800 bg-slate-900/70 py-0 pl-7 text-xs text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-indigo-400/70',
              canUseTaskSpeech ? 'pr-10' : 'pr-3'
            )}
          />
          {canUseTaskSpeech && (
            <button
              type="button"
              aria-label={
                isRecording ? t('task.stopDictation') : t('task.dictate')
              }
              title={isRecording ? t('task.stopDictation') : t('task.dictate')}
              onClick={toggleTaskSpeechRecording}
              disabled={isTranscribing}
              className={clsx(
                'absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border text-[11px] transition',
                isRecording
                  ? 'border-indigo-400/50 bg-indigo-600/60 text-indigo-50'
                  : 'border-slate-700/50 bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white',
                isTranscribing && 'cursor-not-allowed opacity-60'
              )}
            >
              {isTranscribing ? (
                <FaSpinner className="animate-spin" />
              ) : isRecording ? (
                <FaStop />
              ) : (
                <FaMicrophone />
              )}
            </button>
          )}
        </label>
        {onOpenAdvanced && (
          <IconButton
            type="button"
            label={t('task.create')}
            title={t('task.advancedSettings')}
            size="sm"
            variant="secondary"
            onClick={() => onOpenAdvanced(text.trim())}
            className="h-9 w-9 shrink-0 !p-0"
          >
            <FaSlidersH size={10} />
          </IconButton>
        )}
        <Button
          type="submit"
          size="xs"
          isLoading={isSaving}
          loadingText={t('task.adding')}
          disabled={!text.trim()}
          className="h-9 gap-1.5"
        >
          <FaPlus size={10} />
          {t('common.add')}
        </Button>
        {onCancel && (
          <IconButton
            type="button"
            label={t('common.cancel')}
            title={t('common.cancel')}
            size="sm"
            variant="secondary"
            onClick={handleCancel}
            className="h-9 w-9 shrink-0 !p-0"
          >
            <FaTimes size={10} />
          </IconButton>
        )}
      </form>
      {error && (
        <Alert variant="error" className="mt-2">
          {error}
        </Alert>
      )}
    </div>
  );
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach(track => track.stop());
}
