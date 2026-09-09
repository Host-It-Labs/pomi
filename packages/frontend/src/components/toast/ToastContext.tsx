import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { v4 as uuidv4 } from 'uuid';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { createToastSpeechAdapter } from '../../utils/toastSpeech';
import { ToastContainer, ToastType } from './Toast';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  action?: ToastAction;
}

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastContextType {
  showToast: (
    message: string,
    type: ToastType,
    duration?: number,
    action?: ToastAction
  ) => void;
  hideToast: () => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

let globalShowToast:
  | ((
      message: string,
      type: ToastType,
      duration?: number,
      action?: ToastAction
    ) => void)
  | null = null;

export function showToastFromStore(
  message: string,
  type: ToastType,
  duration?: number,
  action?: ToastAction
) {
  if (globalShowToast) {
    globalShowToast(message, type, duration, action);
  }
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const preferences = usePreferencesStore.use.preferences();
  const speech = useRef(createToastSpeechAdapter());

  useEffect(() => {
    if (
      !toast ||
      preferences?.speakToastMessages === false ||
      document.visibilityState !== 'visible'
    ) {
      speech.current.cancel();
      return;
    }

    speech.current.speak(
      toast.message,
      preferences?.language || document.documentElement.lang || 'en'
    );
    return () => speech.current.cancel();
  }, [preferences?.language, preferences?.speakToastMessages, toast]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') speech.current.cancel();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      speech.current.cancel();
    };
  }, []);

  const showToast = useCallback(
    (
      message: string,
      type: ToastType,
      duration?: number,
      action?: ToastAction
    ) => {
      const newToast = {
        id: uuidv4(),
        message,
        type,
        duration: duration ?? 2000,
        action,
      };
      setToast(newToast);
    },
    []
  );

  const hideToast = useCallback(() => {
    setToast(null);
  }, []);

  globalShowToast = showToast;
  const contextValue = useMemo(
    () => ({ showToast, hideToast }),
    [hideToast, showToast]
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <ToastContainer toast={toast} onClose={hideToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
