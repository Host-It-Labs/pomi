import { v4 as uuidv4 } from 'uuid';
import { create } from 'zustand';
import { InAppNotificationData } from '../app/InAppNotification';
import { createSelectors } from './createSelectors';

interface InAppNotificationState {
  notification: InAppNotificationData | null;
  showNotification: (notification: Omit<InAppNotificationData, 'id'>) => void;
  dismissNotification: () => void;
}

export const createInAppNotificationStore = (createId: () => string) =>
  create<InAppNotificationState>(set => ({
    notification: null,
    showNotification: notification => {
      set({
        notification: {
          id: createId(),
          ...notification,
        },
      });
    },
    dismissNotification: () => set({ notification: null }),
  }));

const useInAppNotificationStoreBase = createInAppNotificationStore(uuidv4);

export const useInAppNotificationStore = createSelectors(
  useInAppNotificationStoreBase
);
export { useInAppNotificationStoreBase };
