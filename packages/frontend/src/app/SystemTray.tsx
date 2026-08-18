import { TIMER_STATUSES, TIMER_TYPES } from '@pomi/shared/src/constants';
import { Menu } from '@tauri-apps/api/menu';
import { TrayIcon } from '@tauri-apps/api/tray';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef, useState } from 'react';
import { HEX_COLORS } from '../config/colors';
import { useTimerStore } from '../stores/timerStore';
import { generateMiniTimerIcon } from '../utils/generateMiniTimerIcon';
import { isDesktop } from '../utils/osUtils';

export function SystemTray() {
  const timer = useTimerStore.use.timer();
  const toggleTimer = useTimerStore.use.toggleTimer();
  const resetTimer = useTimerStore.use.resetTimer();
  const skipTimer = useTimerStore.use.skipTimer();
  const [trayInstance, setTrayInstance] = useState<TrayIcon | null>(null);
  const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isDesktop) return;

    const Window = getCurrentWindow();
    const setupTray = async () => {
      try {
        const menu = await Menu.new({
          items: [
            {
              id: 'show-app',
              text: 'Show App',
              action: () => {
                Window.show();
                Window.setFocus();
              },
            },
            { item: 'Separator' },
            {
              id: 'start-resume',
              text: 'Start / Pause Timer',
              action: () => {
                toggleTimer();
              },
            },
            {
              id: 'reset',
              text: 'Reset Timer',
              action: () => resetTimer(),
            },
            {
              id: 'skip',
              text: 'Skip Timer',
              action: () => skipTimer(),
            },
            { item: 'Separator' },
            {
              id: 'quit',
              text: 'Quit',
              action: () => Window.close(),
            },
          ],
        });

        const tray = await TrayIcon.new({
          tooltip: 'Work Timer',
          menu,
        });

        setTrayInstance(tray);
      } catch (error) {
        console.error('Failed to create system tray:', error);
      }
    };

    if (!trayInstance) {
      setupTray();
    }

    return () => {
      if (trayInstance) {
        trayInstance.close();
      }
    };
  }, []);

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

      const color =
        timer.type === TIMER_TYPES.WORK
          ? HEX_COLORS.indigo
          : timer.type === TIMER_TYPES.LONG_BREAK
            ? HEX_COLORS.purple
            : HEX_COLORS.green;

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
