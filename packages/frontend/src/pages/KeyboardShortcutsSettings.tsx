import { Preferences } from '@pomi/shared';
import { SettingsControlGroup } from '../components/settings/SettingsExperience';
import { Separator } from '../components/ui/Separator';
import { ToggleField } from '../components/ui/ToggleField';
import { usePreferencesStore } from '../stores/preferencesStore';
import { isDesktop } from '../utils/osUtils';
import { getModifierKeyLabel, getShortcutLabel } from '../utils/shortcutUtils';
import { useI18n } from '../i18n';

export const KeyboardShortcutsSettings = ({
  preferences,
  updatePreference,
}: {
  preferences: Preferences;
  updatePreference: (key: keyof Preferences, value: any) => Promise<void>;
}) => {
  const updateStorePreference = usePreferencesStore.use.updatePreference();
  const { t } = useI18n();

  if (!isDesktop) {
    return null;
  }

  const handleToggleChange = async (key: string, value: boolean) => {
    await updatePreference(key as keyof Preferences, value);
    await updateStorePreference(key as any, value);
  };

  const inAppShortcutDescription = `${t('shortcuts.reveal')}\n${t('shortcuts.hold')}: ${getModifierKeyLabel()}`;
  const globalShortcutDescription = `${t('shortcuts.showApp')}\n${t('session.shortcut')}: ${getShortcutLabel(
    ['Shift', 'P']
  )}`;

  return (
    <SettingsControlGroup title={t('settings.essentials')}>
      <ToggleField
        id="globalShortcut"
        checked={preferences.globalShortcut || false}
        onChange={value => {
          handleToggleChange('globalShortcut', value);
        }}
        label={t('shortcuts.openPomi')}
        description={globalShortcutDescription}
      />

      <Separator />

      <ToggleField
        id="keyboardShortcuts"
        checked={preferences.keyboardShortcuts || false}
        onChange={value => handleToggleChange('keyboardShortcuts', value)}
        label={t('shortcuts.inApp')}
        description={inAppShortcutDescription}
      />
    </SettingsControlGroup>
  );
};
