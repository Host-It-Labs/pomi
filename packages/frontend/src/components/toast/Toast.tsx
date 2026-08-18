import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { useI18n } from '../../i18n';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastProps {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  onClose: () => void;
}

export function Toast({
  id,
  message,
  type,
  duration = 3000,
  onClose,
}: ToastProps) {
  const { t } = useI18n();
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => {
      clearTimeout(timer);
    };
  }, [id, duration, onClose]);

  const getToastStyles = () => {
    switch (type) {
      case 'success':
        return 'bg-green-900/80 border-green-500 text-green-200';
      case 'error':
        return 'bg-red-900/80 border-red-500 text-red-200';
      case 'warning':
        return 'bg-yellow-900/80 border-yellow-500 text-yellow-200';
      case 'info':
      default:
        return 'bg-blue-900/80 border-blue-500 text-blue-200';
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'success':
        return (
          <svg
            className="w-5 h-5 mr-2 text-green-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        );
      case 'error':
        return (
          <svg
            className="w-5 h-5 mr-2 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        );
      case 'warning':
        return (
          <svg
            className="w-5 h-5 mr-2 text-yellow-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        );
      case 'info':
      default:
        return (
          <svg
            className="w-5 h-5 mr-2 text-blue-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        );
    }
  };

  return (
    <motion.div
      role="alert"
      aria-live="assertive"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className={`flex items-center px-3 py-2 rounded-lg shadow-lg border text-sm max-w-md ${getToastStyles()}`}
    >
      <div className="flex items-center">
        {getIcon()}
        <span>{message}</span>
      </div>
      <button
        onClick={() => onClose()}
        className="ml-4 opacity-70 hover:opacity-100 transition-opacity"
        aria-label={t('toast.close')}
        title={t('toast.close')}
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </motion.div>
  );
}

interface ToastContainerProps {
  toast: Omit<ToastProps, 'onClose'> | null;
  onClose: () => void;
}

export function ToastContainer({ toast, onClose }: ToastContainerProps) {
  return (
    <div className="fixed bottom-2 right-2 left-2 z-50 flex flex-col items-center md:items-end">
      <AnimatePresence>
        {toast && (
          <Toast
            key={toast.id}
            id={toast.id}
            message={toast.message}
            type={toast.type}
            duration={toast.duration}
            onClose={onClose}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
