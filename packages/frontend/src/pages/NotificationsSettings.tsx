import { Preferences } from '@pomi/shared';
import { TASK_PRIORITIES } from '@pomi/shared/src/constants';
import { useEffect, useState } from 'react';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { DurationSlider } from '../components/ui/DurationSlider';
import { Separator } from '../components/ui/Separator';
import { ToggleField } from '../components/ui/ToggleField';
import { MILLISECONDS_PER_MINUTE } from '../constants/time';
import {
  checkBatteryOptimizationStatus,
  requestBatteryOptimizationExemption,
} from '../utils/batteryOptimization';
import { stopAndroidForegroundSync } from '../utils/androidForegroundSync';
import { notificationService } from '../utils/notificationUtils';
import { isAndroid, isDesktop } from '../utils/osUtils';
import { CheckboxRow } from './notifications/CheckboxRow';
import { TaskPriorityMultiSelect } from '../components/settings/TaskPriorityMultiSelect';
import { NumberField } from '../components/ui/NumberField';
import { SettingsControlGroup } from '../components/settings/SettingsExperience';
import { useI18n } from '../i18n';

export const NotificationsSettings = ({
  preferences,
  updatePreference,
}: {
  preferences: Preferences;
  updatePreference: (key: keyof Preferences, value: any) => Promise<void>;
}) => {
  const { t } = useI18n();
  const [hasGivenPermission, setHasGivenPermission] = useState(false);
  const [isBatteryOptimized, setIsBatteryOptimized] = useState(false);
  const maxNotifyBeforeMinutes = Math.max(
    1,
    Math.round(preferences.workTimerDuration / MILLISECONDS_PER_MINUTE)
  );
  const initialNotifyBeforeMinutes = Math.round(
    (preferences.notifyBeforeTime ?? MILLISECONDS_PER_MINUTE) /
      MILLISECONDS_PER_MINUTE
  );
  const [notifyBeforeMinutes, setNotifyBeforeMinutes] = useState(
    Math.min(Math.max(initialNotifyBeforeMinutes, 1), maxNotifyBeforeMinutes)
  );

  useEffect(() => {
    let isActive = true;
    const checkPermission = async () => {
      const permission = await notificationService.checkPermission();
      if (isActive) {
        setHasGivenPermission(permission);
      }
    };
    const checkBatteryStatus = async () => {
      if (isAndroid) {
        const status = await checkBatteryOptimizationStatus();

        if (isActive) {
          setIsBatteryOptimized(status.isOptimized);
        }
      }
    };
    checkPermission();
    checkBatteryStatus();
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        checkPermission();
        checkBatteryStatus();
      }
    };
    if (!isDesktop) {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    return () => {
      isActive = false;
      if (!isDesktop) {
        document.removeEventListener(
          'visibilitychange',
          handleVisibilityChange
        );
      }
    };
  }, []);

  useEffect(() => {
    setNotifyBeforeMinutes(
      Math.min(
        Math.max(
          Math.round(
            (preferences.notifyBeforeTime ?? MILLISECONDS_PER_MINUTE) /
              MILLISECONDS_PER_MINUTE
          ),
          1
        ),
        maxNotifyBeforeMinutes
      )
    );
  }, [maxNotifyBeforeMinutes, preferences.notifyBeforeTime]);

  const notificationsEnabled = isDesktop
    ? preferences.notifications
    : preferences.pushNotifications;

  const taskNotificationSettings = preferences.tasksExtension ? (
    <SettingsControlGroup title={t('notifications.taskReminders')}>
      <div
        id="task-notification-settings"
        data-setting-id="taskNotifications"
        className="space-y-5"
      >
        <TaskPriorityMultiSelect
          value={preferences.taskReminderPriorities ?? []}
          onChange={value => updatePreference('taskReminderPriorities', value)}
        />

        <ToggleField
          id="taskUrgentReminderRepeatEnabled"
          checked={preferences.taskUrgentReminderRepeatEnabled ?? true}
          onChange={value =>
            updatePreference('taskUrgentReminderRepeatEnabled', value)
          }
          disabled={
            !(preferences.taskReminderPriorities ?? []).includes(
              TASK_PRIORITIES.URGENT
            )
          }
          label={t('notifications.repeatUrgent')}
          description={
            (preferences.taskReminderPriorities ?? []).includes(
              TASK_PRIORITIES.URGENT
            )
              ? t('notifications.repeatUrgentDescription')
              : t('notifications.selectUrgentDescription')
          }
        />

        {preferences.taskUrgentReminderRepeatEnabled &&
        (preferences.taskReminderPriorities ?? []).includes(
          TASK_PRIORITIES.URGENT
        ) ? (
          <NumberField
            id="taskUrgentReminderRepeatIntervalMinutes"
            label={t('notifications.repeatEvery')}
            value={preferences.taskUrgentReminderRepeatIntervalMinutes ?? 30}
            min={1}
            onChange={event => {
              const minutes = Number(event.target.value);
              if (Number.isInteger(minutes) && minutes >= 1) {
                void updatePreference(
                  'taskUrgentReminderRepeatIntervalMinutes',
                  minutes
                );
              }
            }}
            helperText={t('notifications.repeatEveryDescription')}
          />
        ) : null}
      </div>
    </SettingsControlGroup>
  ) : null;

  const notifyBeforeSliderValue = preferences.notifyBeforeWorkComplete
    ? Math.min(notifyBeforeMinutes, maxNotifyBeforeMinutes)
    : 0;

  const notifyBeforeTickMarks = [
    { value: 0, label: t('common.off') },
    ...(maxNotifyBeforeMinutes > 2
      ? [
          {
            value: Math.max(1, Math.round(maxNotifyBeforeMinutes / 2)),
            label: `${Math.max(1, Math.round(maxNotifyBeforeMinutes / 2))}m`,
          },
        ]
      : []),
    { value: maxNotifyBeforeMinutes, label: `${maxNotifyBeforeMinutes}m` },
  ].filter(
    (mark, index, marks) =>
      marks.findIndex(candidate => candidate.value === mark.value) === index
  );

  const handleNotifyBeforeChange = async (minutes: number) => {
    const boundedMinutes = Math.max(
      0,
      Math.min(minutes, maxNotifyBeforeMinutes)
    );

    if (boundedMinutes === 0) {
      if (preferences.notifyBeforeWorkComplete) {
        await updatePreference('notifyBeforeWorkComplete', false);
      }
      return;
    }

    setNotifyBeforeMinutes(boundedMinutes);

    if (!preferences.notifyBeforeWorkComplete) {
      await updatePreference('notifyBeforeWorkComplete', true);
    }

    await updatePreference(
      'notifyBeforeTime',
      boundedMinutes * MILLISECONDS_PER_MINUTE
    );
  };

  const handleMobileNotificationsToggle = async (value: boolean) => {
    await updatePreference('pushNotifications', value);

    if (!value) {
      await stopAndroidForegroundSync({
        clearOptIn: true,
        clearAuth: true,
      });
    }
  };

  if (!isDesktop && !hasGivenPermission) {
    return (
      <>
        <Alert variant="warning">{t('notifications.permissionRequired')}</Alert>
        <div className="flex justify-center">
          <Button
            className="mt-6"
            onClick={async () => {
              const granted =
                await notificationService.requestPermissionIfNeeded();
              if (granted) {
                setHasGivenPermission(true);
              } else {
                const refreshed = await notificationService.checkPermission();
                setHasGivenPermission(refreshed);
              }
            }}
          >
            {t('common.enable')} {t('notifications.notifications')}
          </Button>
        </div>
        {taskNotificationSettings}
      </>
    );
  }

  return (
    <div className="space-y-4">
      {isAndroid && isBatteryOptimized && (
        <button
          onClick={async () => {
            const success = await requestBatteryOptimizationExemption();

            if (success) {
              setTimeout(async () => {
                const status = await checkBatteryOptimizationStatus();
                setIsBatteryOptimized(status.isOptimized);
              }, 1000);
            }
          }}
          className="w-full rounded-lg border border-amber-400/50 bg-amber-500/10 px-4 py-3 text-left transition-colors hover:bg-amber-500/20"
        >
          <div className="flex items-start gap-3">
            <span className="text-amber-400 text-lg">⚡</span>
            <div>
              <p className="text-sm font-medium text-amber-200">
                {t('notifications.backgroundUsage')}
              </p>
              <p className="text-xs text-amber-200/70 mt-1">
                {t('notifications.backgroundUsageDescription')}
              </p>
            </div>
          </div>
        </button>
      )}
      <SettingsControlGroup title={t('intention.essentials')}>
        {isDesktop && (
          <>
            <ToggleField
              id="notifications"
              checked={preferences.notifications}
              onChange={value => updatePreference('notifications', value)}
              label={t('notifications.notifications')}
            />

            {preferences.notifications && (
              <>
                <Separator />

                <div>
                  <h3 className="text-sm text-white font-medium mb-3">
                    {t('notifications.method')}
                  </h3>

                  <CheckboxRow
                    leftLabel={t('notifications.sound')}
                    leftChecked={preferences.soundNotifications}
                    onLeftChange={value =>
                      updatePreference('soundNotifications', value)
                    }
                    rightLabel={t('notifications.notification')}
                    rightChecked={preferences.pushNotifications}
                    onRightChange={value =>
                      updatePreference('pushNotifications', value)
                    }
                  />
                </div>
              </>
            )}
          </>
        )}

        {!isDesktop && (
          <ToggleField
            id="push-notifications"
            checked={preferences.pushNotifications}
            onChange={handleMobileNotificationsToggle}
            label={t('notifications.notifications')}
          />
        )}
      </SettingsControlGroup>

      {notificationsEnabled && (
        <SettingsControlGroup title={t('notifications.personalize')}>
          <div>
            <h3 className="mb-3 text-sm font-medium text-white">
              {t('notifications.timerFinished')}
            </h3>
            <CheckboxRow
              leftLabel={t('common.work')}
              leftChecked={preferences.notifyOnWorkComplete}
              onLeftChange={value =>
                updatePreference('notifyOnWorkComplete', value)
              }
              rightLabel={t('common.break')}
              rightChecked={preferences.notifyOnBreakComplete}
              onRightChange={value =>
                updatePreference('notifyOnBreakComplete', value)
              }
            />
          </div>

          <Separator />

          <DurationSlider
            label={t('notifications.notifyBeforeTimerEnds')}
            value={notifyBeforeSliderValue}
            min={0}
            max={maxNotifyBeforeMinutes}
            onChange={handleNotifyBeforeChange}
            onLiveChange={minutes =>
              setNotifyBeforeMinutes(
                Math.max(0, Math.min(minutes, maxNotifyBeforeMinutes))
              )
            }
            accentColor="indigo"
            tickMarks={notifyBeforeTickMarks}
          />
        </SettingsControlGroup>
      )}

      {taskNotificationSettings}
    </div>
  );
};
