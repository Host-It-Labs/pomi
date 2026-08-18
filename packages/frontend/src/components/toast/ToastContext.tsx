import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ToastContainer, ToastType } from './Toast';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextType {
  showToast: (message: string, type: ToastType, duration?: number) => void;
  hideToast: () => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

let globalShowToast:
  | ((message: string, type: ToastType, duration?: number) => void)
  | null = null;

export function showToastFromStore(
  message: string,
  type: ToastType,
  duration?: number
) {
  if (globalShowToast) {
    globalShowToast(message, type, duration);
  }
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = useCallback(
    (message: string, type: ToastType, duration = 2000) => {
      const newToast = {
        id: uuidv4(),
        message,
        type,
        duration,
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
