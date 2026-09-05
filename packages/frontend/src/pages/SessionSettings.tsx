import { Preferences } from '@pomi/shared';
import { FaClock, FaLayerGroup, FaMagic, FaStopwatch } from 'react-icons/fa';
import { ExtrasSection } from '../components/ExtrasSection';
import { SettingsControlGroup } from '../components/settings/SettingsExperience';
import { DurationValueBadge } from '../components/ui/DurationValueBadge';
import { Separator } from '../components/ui/Separator';
import { ToggleField } from '../components/ui/ToggleField';
import { MILLISECONDS_PER_MINUTE } from '../constants/time';
import { useI18n } from '../i18n';
import { isDesktop } from '../utils/osUtils';
import { getShortcutLabel } from '../utils/shortcutUtils';

export const SessionSettings = ({
  preferences,
  updatePreference,
}: {
  preferences: Preferences;
  updatePreference: (key: keyof Preferences, value: any) => Promise<void>;
}) => {
  const sessionLongBreakMinutes = Math.round(
    (preferences.sessionLongBreakDuration || 15 * MILLISECONDS_PER_MINUTE) /
      MILLISECONDS_PER_MINUTE
  );
  const sessionPomodorosCount = Math.max(
    1,
    Math.min(10, preferences.sessionPomodorosCount || 3)
  );
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <SettingsControlGroup title={t('settings.essentials')}>
        <div className="space-y-1" data-setting-id="sessionPomodorosCount">
          <div className="flex justify-between items-center">
            <label
              htmlFor="sessionPomodorosCount"
              className="text-sm text-ink font-medium flex-1 mr-3"
            >
              {t('session.focusBlocks')}
            </label>
            <DurationValueBadge
              id="sessionPomodorosCount"
              value={sessionPomodorosCount}
              min={1}
              max={10}
              unitLabel=""
              onChange={count =>
                updatePreference('sessionPomodorosCount', count)
              }
              accentColor="default"
            />
          </div>
        </div>

        <Separator />

        <ToggleField
          id="sessionHasLongBreak"
          checked={preferences.sessionHasLongBreak ?? true}
          onChange={value => updatePreference('sessionHasLongBreak', value)}
          label={t('common.longBreak')}
          description={t('session.longBreakDescription')}
        />

        {preferences.sessionHasLongBreak && (
          <div className="ml-4 space-y-6">
            <div
              className="space-y-1"
              data-setting-id="sessionLongBreakDuration"
            >
              <div className="flex justify-between items-center">
                <label
                  htmlFor="sessionLongBreakDuration"
                  className="text-sm text-ink font-medium flex-1 mr-3"
                >
                  {t('session.longBreakDuration')}
                </label>
                <DurationValueBadge
                  id="sessionLongBreakDuration"
                  value={sessionLongBreakMinutes}
                  min={1}
                  max={60}
                  onChange={minutes =>
                    updatePreference(
                      'sessionLongBreakDuration',
                      minutes * MILLISECONDS_PER_MINUTE
                    )
                  }
                  accentColor="default"
                />
              </div>
            </div>

            <Separator />
          </div>
        )}
      </SettingsControlGroup>

      <ToggleField
        id="sessionAutoDetectLongBreak"
        checked={preferences.sessionAutoDetectLongBreak ?? false}
        onChange={value =>
          updatePreference('sessionAutoDetectLongBreak', value)
        }
        label={t('session.detectLongBreaks')}
        icon={<FaMagic size={12} />}
        description={t('session.detectLongBreaksDescription')}
      />
      <ExtrasSection sectionId="sessions">
        <ToggleField
          id="sessionShowLongBreakButton"
          checked={preferences.sessionShowLongBreakButton ?? false}
          onChange={value =>
            updatePreference('sessionShowLongBreakButton', value)
          }
          label={t('session.showLongBreakButton')}
          icon={<FaStopwatch size={12} />}
          description={t('session.showLongBreakButtonDescription')}
        />

        <Separator />

        <ToggleField
          id="sessionShowEta"
          checked={preferences.sessionShowEta ?? false}
          onChange={value => updatePreference('sessionShowEta', value)}
          label={t('session.showFinishTimes')}
          icon={<FaClock size={12} />}
          description={t('session.showFinishTimesDescription')}
        />

        <Separator />

        <ToggleField
          id="sessionStackTimers"
          checked={preferences.sessionStackTimers ?? false}
          onChange={value => updatePreference('sessionStackTimers', value)}
          label={t('session.combineTimers')}
          icon={<FaLayerGroup size={12} />}
          description={`${t('session.combineTimersDescription')}${
            isDesktop
              ? `\n${t('session.shortcut')}: ${getShortcutLabel(['Shift', 'A'])}`
              : ''
          }`}
        />

        <Separator />
      </ExtrasSection>
    </div>
  );
};
