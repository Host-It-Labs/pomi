import { Preferences } from '@pomi/shared';
import { useEffect, useRef, useState } from 'react';
import { FaHistory, FaPlusCircle } from 'react-icons/fa';
import { ExtrasSection } from '../components/ExtrasSection';
import { DurationSlider } from '../components/ui/DurationSlider';
import { Separator } from '../components/ui/Separator';
import { ToggleField } from '../components/ui/ToggleField';
import { SettingsControlGroup } from '../components/settings/SettingsExperience';
import { MILLISECONDS_PER_MINUTE } from '../constants/time';
import { useI18n } from '../i18n';

export const TimerSettings = ({
  preferences,
  updatePreference,
  updatePreferences,
  workMinutes,
  breakMinutes,
}: {
  preferences: Preferences;
  updatePreference: (key: keyof Preferences, value: any) => Promise<void>;
  updatePreferences: (updates: Partial<Preferences>) => Promise<void>;
  workMinutes: number;
  breakMinutes: number;
}) => {
  const [highlightTimerExtension, setHighlightTimerExtension] = useState(false);
  const highlightTimeoutRef = useRef<number | null>(null);
  const isTimerExtensionEnabled = preferences.timerExtension ?? false;
  const { t } = useI18n();

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  const revealTimerExtensionSetting = () => {
    setHighlightTimerExtension(true);

    if (highlightTimeoutRef.current) {
      window.clearTimeout(highlightTimeoutRef.current);
    }

    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightTimerExtension(false);
    }, 1800);

    window.setTimeout(() => {
      document
        .querySelector('[data-setting-id="timerExtension"]')
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 0);
  };

  return (
    <div className="space-y-4">
      <SettingsControlGroup title={t('settings.essentials')}>
        <DurationSlider
          label={t('timerSettings.focusLength')}
          value={workMinutes}
          min={1}
          max={120}
          onChange={minutes =>
            updatePreference(
              'workTimerDuration',
              minutes * MILLISECONDS_PER_MINUTE
            )
          }
          accentColor="indigo"
          tickMarks={[
            { value: 1, label: '1m' },
            { value: 30, label: '30m' },
            { value: 60, label: '60m' },
            { value: 90, label: '90m' },
            { value: 120, label: '120m' },
          ]}
        />

        <Separator />

        <DurationSlider
          label={t('timerSettings.breakLength')}
          value={breakMinutes}
          min={1}
          max={30}
          onChange={minutes =>
            updatePreference(
              'breakTimerDuration',
              minutes * MILLISECONDS_PER_MINUTE
            )
          }
          accentColor="green"
          tickMarks={[
            { value: 1, label: '1m' },
            { value: 5, label: '5m' },
            { value: 15, label: '15m' },
            { value: 30, label: '30m' },
          ]}
        />

        <Separator />

        <ToggleField
          id="autoStartBreak"
          checked={isTimerExtensionEnabled ? false : preferences.autoStartBreak}
          onChange={value => updatePreference('autoStartBreak', value)}
          label={t('timerSettings.autoStartBreaks')}
          disabled={isTimerExtensionEnabled}
          onDisabledClick={revealTimerExtensionSetting}
          description={
            isTimerExtensionEnabled
              ? t('timerSettings.autoStartBreaksDisabled')
              : undefined
          }
        />
      </SettingsControlGroup>

      <ExtrasSection sectionId="timer">
        <ToggleField
          id="advancedSkip"
          checked={preferences.advancedSkip ?? false}
          onChange={value => updatePreference('advancedSkip', value)}
          label={t('timerSettings.saveTimeWhenSkipping')}
          icon={<FaHistory size={12} />}
          description={t('timerSettings.saveTimeWhenSkippingDescription')}
        />

        <Separator />

        <ToggleField
          id="timerExtension"
          checked={preferences.timerExtension ?? false}
          onChange={async value => {
            await updatePreferences(
              value
                ? { timerExtension: true, autoStartBreak: false }
                : { timerExtension: false }
            );
          }}
          label={t('timerSettings.keepGoing')}
          icon={<FaPlusCircle size={12} />}
          description={t('timerSettings.keepGoingDescription')}
          className={
            highlightTimerExtension
              ? 'rounded-lg bg-indigo-500/10 outline outline-2 outline-indigo-400/60 outline-offset-4 transition-colors'
              : 'rounded-lg outline outline-2 outline-transparent outline-offset-4 transition-colors'
          }
        />
      </ExtrasSection>
    </div>
  );
};
