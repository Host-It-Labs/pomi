import { useEffect, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { ToggleField } from '../../components/ui/ToggleField';
import { UnsavedChangesDialog } from '../../components/ui/UnsavedChangesDialog';
import { MILLISECONDS_PER_MINUTE } from '../../constants/time';
import { useI18n } from '../../i18n';

interface SessionConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: {
    pomodorosCount: number;
    hasLongBreak: boolean;
    longBreakDuration: number;
    autoStartBreak: boolean;
  }) => void;
  initialValues?: {
    pomodorosCount: number;
    hasLongBreak: boolean;
    longBreakDuration: number;
    autoStartBreak: boolean;
  };
}

export function SessionConfigModal({
  isOpen,
  onClose,
  onSave,
  initialValues,
}: SessionConfigModalProps) {
  const { t } = useI18n();
  const [pomodorosCount, setPomodorosCount] = useState<string>(
    String(initialValues?.pomodorosCount || 4)
  );
  const [hasLongBreak, setHasLongBreak] = useState(
    initialValues?.hasLongBreak ?? true
  );
  const [longBreakDuration, setLongBreakDuration] = useState<string>(
    String(
      (initialValues?.longBreakDuration || 15 * MILLISECONDS_PER_MINUTE) /
        MILLISECONDS_PER_MINUTE
    )
  );
  const [autoStartBreak, setAutoStartBreak] = useState(
    initialValues?.autoStartBreak ?? false
  );
  const [error, setError] = useState<string>('');
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setShowDiscardConfirm(false);
      return;
    }

    setPomodorosCount(String(initialValues?.pomodorosCount || 4));
    setHasLongBreak(initialValues?.hasLongBreak ?? true);
    setLongBreakDuration(
      String(
        (initialValues?.longBreakDuration || 15 * MILLISECONDS_PER_MINUTE) /
          MILLISECONDS_PER_MINUTE
      )
    );
    setAutoStartBreak(initialValues?.autoStartBreak ?? false);
    setError('');
  }, [initialValues, isOpen]);

  if (!isOpen) return null;

  const initialConfigKey = serializeSessionConfig({
    pomodorosCount: String(initialValues?.pomodorosCount || 4),
    hasLongBreak: initialValues?.hasLongBreak ?? true,
    longBreakDuration: String(
      (initialValues?.longBreakDuration || 15 * MILLISECONDS_PER_MINUTE) /
        MILLISECONDS_PER_MINUTE
    ),
    autoStartBreak: initialValues?.autoStartBreak ?? false,
  });
  const currentConfigKey = serializeSessionConfig({
    pomodorosCount,
    hasLongBreak,
    longBreakDuration,
    autoStartBreak,
  });
  const hasUnsavedChanges = currentConfigKey !== initialConfigKey;
  const requestClose = () => {
    if (hasUnsavedChanges) {
      setShowDiscardConfirm(true);
      return;
    }
    onClose();
  };

  const handleSave = () => {
    const pomodorosNum = parseInt(pomodorosCount);
    const durationNum = parseInt(longBreakDuration);

    if (
      !pomodorosCount ||
      isNaN(pomodorosNum) ||
      pomodorosNum < 1 ||
      pomodorosNum > 10
    ) {
      setError(t('session.workTimersRange'));
      return;
    }

    if (
      hasLongBreak &&
      (!longBreakDuration ||
        isNaN(durationNum) ||
        durationNum < 5 ||
        durationNum > 60)
    ) {
      setError(t('session.longBreakRange'));
      return;
    }

    setError('');
    onSave({
      pomodorosCount: pomodorosNum,
      hasLongBreak,
      longBreakDuration: durationNum * MILLISECONDS_PER_MINUTE,
      autoStartBreak,
    });
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={requestClose}
        title={t('session.configure')}
        closeOnBackdropClick={true}
        closeOnEscape={true}
      >
        {error && (
          <Alert variant="error" className="mb-4">
            {error}
          </Alert>
        )}

        <div className="space-y-4">
          <FormField
            label={t('session.workTimersPerSession')}
            helperText={t('session.workTimersPerSessionDescription')}
          >
            <Input
              type="text"
              value={pomodorosCount}
              onChange={e => setPomodorosCount(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="4"
            />
          </FormField>

          <ToggleField
            id="session-config-long-break"
            checked={hasLongBreak}
            onChange={value => setHasLongBreak(value)}
            label={t('session.enableLongBreak')}
            description={t('session.longBreakDescription')}
          />

          {hasLongBreak && (
            <FormField label={t('session.longBreakDuration')}>
              <Input
                type="text"
                value={longBreakDuration}
                onChange={e => setLongBreakDuration(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="15"
              />
            </FormField>
          )}

          {hasLongBreak && (
            <ToggleField
              id="session-config-long-break-auto-start"
              checked={autoStartBreak}
              onChange={value => setAutoStartBreak(value)}
              label={t('timerSettings.autoStartBreaks')}
              description={t('timerSettings.autoStartBreaksDescription')}
            />
          )}
        </div>

        <div className="mt-6 flex gap-3">
          <Button onClick={requestClose} variant="secondary" className="flex-1">
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} className="flex-1">
            {t('common.save')}
          </Button>
        </div>
      </Modal>
      <UnsavedChangesDialog
        isOpen={showDiscardConfirm}
        title={t('session.discardChanges')}
        message={t('session.discardMessage')}
        stayLabel={t('common.stay')}
        discardLabel={t('common.discard')}
        onStay={() => setShowDiscardConfirm(false)}
        onDiscard={() => {
          setShowDiscardConfirm(false);
          onClose();
        }}
      />
    </>
  );
}

function serializeSessionConfig(config: {
  pomodorosCount: string;
  hasLongBreak: boolean;
  longBreakDuration: string;
  autoStartBreak: boolean;
}) {
  return JSON.stringify(config);
}
