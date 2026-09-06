import { TIMER_STATUSES } from '@pomi/shared/src/constants';
import { Menu } from '@tauri-apps/api/menu';
import { TrayIcon } from '@tauri-apps/api/tray';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef, useState } from 'react';
import { getTimerAccentColor } from '../config/colors';
import { useI18n } from '../i18n';
import { useTimerStore } from '../stores/timerStore';
import { generateMiniTimerIcon } from '../utils/generateMiniTimerIcon';
import { isDesktop } from '../utils/osUtils';

export function SystemTray() {
  const timer = useTimerStore.use.timer();
  const toggleTimer = useTimerStore.use.toggleTimer();
  const resetTimer = useTimerStore.use.resetTimer();
  const skipTimer = useTimerStore.use.skipTimer();
  const { t } = useI18n();
  const [trayInstance, setTrayInstance] = useState<TrayIcon | null>(null);
  const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isDesktop) return;

    const Window = getCurrentWindow();
    let isDisposed = false;
    let currentTray: TrayIcon | null = null;
    const setupTray = async () => {
      try {
        const menu = await Menu.new({
          items: [
            {
              id: 'show-app',
              text: t('shortcuts.showApp'),
              action: () => {
                Window.show();
                Window.setFocus();
              },
            },
            { item: 'Separator' },
            {
              id: 'start-resume',
              text: t('timer.startPause'),
              action: () => {
                toggleTimer();
              },
            },
            {
              id: 'reset',
              text: t('timer.reset'),
              action: () => resetTimer(),
            },
            {
              id: 'skip',
              text: t('timer.skipTimer'),
              action: () => skipTimer(),
            },
            { item: 'Separator' },
            {
              id: 'quit',
              text: t('common.quit'),
              action: () => Window.close(),
            },
          ],
        });

        const tray = await TrayIcon.new({
          tooltip: t('timer.workTimer'),
          menu,
        });

        if (isDisposed) {
          await tray.close();
          return;
        }
        currentTray = tray;
        setTrayInstance(tray);
      } catch (error) {
        console.error('Failed to create system tray:', error);
      }
    };

    setupTray();

    return () => {
      isDisposed = true;
      if (currentTray) {
        currentTray.close();
      }
    };
  }, [resetTimer, skipTimer, t, toggleTimer]);

  useEffect(() => {
    if (!trayInstance || !isDesktop) return;

    const updateTrayInfo = async () => {
      if (!timer) return;

      const isPaused =
        timer.status === TIMER_STATUSES.PAUSED ||
        timer.status === TIMER_STATUSES.COMPLETED;

      const remainingTime =
        timer.status === TIMER_STATUSES.RUNNING
          ? Math.max(0, timer.duration - (Date.now() - timer.startTime))
          : timer.remainingTime;

      const progress = remainingTime / timer.duration;

      const color = getTimerAccentColor(timer.type);

      const iconData = generateMiniTimerIcon(
        progress,
        color,
        Math.floor(remainingTime / 60001) + 1,
        isPaused
      );

      await trayInstance.setIcon(iconData);
    };

    if (updateIntervalRef.current) {
      clearInterval(updateIntervalRef.current);
    }

    updateTrayInfo();

    if (timer?.status === TIMER_STATUSES.RUNNING) {
      updateIntervalRef.current = setInterval(() => {
        updateTrayInfo();
      }, 1000);
    }

    return () => {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
        updateIntervalRef.current = null;
      }
    };
  }, [trayInstance, timer]);

  return null;
}
