import { useCallback, useEffect, useRef, useState } from 'react';
import { FaKeyboard, FaMicrophone, FaStop } from 'react-icons/fa';
import {
  submitFeedbackText,
  useFeedbackRecorderStore,
} from './FeedbackRecorder';
import { showToastFromStore } from '../toast/ToastContext';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { useI18n } from '../../i18n';

type FeedbackMode = 'choice' | 'voice' | 'text';
type TextFeedbackStage = 'ready' | 'sending' | 'error';

export function FeedbackModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const recordingStage = useFeedbackRecorderStore.use.stage();
  const recordingSeconds = useFeedbackRecorderStore.use.seconds();
  const recordingError = useFeedbackRecorderStore.use.error();
  const startRecording = useFeedbackRecorderStore.use.startRecording();
  const stopRecording = useFeedbackRecorderStore.use.stopRecording();
  const cancelRecording = useFeedbackRecorderStore.use.cancelRecording();
  const [mode, setMode] = useState<FeedbackMode>('choice');
  const [textStage, setTextStage] = useState<TextFeedbackStage>('ready');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const submissionRequestRef = useRef(0);
  const wasOpenRef = useRef(false);
  const previousRecordingStageRef = useRef(recordingStage);

  const hasActiveRecording =
    recordingStage === 'starting' || recordingStage === 'recording';

  const resetAndClose = useCallback(() => {
    submissionRequestRef.current += 1;
    if (hasActiveRecording) cancelRecording();
    setMode('choice');
    setTextStage('ready');
    setText('');
    setError('');
    setConfirmClose(false);
    onClose();
  }, [cancelRecording, hasActiveRecording, onClose]);

  const submitText = useCallback(
    async (feedback: string, request: number) => {
      const trimmed = feedback.trim();
      if (!trimmed) {
        setError(t('feedback.addFirst'));
        setTextStage('error');
        return;
      }
      setTextStage('sending');
      setError('');
      try {
        if (request !== submissionRequestRef.current) return;
        await submitFeedbackText(trimmed);
        if (request !== submissionRequestRef.current) return;
        showToastFromStore(t('feedback.sent'), 'success');
        resetAndClose();
      } catch (submissionError) {
        if (request !== submissionRequestRef.current) return;
        setError(
          submissionError instanceof Error
            ? submissionError.message
            : t('feedback.sendFailed')
        );
        setTextStage('error');
      }
    },
    [resetAndClose, t]
  );

  useEffect(() => {
    const previousRecordingStage = previousRecordingStageRef.current;
    previousRecordingStageRef.current = recordingStage;
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }
    if (previousRecordingStage === 'sending' && recordingStage === 'idle') {
      resetAndClose();
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setMode(recordingStage === 'idle' ? 'choice' : 'voice');
    setTextStage('ready');
    setText('');
    setError('');
    setConfirmClose(false);
  }, [isOpen, recordingStage, resetAndClose]);

  const switchToText = () => {
    if (hasActiveRecording) cancelRecording();
    setMode('text');
    setTextStage('ready');
    setError('');
  };

  const requestClose = () => {
    if (text.trim() || (mode === 'voice' && hasActiveRecording)) {
      setConfirmClose(true);
      return;
    }
    resetAndClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title={t('feedback.title')}
      closeOnBackdropClick
      closeOnEscape
    >
      {confirmClose ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            {t('feedback.submitBeforeClose')}
          </p>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={() => {
                setConfirmClose(false);
                if (mode === 'voice') stopRecording();
                else void submitText(text, ++submissionRequestRef.current);
              }}
            >
              {t('common.submit')}
            </Button>
            <Button
              className="flex-1"
              variant="secondary"
              onClick={resetAndClose}
            >
              {t('common.discard')}
            </Button>
          </div>
        </div>
      ) : mode === 'choice' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              setMode('voice');
              void startRecording();
            }}
            className="group flex min-h-32 flex-col items-center justify-center gap-3 rounded-xl border border-indigo-500/25 bg-indigo-500/10 p-5 text-center transition hover:border-indigo-400/60 hover:bg-indigo-500/15"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-200 transition group-hover:scale-105">
              <FaMicrophone size={19} />
            </span>
            <span>
              <span className="block text-sm font-semibold text-white">
                {t('feedback.record')}
              </span>
              <span className="mt-1 block text-xs text-slate-400">
                {t('feedback.recordDescription')}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMode('text')}
            className="group flex min-h-32 flex-col items-center justify-center gap-3 rounded-xl border border-slate-700 bg-slate-900/70 p-5 text-center transition hover:border-slate-500 hover:bg-slate-800/80"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-800 text-slate-200 transition group-hover:scale-105">
              <FaKeyboard size={19} />
            </span>
            <span>
              <span className="block text-sm font-semibold text-white">
                {t('feedback.type')}
              </span>
              <span className="mt-1 block text-xs text-slate-400">
                {t('feedback.typeDescription')}
              </span>
            </span>
          </button>
        </div>
      ) : mode === 'voice' ? (
        <div className="space-y-5 text-center">
          <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-400/25">
            {recordingStage === 'recording' ? (
              <FaMicrophone size={34} />
            ) : (
              <FaStop size={28} />
            )}
          </div>
          <p className="font-mono text-sm text-slate-300">
            {recordingStage === 'recording'
              ? `${String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:${String(recordingSeconds % 60).padStart(2, '0')}`
              : recordingStage === 'sending'
                ? t('feedback.sendingEllipsis')
                : t('feedback.preparingMicrophone')}
          </p>
          {(error || recordingError) && (
            <p className="text-sm text-red-300">{error || recordingError}</p>
          )}
          <div className="flex gap-2">
            <Button
              className="flex-1 gap-2"
              disabled={recordingStage !== 'recording'}
              onClick={stopRecording}
            >
              <FaStop size={11} /> {t('feedback.stopAndSend')}
            </Button>
            <Button
              className="flex-1 gap-2"
              variant="secondary"
              disabled={recordingStage === 'sending'}
              onClick={switchToText}
            >
              <FaKeyboard size={12} /> {t('feedback.type')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <textarea
            autoFocus
            rows={7}
            value={text}
            maxLength={20_000}
            onChange={event => setText(event.target.value)}
            placeholder={t('feedback.improve')}
            className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25"
          />
          {error && <p className="text-sm text-red-300">{error}</p>}
          <Button
            className="w-full"
            disabled={textStage === 'sending' || !text.trim()}
            onClick={() =>
              void submitText(text, ++submissionRequestRef.current)
            }
          >
            {textStage === 'sending'
              ? t('feedback.sendingEllipsis')
              : t('feedback.send')}
          </Button>
        </div>
      )}
    </Modal>
  );
}
