import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import {
  IN_APP_NOTIFICATION_TYPES,
  InAppNotificationType,
} from '../constants/notifications';
import { useI18n } from '../i18n';

export interface InAppNotificationData {
  id: string;
  title: string;
  body: string;
  type: InAppNotificationType;
}

interface InAppNotificationProps {
  notification: InAppNotificationData | null;
  onClose: () => void;
  isMinimized?: boolean;
}

export function InAppNotification({
  notification,
  onClose,
  isMinimized = false,
}: InAppNotificationProps) {
  const { t } = useI18n();
  useEffect(() => {
    if (!notification) return;

    const timer = setTimeout(() => {
      onClose();
    }, 5000);

    return () => clearTimeout(timer);
  }, [notification?.id, onClose]);

  const getNotificationStyles = () => {
    if (!notification) return '';

    switch (notification.type) {
      case IN_APP_NOTIFICATION_TYPES.WORK:
        return 'bg-green-900/95 border-green-500';
      case IN_APP_NOTIFICATION_TYPES.LONG_BREAK:
        return 'bg-purple-900/95 border-purple-500';
      case IN_APP_NOTIFICATION_TYPES.BREAK:
        return 'bg-blue-900/95 border-blue-500';
      case IN_APP_NOTIFICATION_TYPES.WARNING:
        return 'bg-amber-900/95 border-amber-500';
      default:
        return 'bg-slate-800/95 border-slate-600';
    }
  };

  const getIcon = () => {
    if (!notification) return null;

    switch (notification.type) {
      case IN_APP_NOTIFICATION_TYPES.WORK:
        return (
          <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-green-400"
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
          </div>
        );
      case IN_APP_NOTIFICATION_TYPES.LONG_BREAK:
        return (
          <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-purple-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
              />
            </svg>
          </div>
        );
      case IN_APP_NOTIFICATION_TYPES.BREAK:
        return (
          <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-blue-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
        );
      case IN_APP_NOTIFICATION_TYPES.WARNING:
        return (
          <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-amber-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <AnimatePresence>
      {notification && (
        <motion.div
          data-testid="in-app-notification"
          initial={{ opacity: 0, y: isMinimized ? -16 : -100, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: isMinimized ? -10 : -50, scale: 0.95 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className={clsx(
            'fixed z-[100] border shadow-2xl backdrop-blur-sm',
            isMinimized
              ? 'top-[10%] bottom-[10%] left-[128px] right-[132px] mx-0 mt-0 rounded-lg'
              : 'top-0 left-0 right-0 mx-4 mt-12 rounded-2xl border-2',
            getNotificationStyles()
          )}
        >
          <div
            className={clsx(
              'flex items-center',
              isMinimized ? 'h-full gap-1.5 px-2 py-1.5' : 'gap-3 p-4'
            )}
          >
            {!isMinimized && getIcon()}
            <div className="flex-1 min-w-0">
              <h3
                className={clsx(
                  'font-semibold text-ink',
                  isMinimized
                    ? 'line-clamp-2 text-[13px] leading-4'
                    : 'truncate text-base'
                )}
              >
                {notification.title}
              </h3>
              <p
                className={clsx(
                  'text-ink/80',
                  isMinimized
                    ? 'mt-1 line-clamp-2 text-[11px] leading-[14px]'
                    : 'mt-0.5 line-clamp-2 text-sm'
                )}
              >
                {notification.body}
              </p>
            </div>
            <button
              onClick={onClose}
              className={clsx(
                'rounded-full transition-colors hover:bg-white/10',
                isMinimized ? 'p-1' : 'p-2'
              )}
              aria-label={t('notification.dismiss')}
              title={t('notification.dismiss')}
            >
              <svg
                className={clsx(
                  'text-ink/70',
                  isMinimized ? 'h-3 w-3' : 'h-5 w-5'
                )}
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
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
