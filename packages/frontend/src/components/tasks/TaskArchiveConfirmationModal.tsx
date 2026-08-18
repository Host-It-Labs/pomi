import type { Task } from '@pomi/shared';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { useI18n } from '../../i18n';

type Props = {
  task: Task | null;
  isSaving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function TaskArchiveConfirmationModal({
  task,
  isSaving,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useI18n();
  return (
    <Modal
      isOpen={task !== null}
      onClose={onCancel}
      title={t('task.archive')}
      ariaLabel={t('task.confirmArchive')}
      showCloseButton={false}
      closeOnBackdropClick={!isSaving}
      closeOnEscape={!isSaving}
    >
      <p className="text-sm text-slate-300">
        {task ? t('task.archiveDescription', { title: task.title }) : ''}
      </p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={isSaving}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="danger"
          onClick={onConfirm}
          isLoading={isSaving}
          loadingText={t('task.archiving')}
        >
          {t('common.archive')}
        </Button>
      </div>
    </Modal>
  );
}
