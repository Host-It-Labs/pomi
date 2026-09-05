import { Modal, type ModalProps } from './Modal';

export function BottomSheet(props: Omit<ModalProps, 'presentation'>) {
  return <Modal {...props} presentation="sheet" />;
}

export { SheetOptions } from './Modal';
