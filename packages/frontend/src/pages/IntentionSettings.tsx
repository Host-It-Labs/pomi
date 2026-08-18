import { Preferences } from '@pomi/shared';
import {
  FaCalendarCheck,
  FaChartBar,
  FaClock,
  FaCoffee,
  FaListUl,
  FaSitemap,
} from 'react-icons/fa';
import { ExtrasSection } from '../components/ExtrasSection';
import { Separator } from '../components/ui/Separator';
import { ToggleField } from '../components/ui/ToggleField';
import { SettingsControlGroup } from '../components/settings/SettingsExperience';
import { useI18n } from '../i18n';

interface IntentionSettingsProps {
  preferences: Preferences;
  updatePreference: (key: keyof Preferences, value: any) => Promise<void>;
}

export const IntentionSettings = ({
  preferences,
  updatePreference,
}: IntentionSettingsProps) => {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <SettingsControlGroup title={t('intention.essentials')}>
        <ToggleField
          id="intentionBreakIntentions"
          checked={preferences.intentionBreakIntentions ?? false}
          onChange={value =>
            updatePreference('intentionBreakIntentions', value)
          }
          label={t('intention.breakIntentions')}
          description={t('intention.breakIntentionsDescription')}
        />

        <Separator />

        <ToggleField
          id="intentionRequireSelection"
          checked={preferences.intentionRequireSelection ?? false}
          onChange={value =>
            updatePreference('intentionRequireSelection', value)
          }
          label={t('intention.requireSelection')}
          description={t('intention.requireSelectionDescription')}
        />
      </SettingsControlGroup>

      <ExtrasSection sectionId="intentions">
        <ToggleField
          id="intentionShowDailyCount"
          checked={preferences.intentionShowDailyCount ?? false}
          onChange={value => updatePreference('intentionShowDailyCount', value)}
          label={t('intention.showDailyCount')}
          icon={<FaChartBar size={12} />}
          description={t('intention.showDailyCountDescription')}
        />

        <Separator />

        <ToggleField
          id="intentionMultiSelect"
          checked={preferences.intentionMultiSelect ?? false}
          onChange={value => updatePreference('intentionMultiSelect', value)}
          label={t('intention.multiSelect')}
          icon={<FaListUl size={12} />}
          description={t('intention.multiSelectDescription')}
        />

        <Separator />

        <ToggleField
          id="intentionShowBreakIntentionsInLongBreak"
          checked={preferences.intentionShowBreakIntentionsInLongBreak ?? false}
          onChange={value =>
            updatePreference('intentionShowBreakIntentionsInLongBreak', value)
          }
          label={t('intention.shareBreakIntentions')}
          icon={<FaCoffee size={12} />}
          description={t('intention.shareBreakIntentionsDescription')}
        />

        <Separator />

        <ToggleField
          id="intentionCustomDurations"
          checked={preferences.intentionCustomDurations ?? false}
          onChange={value =>
            updatePreference('intentionCustomDurations', value)
          }
          label={t('intention.customDurations')}
          icon={<FaClock size={12} />}
          description={t('intention.customDurationsDescription')}
        />

        <Separator />

        <ToggleField
          id="intentionSubIntentions"
          checked={preferences.intentionSubIntentions ?? false}
          onChange={value => updatePreference('intentionSubIntentions', value)}
          label={t('intention.subIntentions')}
          icon={<FaSitemap size={12} />}
          description={t('intention.subIntentionsDescription')}
        />

        <Separator />

        <ToggleField
          id="intentionHabits"
          checked={preferences.intentionHabits ?? false}
          onChange={value => updatePreference('intentionHabits', value)}
          label={t('intention.habits')}
          icon={<FaCalendarCheck size={12} />}
          description={t('intention.habitsDescription')}
        />
      </ExtrasSection>
    </div>
  );
};
