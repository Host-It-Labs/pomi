import { Button } from './Button';
import { Modal } from './Modal';

type UnsavedChangesDialogProps = {
  isOpen: boolean;
  title: string;
  message: string;
  stayLabel: string;
  discardLabel: string;
  onStay: () => void;
  onDiscard: () => void;
};

export function UnsavedChangesDialog({
  isOpen,
  title,
  message,
  stayLabel,
  discardLabel,
  onStay,
  onDiscard,
}: UnsavedChangesDialogProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onStay}
      title={title}
      closeOnBackdropClick
      closeOnEscape
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-300">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onStay}>
            {stayLabel}
          </Button>
          <Button variant="danger" onClick={onDiscard}>
            {discardLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
