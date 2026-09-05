import { Modal } from '../ui/Modal';
import {
  FaRegClock,
  FaListUl,
  FaRobot,
  FaUmbrellaBeach,
  FaLayerGroup,
  FaBullseye,
} from 'react-icons/fa';
import type { Preferences } from '@pomi/shared';
import { SETTINGS_SUGGESTION_IDS } from '@pomi/shared/src/constants';
import { useState } from 'react';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { useAssistantStore } from '../../stores/assistantStore';
import { useUiStore } from '../../stores/uiStore';
import { useI18n } from '../../i18n';
import { Button } from '../ui/Button';

const labels: Record<(typeof SETTINGS_SUGGESTION_IDS)[number], string> = {
  sessionShowEta: 'session.showFinishTimes',
  intentionShowDailyCount: 'intention.showDailyCount',
  sessionShowLongBreakButton: 'session.showLongBreakButton',
  tasksShowInMinimizedTimer: 'task.minimized',
  intentionHabits: 'intention.habits',
  intentionMultiSelect: 'intention.multiSelect',
  vacationExtension: 'task.vacationMode',
  assistantExtension: 'settings.assistant',
  intentionBreakIntentions: 'intention.breakIntentions',
  sessionStackTimers: 'session.combineTimers',
  destinationDescriptionsEnabled: 'workspace.descriptions',
  intentionExtension: 'settings.intentions',
  tasksExtension: 'settings.tasks',
  sessionsExtension: 'settings.sessions',
  listsExtension: 'task.lists',
  intentionCustomDurations: 'intention.customDurations',
  intentionSubIntentions: 'intention.subIntentions',
  advancedSkip: 'timerSettings.saveTimeWhenSkipping',
  timerExtension: 'timerSettings.keepGoing',
};

export function getSettingSuggestions(
  preferences: Preferences,
  assistantConfigured: boolean
) {
  return SETTINGS_SUGGESTION_IDS.filter(id => {
    if (id === 'assistantExtension' && !assistantConfigured) return false;
    if (
      preferences[id] ||
      preferences.dismissedSettingSuggestions?.includes(id)
    )
      return false;
    if (
      id.startsWith('session') &&
      id !== 'sessionsExtension' &&
      !preferences.sessionsExtension
    )
      return false;
    if (
      id.startsWith('intention') &&
      id !== 'intentionExtension' &&
      !preferences.intentionExtension
    )
      return false;
    if (
      [
        'tasksShowInMinimizedTimer',
        'listsExtension',
        'vacationExtension',
      ].includes(id) &&
      !preferences.tasksExtension
    )
      return false;
    return true;
  }).slice(0, 2);
}

export function SettingsSuggestions({
  onFind,
}: {
  onFind: (query: string) => void;
}) {
  const { t } = useI18n();
  const preferences = usePreferencesStore.use.preferences();
  const assistantStatus = useAssistantStore.use.status();
  const update = usePreferencesStore.use.updatePreferenceWithResult();
  const setActiveTab = useUiStore.use.setActiveTab();
  const [busy, setBusy] = useState(false);
  const [dismissTarget, setDismissTarget] = useState<
    (typeof SETTINGS_SUGGESTION_IDS)[number] | null
  >(null);
  if (!preferences) return null;
  const suggestions = getSettingSuggestions(
    preferences,
    assistantStatus?.settingsConfigured === true
  );
  if (!suggestions.length) return null;
  return (
    <section
      className="rounded-2xl border border-slate-700 bg-slate-900 p-3"
      aria-label={t('workspace.youMightLike')}
    >
      <h2 className="mb-2 text-sm font-semibold">
        {t('workspace.youMightLike')}
      </h2>
      <div className="space-y-3">
        {suggestions.map(id => {
          const Icon =
            id === 'assistantExtension'
              ? FaRobot
              : id === 'vacationExtension'
                ? FaUmbrellaBeach
                : id.startsWith('task') || id === 'listsExtension'
                  ? FaListUl
                  : id.startsWith('intention')
                    ? FaBullseye
                    : id === 'sessionStackTimers'
                      ? FaLayerGroup
                      : FaRegClock;
          return (
            <div key={id} className="flex items-center justify-between gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-indigo-400/10 text-indigo-400">
                <Icon size={14} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  className="text-left text-sm font-medium"
                  onClick={() => onFind(t(labels[id]))}
                >
                  {t(labels[id])}
                </button>
                <p className="text-xs text-slate-400">
                  {t(`suggestion.${id}`)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Button
                  size="xs"
                  variant="secondary"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      id === 'assistantExtension' ||
                      id === 'vacationExtension'
                    ) {
                      onFind(t(labels[id]));
                      return;
                    }
                    setBusy(true);
                    try {
                      const saved = await update(id, true);
                      if (saved && id === 'intentionExtension')
                        setActiveTab('intentions');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {id === 'assistantExtension' || id === 'vacationExtension'
                    ? t('common.setUp')
                    : t('common.turnOn')}
                </Button>
                <button
                  type="button"
                  className="text-[11px] text-slate-400"
                  disabled={busy}
                  onClick={() => setDismissTarget(id)}
                >
                  {t('workspace.notInterested')}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <Modal
        closeOnBackdropClick={!busy}
        closeOnEscape={!busy}
        isOpen={dismissTarget !== null}
        onClose={() => {
          if (!busy) setDismissTarget(null);
        }}
        title={t('workspace.hideSuggestion')}
      >
        <p className="text-sm text-slate-300">
          {t('workspace.hideSuggestionHelp', {
            setting: dismissTarget ? t(labels[dismissTarget]) : '',
          })}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setDismissTarget(null)}
          >
            {t('common.cancel')}
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              if (!dismissTarget) return;
              setBusy(true);
              try {
                const current =
                  usePreferencesStore.getState().preferences
                    ?.dismissedSettingSuggestions ?? [];
                const saved = await update('dismissedSettingSuggestions', [
                  ...new Set([...current, dismissTarget]),
                ]);
                if (saved) setDismissTarget(null);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('workspace.notInterested')}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
