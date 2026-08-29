import { Preferences } from '@pomi/shared';
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
  workMinutes,
  breakMinutes,
}: {
  preferences: Preferences;
  updatePreference: (key: keyof Preferences, value: any) => Promise<void>;
  workMinutes: number;
  breakMinutes: number;
}) => {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <SettingsControlGroup title={t('settings.essentials')}>
        <div data-setting-id="focusLength">
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
        </div>

        <Separator />

        <div data-setting-id="breakLength">
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
        </div>

        <Separator />

        <ToggleField
          id="autoStartBreak"
          checked={preferences.autoStartBreak}
          onChange={value => updatePreference('autoStartBreak', value)}
          label={t('timerSettings.autoStartBreaks')}
          description={t('timerSettings.autoStartBreaksDescription')}
        />

        <Separator />

        <ToggleField
          id="resetBreakOnFirstIntention"
          checked={preferences.resetBreakOnFirstIntention ?? false}
          onChange={value =>
            updatePreference('resetBreakOnFirstIntention', value)
          }
          label={t('timerSettings.resetBreakOnFirstIntention')}
          description={t('timerSettings.resetBreakOnFirstIntentionDescription')}
        />

        <Separator />

        <ToggleField
          id="resetLongBreakOnFirstIntention"
          checked={preferences.resetLongBreakOnFirstIntention ?? false}
          onChange={value =>
            updatePreference('resetLongBreakOnFirstIntention', value)
          }
          label={t('timerSettings.resetLongBreakOnFirstIntention')}
          description={t(
            'timerSettings.resetLongBreakOnFirstIntentionDescription'
          )}
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
          onChange={value => updatePreference('timerExtension', value)}
          label={t('timerSettings.keepGoing')}
          icon={<FaPlusCircle size={12} />}
          description={t('timerSettings.keepGoingDescription')}
        />
      </ExtrasSection>
    </div>
  );
};
