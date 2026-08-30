import { Preferences, type TimerTypes } from '@pomi/shared';
import { FaHistory, FaPlusCircle } from 'react-icons/fa';
import { ExtrasSection } from '../components/ExtrasSection';
import { DurationSlider } from '../components/ui/DurationSlider';
import { Separator } from '../components/ui/Separator';
import { ToggleField } from '../components/ui/ToggleField';
import { SettingsControlGroup } from '../components/settings/SettingsExperience';
import { MILLISECONDS_PER_MINUTE } from '../constants/time';
import { useI18n } from '../i18n';
import clsx from 'clsx';
import { TIMER_TYPES } from '@pomi/shared/src/constants';

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
  const { t } = useI18n();
  const autoStartTypes = {
    [TIMER_TYPES.WORK]: preferences.autoStartWork ?? false,
    [TIMER_TYPES.BREAK]: preferences.autoStartBreak,
    [TIMER_TYPES.LONG_BREAK]: preferences.autoStartLongBreak ?? false,
  };
  const resetTypes = {
    [TIMER_TYPES.WORK]: preferences.resetWorkOnFirstIntention ?? false,
    [TIMER_TYPES.BREAK]: preferences.resetBreakOnFirstIntention ?? false,
    [TIMER_TYPES.LONG_BREAK]:
      preferences.resetLongBreakOnFirstIntention ?? false,
  };

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

        <div data-setting-id="autoStartBreak" className="space-y-2">
          <ToggleField
            id="autoStartBreak"
            checked={Object.values(autoStartTypes).some(Boolean)}
            onChange={value =>
              updatePreferences({
                autoStartWork: value,
                autoStartBreak: value,
                autoStartLongBreak: value,
              })
            }
            label={t('timerSettings.autoStartBreaks')}
            description={t('timerSettings.autoStartBreaksDescription')}
          />
          <TimerTypeBadges
            values={autoStartTypes}
            onToggle={type =>
              updatePreferences({
                ...(type === TIMER_TYPES.WORK
                  ? { autoStartWork: !autoStartTypes[type] }
                  : type === TIMER_TYPES.BREAK
                    ? { autoStartBreak: !autoStartTypes[type] }
                    : { autoStartLongBreak: !autoStartTypes[type] }),
              })
            }
          />
        </div>

        <Separator />

        <div data-setting-id="resetBreakOnFirstIntention" className="space-y-2">
          <ToggleField
            id="resetBreakOnFirstIntention"
            checked={Object.values(resetTypes).some(Boolean)}
            onChange={value =>
              updatePreferences({
                resetWorkOnFirstIntention: value,
                resetBreakOnFirstIntention: value,
                resetLongBreakOnFirstIntention: value,
              })
            }
            label={t('timerSettings.resetBreakOnFirstIntention')}
            description={t(
              'timerSettings.resetBreakOnFirstIntentionDescription'
            )}
          />
          <TimerTypeBadges
            values={resetTypes}
            onToggle={type =>
              updatePreferences({
                ...(type === TIMER_TYPES.WORK
                  ? {
                      resetWorkOnFirstIntention: !resetTypes[type],
                    }
                  : type === TIMER_TYPES.BREAK
                    ? {
                        resetBreakOnFirstIntention: !resetTypes[type],
                      }
                    : {
                        resetLongBreakOnFirstIntention: !resetTypes[type],
                      }),
              })
            }
          />
        </div>
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

function TimerTypeBadges({
  values,
  onToggle,
}: {
  values: Record<TimerTypes, boolean>;
  onToggle: (type: TimerTypes) => void;
}) {
  const { t } = useI18n();
  const options = [
    { type: TIMER_TYPES.WORK, label: t('common.work') },
    { type: TIMER_TYPES.BREAK, label: t('common.break') },
    { type: TIMER_TYPES.LONG_BREAK, label: t('common.longBreak') },
  ];
  return (
    <div
      className="flex flex-wrap gap-1.5 pl-1"
      aria-label={t('settings.timer')}
    >
      {options.map(option => (
        <button
          key={option.type}
          type="button"
          aria-pressed={values[option.type]}
          onClick={() => onToggle(option.type)}
          className={clsx(
            'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
            values[option.type]
              ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-200'
              : 'border-slate-700/70 bg-slate-900/50 text-slate-500 hover:text-slate-300'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
