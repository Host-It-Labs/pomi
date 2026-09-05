import { FEEDBACK_MAX_TEXT_LENGTH } from '@pomi/shared/src/constants';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FaMicrophone } from 'react-icons/fa';
import { useI18n } from '../../i18n';
import { showToastFromStore } from '../toast/ToastContext';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Modal } from '../ui/Modal';
import {
  submitFeedbackText,
  useFeedbackRecorderStore,
} from './FeedbackRecorder';

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
  const recordingError = useFeedbackRecorderStore.use.error();
  const startRecording = useFeedbackRecorderStore.use.startRecording();
  const stopRecording = useFeedbackRecorderStore.use.stopRecording();
  const cancelRecording = useFeedbackRecorderStore.use.cancelRecording();
  const [textStage, setTextStage] = useState<TextFeedbackStage>('ready');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const submissionRequestRef = useRef(0);
  const wasOpenRef = useRef(false);
  const previousRecordingStageRef = useRef(recordingStage);
  const voiceStartRequestedRef = useRef(false);
  const pendingVoiceStartRef = useRef(false);

  const hasActiveRecording =
    recordingStage === 'starting' || recordingStage === 'recording';

  const resetAndClose = useCallback(
    (cancelActiveRecording: boolean) => {
      submissionRequestRef.current += 1;
      voiceStartRequestedRef.current = false;
      pendingVoiceStartRef.current = false;
      if (cancelActiveRecording && hasActiveRecording) cancelRecording();
      setTextStage('ready');
      setText('');
      setError('');
      setConfirmClose(false);
      onClose();
    },
    [cancelRecording, hasActiveRecording, onClose]
  );

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
        resetAndClose(true);
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
      voiceStartRequestedRef.current = false;
      pendingVoiceStartRef.current = false;
      return;
    }
    if (previousRecordingStage === 'sending' && recordingStage === 'idle') {
      resetAndClose(true);
      return;
    }
    if (voiceStartRequestedRef.current && recordingStage === 'recording') {
      voiceStartRequestedRef.current = false;
      resetAndClose(false);
      return;
    }
    if (voiceStartRequestedRef.current && recordingStage === 'error') {
      voiceStartRequestedRef.current = false;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setTextStage('ready');
    setText('');
    setError('');
    setConfirmClose(false);
  }, [isOpen, recordingStage, resetAndClose]);

  const requestVoiceStart = useCallback(() => {
    if (recordingStage === 'starting' || recordingStage === 'sending') return;
    if (text.trim()) {
      pendingVoiceStartRef.current = true;
      setConfirmClose(true);
      return;
    }
    voiceStartRequestedRef.current = true;
    setError('');
    void startRecording();
  }, [recordingStage, startRecording, text]);

  const requestClose = () => {
    if (text.trim() || hasActiveRecording) {
      setConfirmClose(true);
      return;
    }
    resetAndClose(true);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title={t('feedback.title')}
      headerActions={
        <IconButton
          label={t('feedback.record')}
          onClick={requestVoiceStart}
          disabled={
            recordingStage === 'starting' ||
            recordingStage === 'recording' ||
            recordingStage === 'sending'
          }
          size="sm"
          variant="secondary"
          className="bg-transparent text-slate-400 hover:bg-transparent hover:text-ink"
        >
          <FaMicrophone size={14} />
        </IconButton>
      }
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
                if (pendingVoiceStartRef.current) {
                  pendingVoiceStartRef.current = false;
                  setConfirmClose(false);
                  void submitText(text, ++submissionRequestRef.current);
                  return;
                }
                setConfirmClose(false);
                if (hasActiveRecording && !text.trim()) stopRecording();
                else void submitText(text, ++submissionRequestRef.current);
              }}
            >
              {t('common.submit')}
            </Button>
            <Button
              className="flex-1"
              variant="secondary"
              onClick={() => {
                if (pendingVoiceStartRef.current) {
                  pendingVoiceStartRef.current = false;
                  setConfirmClose(false);
                  setText('');
                  setError('');
                  voiceStartRequestedRef.current = true;
                  void startRecording();
                  return;
                }
                resetAndClose(true);
              }}
            >
              {t('common.discard')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <textarea
            autoFocus
            rows={7}
            value={text}
            maxLength={FEEDBACK_MAX_TEXT_LENGTH}
            onChange={event => setText(event.target.value)}
            placeholder={t('feedback.improve')}
            className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-ink outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25"
          />
          {(error || recordingError) && (
            <p className="text-sm text-red-300">{error || recordingError}</p>
          )}
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
