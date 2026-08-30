import { Preferences } from '@pomi/shared';
import type { ReactNode } from 'react';
import { FaInfoCircle, FaLightbulb, FaSignOutAlt } from 'react-icons/fa';
import { ExtrasSection } from '../components/ExtrasSection';
import { Button } from '../components/ui/Button';
import { Separator } from '../components/ui/Separator';
import { ToggleField } from '../components/ui/ToggleField';
import { SettingsControlGroup } from '../components/settings/SettingsExperience';
import { useAuthStore } from '../stores/authStore';
import { useUiStore } from '../stores/uiStore';
import { canUseDebugPanel } from '../utils/debugAccess';
import { isMobile } from '../utils/osUtils';
import { normalizeLanguage, SUPPORTED_LANGUAGES, useI18n } from '../i18n';

interface GeneralSettingsProps {
  preferences: Preferences;
  updatePreference: (key: keyof Preferences, value: any) => Promise<unknown>;
  updateLanguagePreference?: (
    language: Preferences['language']
  ) => Promise<boolean>;
  reloadPreferences?: (options?: { syncTimeZone?: boolean }) => Promise<void>;
  adminContent?: ReactNode;
}

export const GeneralSettings = ({
  preferences,
  updatePreference,
  updateLanguagePreference,
  reloadPreferences,
  adminContent,
}: GeneralSettingsProps) => {
  const { language, setLanguage, t } = useI18n();
  const signOut = useAuthStore.use.signOut();
  const user = useAuthStore.use.user();
  const setActiveTab = useUiStore.use.setActiveTab();
  const showDebugPanel = canUseDebugPanel(user);
  const hiddenHelpTipsCount = preferences.hiddenHelpTips?.length ?? 0;
  const selectedLanguage = language;

  const handleLanguageChange = async (nextLanguage: string) => {
    const normalized = normalizeLanguage(nextLanguage);
    if (!normalized) {
      return;
    }

    const previousLanguage = language;
    if (normalized === previousLanguage) {
      return;
    }

    setLanguage(normalized, { persist: true });

    try {
      const persisted = updateLanguagePreference
        ? await updateLanguagePreference(normalized)
        : (await updatePreference('language', normalized)) !== false;

      if (persisted) {
        return;
      }
    } catch {
      // The authoritative read below restores the previous account value.
    }

    try {
      await reloadPreferences?.({ syncTimeZone: false });
    } catch {
      // Keep the local rollback even when the recovery read is unavailable.
    } finally {
      setLanguage(previousLanguage, { persist: true });
    }
  };

  return (
    <div className="space-y-4">
      <SettingsControlGroup title={t('settings.essentials')}>
        <div
          className="flex items-center justify-between"
          data-setting-id="general-account"
        >
          <div>
            <h3 className="text-sm text-white font-medium">
              {t('settings.account')}
            </h3>
            <p className="text-xs text-slate-400 mt-1">{user?.username}</p>
          </div>
          <Button
            variant="danger"
            onClick={signOut}
            className="gap-2"
            data-setting-id="logout"
          >
            <FaSignOutAlt />
            <span>{t('common.logOut')}</span>
          </Button>
        </div>

        <Separator />

        <div
          className="flex items-center justify-between gap-4"
          data-setting-id="settings-language"
        >
          <div>
            <label
              htmlFor="settings-language"
              className="text-sm font-medium text-white"
            >
              {t('common.language')}
            </label>
            <p className="mt-1 text-xs text-slate-400">
              {t('common.languageDescription')}
            </p>
          </div>
          <select
            id="settings-language"
            aria-label={t('common.language')}
            value={selectedLanguage}
            onChange={event => {
              void handleLanguageChange(event.target.value);
            }}
            className="max-w-[12rem] rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-indigo-400"
          >
            {SUPPORTED_LANGUAGES.map(option => (
              <option key={option.code} value={option.code}>
                {option.nativeName}
              </option>
            ))}
          </select>
        </div>

        {(showDebugPanel || isMobile) && <Separator />}

        {showDebugPanel && (
          <div className="flex justify-end" data-setting-id="openDebugPanel">
            <Button
              type="button"
              onClick={() => setActiveTab('debug')}
              variant="secondary"
            >
              {t('settings.openDebugPanel')}
            </Button>
          </div>
        )}

        {showDebugPanel && isMobile && <Separator />}

        <ToggleField
          id="undoAlerts"
          checked={preferences.undoAlerts}
          onChange={value => updatePreference('undoAlerts', value)}
          label={t('settings.undoAlerts')}
          description={t('settings.undoAlertsDescription')}
        />

        {isMobile && (
          <ToggleField
            id="keep-screen-awake"
            checked={preferences.keepScreenAwake}
            onChange={value => updatePreference('keepScreenAwake', value)}
            label={t('settings.keepScreenAwake')}
            description={t('settings.keepScreenAwakeDescription')}
          />
        )}
      </SettingsControlGroup>

      <ExtrasSection sectionId="general">
        <div
          className="flex items-center justify-between gap-4 rounded-lg border border-slate-800/60 bg-slate-900/35 p-3"
          data-setting-id="hiddenTips"
        >
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-amber-400/10 text-amber-300">
              <FaLightbulb size={12} />
            </span>
            <h3 className="text-sm font-medium text-white">
              {t('settings.hiddenTips')}
            </h3>
            <button
              type="button"
              aria-label={t('settings.hiddenTipsAbout')}
              title={t('settings.hiddenTipsAbout')}
              className="text-slate-600 hover:text-slate-300"
            >
              <FaInfoCircle size={12} />
            </button>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => updatePreference('hiddenHelpTips', [])}
            disabled={hiddenHelpTipsCount === 0}
          >
            {t('common.restore')}
          </Button>
        </div>
      </ExtrasSection>

      {adminContent ? (
        <div data-setting-id="admin">
          <SettingsControlGroup title={t('settings.admin')}>
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-white">
                {t('settings.aiInfrastructure')}
              </h4>
              {adminContent}
            </div>
          </SettingsControlGroup>
        </div>
      ) : null}
    </div>
  );
};
