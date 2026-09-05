import { Preferences } from '@pomi/shared';
import { TIMER_TYPES } from '@pomi/shared/src/constants';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  FaBell,
  FaBullseye,
  FaClock,
  FaCog,
  FaCommentDots,
  FaFileAlt,
  FaKeyboard,
  FaLayerGroup,
  FaRobot,
  FaTasks,
} from 'react-icons/fa';
import { CenteredPageHeader } from '../components/CenteredPageHeader';
import { DescriptionWizardModal } from '../components/descriptions/DescriptionWizardModal';
import { FeedbackModal } from '../components/feedback/FeedbackModal';
import {
  SettingsControlGroup,
  SettingsSearchFilter,
  SettingsSectionFrame,
  SettingsStickySearch,
} from '../components/settings/SettingsExperience';
import { SettingsSuggestions } from '../components/settings/SettingsSuggestions';
import { TaskImportModal } from '../components/tasks/TaskImportModal';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { NumberField } from '../components/ui/NumberField';
import { PageContainer } from '../components/ui/PageContainer';
import { PageShell } from '../components/ui/PageShell';
import { ToggleField } from '../components/ui/ToggleField';
import { useI18n } from '../i18n';
import { useAssistantStore } from '../stores/assistantStore';
import { useAuthStore } from '../stores/authStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useTimerStore } from '../stores/timerStore';
import { useUiStore } from '../stores/uiStore';
import { apiClient } from '../utils/apiClient';
import { isDesktop, isIos } from '../utils/osUtils';
import { submitUserMutation } from '../utils/userActionQueue';
import { SessionConfigModal } from './extensions/SessionConfigModal';
import { GeneralSettings } from './GeneralSettings';
import { IntentionSettings } from './IntentionSettings';
import { KeyboardShortcutsSettings } from './KeyboardShortcutsSettings';
import { NotificationsSettings } from './NotificationsSettings';
import { SessionSettings } from './SessionSettings';
import { TaskSettings } from './TaskSettings';
import { TimerSettings } from './TimerSettings';

type FeaturePreferenceKey =
  | 'sessionsExtension'
  | 'intentionExtension'
  | 'tasksExtension'
  | 'assistantExtension';

type SettingsSearchEntry = {
  targetId?: string;
  terms: string[];
};

type SettingsSection = {
  key: string;
  label: string;
  title: string;
  icon: ReactNode;
  content: ReactNode;
  searchEntries: SettingsSearchEntry[];
  featureKey?: FeaturePreferenceKey;
  accentClassName?: string;
};

function normalizeSettingsSearchText(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSettingsSearchToken(token: string) {
  return token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token;
}

export function settingsSearchMatches(terms: string[], query: string) {
  const queryTokens = normalizeSettingsSearchText(query)
    .split(' ')
    .filter(Boolean)
    .map(normalizeSettingsSearchToken);
  if (queryTokens.length === 0) return true;

  const termTokens = normalizeSettingsSearchText(terms.join(' '))
    .split(' ')
    .filter(Boolean)
    .map(normalizeSettingsSearchToken);
  return queryTokens.every(queryToken =>
    termTokens.some(
      termToken =>
        termToken.includes(queryToken) ||
        (termToken.length >= 4 && queryToken.includes(termToken))
    )
  );
}

const settingsSearchEntry = (
  terms: string[] | string,
  targetId?: string
): SettingsSearchEntry => ({
  targetId,
  terms: typeof terms === 'string' ? [terms] : terms,
});

export function Settings() {
  const preferences = usePreferencesStore.use.preferences();
  const loadPreferences = usePreferencesStore.use.loadPreferences();
  const { t } = useI18n();
  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);
  return preferences ? (
    <SettingsContent />
  ) : (
    <div role="status" className="p-6 text-slate-300">
      {t('common.loading')}
    </div>
  );
}

function SettingsContent() {
  const { t } = useI18n();
  const preferences = usePreferencesStore.use.preferences();
  const loadPreferences = usePreferencesStore.use.loadPreferences();
  const setPreferences = usePreferencesStore.use.setPreferences();
  const assistantStatus = useAssistantStore.use.status();
  const loadAssistantStatus = useAssistantStore.use.loadStatus();
  const user = useAuthStore.use.user();
  const createOrResumeTimer = useTimerStore.use.createOrResumeTimer();
  const setExpanded = useUiStore.use.setExpanded();
  const setActiveTab = useUiStore.use.setActiveTab();
  const requestTaskCreate = useUiStore.use.requestTaskCreate();
  const [error, setError] = useState('');
  const [showSessionConfig, setShowSessionConfig] = useState(false);
  const [showTaskStartChoice, setShowTaskStartChoice] = useState(false);
  const [showTaskImport, setShowTaskImport] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  useEffect(() => {
    void loadAssistantStatus();
  }, [loadAssistantStatus]);

  const applyPreferenceUpdates = useCallback(
    async (updates: Partial<Preferences>): Promise<boolean> => {
      try {
        setError('');
        const result = await submitUserMutation({
          kind: 'preferences',
          label: t('settings.update'),
          payload: { operation: 'update', updates },
          reconcile: async () => {
            await loadPreferences({ syncTimeZone: false });
          },
        });
        const response =
          result &&
          typeof result === 'object' &&
          'status' in result &&
          'body' in result
            ? (result as { status: number; body: Preferences })
            : { status: 200, body: result as Preferences };

        if (response.status !== 200) {
          const errorBody = response.body as { message?: string } | null;
          throw new Error(errorBody?.message || t('settings.failedToSave'));
        }

        setPreferences(response.body as Preferences);
        return true;
      } catch (err) {
        console.error('Failed to update preference:', err);
        setError(t('settings.failedToSave'));
        return false;
      }
    },
    [setPreferences, t]
  );

  const updatePreference = useCallback(
    async (key: keyof Preferences, value: any) => {
      await applyPreferenceUpdates({ [key]: value });
    },
    [applyPreferenceUpdates]
  );

  const applyPreferenceUpdatesWithoutResult = useCallback(
    async (updates: Partial<Preferences>) => {
      await applyPreferenceUpdates(updates);
    },
    [applyPreferenceUpdates]
  );

  const updateLanguagePreference = useCallback(
    async (language: Preferences['language']) =>
      applyPreferenceUpdates({ language }),
    [applyPreferenceUpdates]
  );

  if (!preferences) {
    return (
      <PageShell className="flex items-center justify-center">
        <div className="text-ink">{t('common.loading')}</div>
      </PageShell>
    );
  }

  const workMinutes = Math.floor(preferences.workTimerDuration / (60 * 1000));
  const breakMinutes = Math.floor(preferences.breakTimerDuration / (60 * 1000));

  const handleFeatureToggle = useCallback(
    async (id: FeaturePreferenceKey) => {
      const isActivated = Boolean(preferences[id]);

      if (id === 'sessionsExtension' && !isActivated) {
        setShowSessionConfig(true);
        return;
      }

      await applyPreferenceUpdates({ [id]: !isActivated });

      if (id === 'assistantExtension') {
        await loadAssistantStatus();
      }

      if (id === 'intentionExtension' && !isActivated) {
        setExpanded(true);
        setActiveTab('timer');
      }
      if (id === 'tasksExtension' && !isActivated) {
        const tasksResponse = await apiClient.tasks.list({
          query: { status: 'active' },
        });
        if (tasksResponse.status === 200 && tasksResponse.body.length === 0) {
          setShowTaskStartChoice(true);
        }
      }
    },
    [
      applyPreferenceUpdates,
      loadAssistantStatus,
      preferences,
      setActiveTab,
      setExpanded,
    ]
  );

  const handleCreateFirstTask = useCallback(() => {
    setShowTaskStartChoice(false);
    setExpanded(true);
    setActiveTab('timer');
    requestTaskCreate();
  }, [requestTaskCreate, setActiveTab, setExpanded]);

  const handleImportFirstTasks = useCallback(() => {
    setShowTaskStartChoice(false);
    setShowTaskImport(true);
  }, []);

  const handleSessionConfigSave = useCallback(
    async (config: {
      pomodorosCount: number;
      hasLongBreak: boolean;
      longBreakDuration: number;
      autoStartBreak: boolean;
    }) => {
      await applyPreferenceUpdates({
        sessionsExtension: true,
        sessionPomodorosCount: config.pomodorosCount,
        sessionHasLongBreak: config.hasLongBreak,
        sessionLongBreakDuration: config.longBreakDuration,
        autoStartBreak: config.autoStartBreak,
        autoStartLongBreak: config.autoStartBreak,
      });

      setShowSessionConfig(false);
      setExpanded(true);
      setActiveTab('timer');
      createOrResumeTimer(TIMER_TYPES.WORK);
    },
    [applyPreferenceUpdates, createOrResumeTimer, setActiveTab, setExpanded]
  );

  const handleTabClick = useCallback((key: string) => {
    const node = sectionRefs.current[key];
    if (!node) {
      return;
    }

    const offset = 100;
    const target = node.getBoundingClientRect().top + window.scrollY - offset;

    window.scrollTo({ top: target, behavior: 'smooth' });
  }, []);

  const handleShowTaskNotificationSettings = useCallback(() => {
    handleTabClick('notifications');
    window.setTimeout(() => {
      document
        .querySelector('[data-setting-id="taskNotifications"]')
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 120);
  }, [handleTabClick]);

  const sections = useMemo(() => {
    const base: Array<SettingsSection & { visible: boolean }> = [
      {
        key: 'general',
        label: t('settings.general'),
        title: t('settings.general'),
        searchEntries: [
          settingsSearchEntry(
            [t('settings.essentials'), t('settings.account')],
            'general-account'
          ),
          settingsSearchEntry(t('common.logOut'), 'logout'),
          ...(user?.isAdmin === true
            ? [
                settingsSearchEntry(
                  t('workspace.aiAdministration'),
                  'aiAdministration'
                ),
              ]
            : []),
          settingsSearchEntry(
            [t('common.language'), t('common.languageDescription')],
            'settings-language'
          ),
          settingsSearchEntry(t('settings.openDebugPanel'), 'openDebugPanel'),
          settingsSearchEntry(
            [t('settings.undoAlerts'), t('settings.undoAlertsDescription')],
            'undoAlerts'
          ),
          settingsSearchEntry(
            [
              t('settings.keepScreenAwake'),
              t('settings.keepScreenAwakeDescription'),
            ],
            'keep-screen-awake'
          ),
          settingsSearchEntry(
            [
              t('settings.hiddenTips'),
              t('settings.hiddenTipsAbout'),
              t('common.restore'),
            ],
            'hiddenTips'
          ),
        ],
        icon: <FaCog size={18} />,
        content: (
          <GeneralSettings
            preferences={preferences}
            updatePreference={updatePreference}
            updateLanguagePreference={updateLanguagePreference}
            reloadPreferences={loadPreferences}
          />
        ),
        visible: true,
      },
      {
        key: 'timer',
        label: t('settings.timer'),
        title: t('settings.timer'),
        searchEntries: [
          settingsSearchEntry(
            [
              t('settings.essentials'),
              t('timerSettings.focusLength'),
              t('common.work'),
            ],
            'focusLength'
          ),
          settingsSearchEntry(
            [t('timerSettings.breakLength'), t('common.break')],
            'breakLength'
          ),
          settingsSearchEntry(
            [
              t('timerSettings.autoStartBreaks'),
              t('timerSettings.autoStartBreaksDescription'),
              t('common.work'),
              t('common.break'),
              t('common.longBreak'),
            ],
            'autoStartBreak'
          ),
          settingsSearchEntry(
            [
              t('timerSettings.resetBreakOnFirstIntention'),
              t('timerSettings.resetBreakOnFirstIntentionDescription'),
              t('timerSettings.resetLongBreakOnFirstIntention'),
              t('timerSettings.resetLongBreakOnFirstIntentionDescription'),
              t('common.work'),
              t('common.break'),
              t('common.longBreak'),
            ],
            'resetBreakOnFirstIntention'
          ),
          settingsSearchEntry(
            [
              t('timerSettings.saveTimeWhenSkipping'),
              t('timerSettings.saveTimeWhenSkippingDescription'),
            ],
            'advancedSkip'
          ),
          settingsSearchEntry(
            [
              t('timerSettings.keepGoing'),
              t('timerSettings.keepGoingDescription'),
            ],
            'timerExtension'
          ),
        ],
        icon: <FaClock size={18} />,
        content: (
          <TimerSettings
            preferences={preferences}
            updatePreference={updatePreference}
            updatePreferences={applyPreferenceUpdatesWithoutResult}
            workMinutes={workMinutes}
            breakMinutes={breakMinutes}
          />
        ),
        visible: true,
        accentClassName: 'text-indigo-300',
      },
      {
        key: 'notifications',
        label: t('settings.notifications'),
        title: t('settings.notifications'),
        searchEntries: [
          settingsSearchEntry(
            [
              t('notifications.permissionRequired'),
              t('notifications.macPermissionRequired'),
              t('notifications.macSettingsInstructions'),
              t('notifications.openMacSettings'),
            ],
            'notificationPermission'
          ),
          settingsSearchEntry(
            [
              t('notifications.backgroundUsage'),
              t('notifications.backgroundUsageDescription'),
            ],
            'notificationBackgroundUsage'
          ),
          settingsSearchEntry(
            [t('intention.essentials'), t('notifications.notifications')],
            'notifications'
          ),
          settingsSearchEntry(
            [
              t('notifications.method'),
              t('notifications.sound'),
              t('notifications.notification'),
            ],
            'notificationMethod'
          ),
          settingsSearchEntry(
            [
              t('notifications.timerFinished'),
              t('common.work'),
              t('common.break'),
            ],
            'timerFinishedNotifications'
          ),
          settingsSearchEntry(
            [
              t('notifications.personalize'),
              t('notifications.notifyBeforeTimerEnds'),
            ],
            'notifyBeforeTimerEnds'
          ),
          settingsSearchEntry(
            [
              t('notifications.taskReminders'),
              t('notifications.repeatUrgent'),
              t('notifications.repeatUrgentDescription'),
              t('notifications.selectUrgentDescription'),
              t('notifications.repeatEvery'),
              t('notifications.repeatEveryDescription'),
            ],
            'taskNotifications'
          ),
        ],
        icon: <FaBell size={18} />,
        content: (
          <NotificationsSettings
            preferences={preferences}
            updatePreference={updatePreference}
          />
        ),
        visible: true,
        accentClassName: 'text-indigo-300',
      },
      {
        key: 'shortcuts',
        label: t('settings.keyboardShortcuts'),
        title: t('settings.keyboardShortcuts'),
        searchEntries: [
          settingsSearchEntry(
            [
              t('settings.essentials'),
              t('shortcuts.openPomi'),
              t('shortcuts.showApp'),
              t('session.shortcut'),
            ],
            'globalShortcut'
          ),
          settingsSearchEntry(
            [t('shortcuts.inApp'), t('shortcuts.reveal'), t('shortcuts.hold')],
            'keyboardShortcuts'
          ),
        ],
        icon: <FaKeyboard size={18} />,
        content: (
          <KeyboardShortcutsSettings
            preferences={preferences}
            updatePreference={updatePreference}
          />
        ),
        visible: isDesktop,
      },
      {
        key: 'sessions',
        label: t('settings.sessions'),
        title: t('settings.sessions'),
        searchEntries: [
          settingsSearchEntry(
            [
              t('settings.essentials'),
              t('session.focusBlocks'),
              t('session.workTimersPerSession'),
            ],
            'sessionPomodorosCount'
          ),
          settingsSearchEntry(
            [
              t('common.longBreak'),
              t('session.longBreakDescription'),
              t('session.enableLongBreak'),
            ],
            'sessionHasLongBreak'
          ),
          settingsSearchEntry(
            [t('session.longBreakDuration')],
            'sessionLongBreakDuration'
          ),
          settingsSearchEntry(
            [
              t('session.showLongBreakButton'),
              t('session.showLongBreakButtonDescription'),
            ],
            'sessionShowLongBreakButton'
          ),
          settingsSearchEntry(
            [
              t('session.showFinishTimes'),
              t('session.showFinishTimesDescription'),
            ],
            'sessionShowEta'
          ),
          settingsSearchEntry(
            [
              t('session.combineTimers'),
              t('session.combineTimersDescription'),
              t('session.shortcut'),
            ],
            'sessionStackTimers'
          ),
          settingsSearchEntry(
            [
              t('session.detectLongBreaks'),
              t('session.detectLongBreaksDescription'),
            ],
            'sessionAutoDetectLongBreak'
          ),
        ],
        icon: <FaLayerGroup size={18} />,
        content: (
          <SessionSettings
            preferences={preferences}
            updatePreference={updatePreference}
          />
        ),
        visible: true,
        featureKey: 'sessionsExtension',
        accentClassName: 'text-indigo-300',
      },
      {
        key: 'intentions',
        label: t('settings.intentions'),
        title: t('settings.intentions'),
        searchEntries: [
          settingsSearchEntry(
            [
              t('intention.essentials'),
              t('intention.breakIntentions'),
              t('intention.breakIntentionsDescription'),
            ],
            'intentionBreakIntentions'
          ),
          settingsSearchEntry(
            [
              t('intention.requireSelection'),
              t('intention.requireSelectionDescription'),
            ],
            'intentionRequireSelection'
          ),
          settingsSearchEntry(
            [
              t('intention.showDailyCount'),
              t('intention.showDailyCountDescription'),
            ],
            'intentionShowDailyCount'
          ),
          settingsSearchEntry(
            [t('intention.multiSelect'), t('intention.multiSelectDescription')],
            'intentionMultiSelect'
          ),
          settingsSearchEntry(
            [
              t('intention.shareBreakIntentions'),
              t('intention.shareBreakIntentionsDescription'),
            ],
            'intentionShowBreakIntentionsInLongBreak'
          ),
          settingsSearchEntry(
            [
              t('intention.customDurations'),
              t('intention.customDurationsDescription'),
            ],
            'intentionCustomDurations'
          ),
          settingsSearchEntry(
            [
              t('intention.subIntentions'),
              t('intention.subIntentionsDescription'),
            ],
            'intentionSubIntentions'
          ),
          settingsSearchEntry(
            [t('intention.habits'), t('intention.habitsDescription')],
            'intentionHabits'
          ),
          settingsSearchEntry(
            [
              t('intention.prioritizeUnfinishedHabits'),
              t('intention.prioritizeUnfinishedHabitsDescription'),
            ],
            'intentionPrioritizeUnfinishedHabits'
          ),
        ],
        icon: <FaBullseye size={18} />,
        content: (
          <IntentionSettings
            preferences={preferences}
            updatePreference={updatePreference}
          />
        ),
        visible: true,
        featureKey: 'intentionExtension',
        accentClassName: 'text-indigo-300',
      },
      {
        key: 'tasks',
        label: t('settings.tasks'),
        title: t('settings.tasks'),
        searchEntries: [
          settingsSearchEntry(
            [
              t('settings.essentials'),
              t('task.notifications'),
              t('task.reminders'),
            ],
            'taskNotifications'
          ),
          settingsSearchEntry(
            [
              t('task.defaultDueDate'),
              t('task.defaultDueDateAbout'),
              t('common.off'),
              t('common.tomorrow'),
              t('common.inOneWeek'),
              t('common.customDayOffset'),
            ],
            'taskDefaultDueDate'
          ),
          settingsSearchEntry(
            [t('task.daysFromCreation'), t('task.positiveDayOffset')],
            'taskDefaultDueDateDays'
          ),
          settingsSearchEntry(
            [
              t('task.defaultSort'),
              t('task.defaultSortAbout'),
              t('task.sortDefault'),
              t('task.sortNewest'),
              t('task.sortOldest'),
              t('task.sortDefaultDescription'),
            ],
            'taskDefaultSort'
          ),
          settingsSearchEntry([t('task.favoriteFilters')], 'taskDefaultSort'),
          settingsSearchEntry(
            [t('task.minimized'), t('task.minimizedDescription')],
            'tasksShowInMinimizedTimer'
          ),
          settingsSearchEntry(
            [t('task.followPinned'), t('task.followPinnedDescription')],
            'tasksAutoSwitchToIntentionMode'
          ),
          settingsSearchEntry(
            [t('task.lists'), t('task.listsDescription')],
            'listsExtension'
          ),
          settingsSearchEntry(
            [
              t('task.vacationMode'),
              t('task.vacationModeDescription'),
              t('task.setVacationCoverage'),
            ],
            'vacationExtension'
          ),
          settingsSearchEntry(
            [
              t('common.personalize'),
              t('task.shortenLongBreaks'),
              t('task.shortenLongBreaksDescription'),
            ],
            'longBreakToBreakEnabled'
          ),
          settingsSearchEntry(
            [t('settings.manage'), t('task.import')],
            'taskImport'
          ),
        ],
        icon: <FaTasks size={18} />,
        content: (
          <TaskSettings
            preferences={preferences}
            updatePreference={updatePreference}
            onShowNotificationSettings={handleShowTaskNotificationSettings}
          />
        ),
        visible: true,
        featureKey: 'tasksExtension',
        accentClassName: 'text-indigo-300',
      },
      {
        key: 'assistant',
        label: t('settings.assistant'),
        title: t('settings.assistant'),
        searchEntries: [
          settingsSearchEntry(
            [
              t('intention.essentials'),
              t('assistant.voiceSetupUnavailable'),
              t('assistant.destinationDescriptions'),
              t('assistant.destinationDescriptionsDescription'),
            ],
            'assistantAvailability'
          ),
          settingsSearchEntry(
            [t('assistant.manageDescriptions')],
            'assistantManageDescriptions'
          ),
          settingsSearchEntry(
            [
              t('notifications.personalize'),
              t('assistant.taskTranscripts'),
              t('assistant.taskTranscriptsDescription'),
            ],
            'assistantTaskTranscriptsEnabled'
          ),
          settingsSearchEntry(
            [
              t('assistant.minimumTranscriptWords'),
              t('assistant.minimumTranscriptWordsDescription'),
            ],
            'assistantTaskTranscriptMinWords'
          ),
        ],
        icon: <FaRobot size={18} />,
        content: (
          <AssistantPreferenceSettings
            preferences={preferences}
            configured={assistantStatus?.settingsConfigured === true}
            updatePreference={updatePreference}
          />
        ),
        visible: Boolean(
          assistantStatus?.settingsConfigured || preferences.assistantExtension
        ),
        featureKey: 'assistantExtension',
        accentClassName: 'text-indigo-300',
      },
    ];

    return base
      .filter(section => section.visible)
      .map(section => ({
        key: section.key,
        label: section.label,
        title: section.title,
        icon: section.icon,
        content: section.content,
        searchEntries: section.searchEntries,
        featureKey: section.featureKey,
        accentClassName: section.accentClassName,
      }));
  }, [
    applyPreferenceUpdates,
    applyPreferenceUpdatesWithoutResult,
    breakMinutes,
    handleShowTaskNotificationSettings,
    loadAssistantStatus,
    assistantStatus?.settingsConfigured,
    preferences,
    t,
    updatePreference,
    user?.isAdmin,
    workMinutes,
  ]);

  const normalizedSearchQuery = normalizeSettingsSearchText(searchQuery);
  const filteredSections = useMemo(() => {
    if (!normalizedSearchQuery) {
      return sections.map(section => ({ ...section, matchingTargetIds: [] }));
    }

    return sections.flatMap(section => {
      const sectionNameMatches = settingsSearchMatches(
        [section.label, section.title],
        normalizedSearchQuery
      );
      const matchingEntries = section.searchEntries.filter(entry =>
        settingsSearchMatches(entry.terms, normalizedSearchQuery)
      );
      if (!sectionNameMatches && matchingEntries.length === 0) return [];

      const matchingTargetIds = sectionNameMatches
        ? section.searchEntries.flatMap(entry =>
            entry.targetId ? [entry.targetId] : []
          )
        : matchingEntries.flatMap(entry =>
            entry.targetId ? [entry.targetId] : []
          );
      if (
        section.featureKey &&
        !preferences[section.featureKey] &&
        matchingEntries.length > 0
      ) {
        matchingTargetIds.push(`feature-toggle-${section.key}`);
      }
      return [{ ...section, matchingTargetIds }];
    });
  }, [normalizedSearchQuery, preferences, sections]);

  return (
    <PageShell>
      <PageContainer size="lg" className={isDesktop ? 'pb-28 pt-6' : 'pb-28'}>
        <div className="space-y-3">
          {isDesktop && (
            <div
              data-tauri-drag-region
              className="fixed top-0 left-0 right-0 h-6 z-50 bg-slate-950/95 backdrop-blur supports-backdrop-filter:bg-slate-950/80"
            />
          )}
          {isIos && (
            <div className="fixed top-0 left-0 right-0 z-20 h-[env(safe-area-inset-top)] bg-slate-950/95 backdrop-blur supports-backdrop-filter:bg-slate-950/80" />
          )}
          <CenteredPageHeader
            title={t('settings.title')}
            action={
              <IconButton
                label={t('feedback.title')}
                title={t('feedback.title')}
                variant="secondary"
                size="sm"
                className="h-8 w-8 !p-0"
                onClick={() => setShowFeedback(true)}
              >
                <FaCommentDots size={12} />
              </IconButton>
            }
          />
          <SettingsStickySearch isDesktop={isDesktop} isIos={isIos}>
            <label htmlFor="settings-search" className="sr-only">
              {t('common.search')}
            </label>
            <Input
              ref={searchInputRef}
              id="settings-search"
              type="search"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder={t('common.search')}
              aria-label={t('common.search')}
              className="my-2 h-10 text-sm"
            />
          </SettingsStickySearch>

          {error && (
            <Alert variant="error" className="animate-pulse">
              {error}
            </Alert>
          )}

          {normalizedSearchQuery && filteredSections.length === 0 && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-2xl border border-slate-800/80 bg-slate-900/45 px-4 py-8 text-center text-sm text-slate-400"
            >
              {t('settings.noMatchingSections')}
            </div>
          )}

          {!normalizedSearchQuery && (
            <SettingsSuggestions onFind={setSearchQuery} />
          )}

          <div className="space-y-8">
            {filteredSections.map(section => (
              <section
                key={section.key}
                ref={(node: HTMLDivElement | null) => {
                  sectionRefs.current[section.key] = node;
                }}
                data-section={section.key}
                className="scroll-mt-40"
              >
                <SettingsSectionFrame
                  title={section.title}
                  icon={section.icon}
                  accentClassName={section.accentClassName}
                  feature={
                    section.featureKey
                      ? {
                          enabled: Boolean(preferences[section.featureKey]),
                          targetId: `feature-toggle-${section.key}`,
                          onToggle: () =>
                            void handleFeatureToggle(section.featureKey!),
                        }
                      : undefined
                  }
                >
                  <SettingsSearchFilter
                    active={Boolean(normalizedSearchQuery)}
                    targetIds={section.matchingTargetIds}
                  >
                    <div className="text-slate-200">{section.content}</div>
                  </SettingsSearchFilter>
                </SettingsSectionFrame>
              </section>
            ))}
          </div>
        </div>

        <SessionConfigModal
          isOpen={showSessionConfig}
          onClose={() => setShowSessionConfig(false)}
          onSave={handleSessionConfigSave}
          initialValues={{
            pomodorosCount: preferences.sessionPomodorosCount || 3,
            hasLongBreak: preferences.sessionHasLongBreak ?? true,
            longBreakDuration: preferences.sessionLongBreakDuration || 900000,
            autoStartBreak: preferences.autoStartBreak ?? false,
          }}
        />
        <Modal
          isOpen={showTaskStartChoice}
          onClose={() => setShowTaskStartChoice(false)}
          title={t('timer.startTasks')}
          closeOnBackdropClick
          closeOnEscape
        >
          <div className="space-y-3">
            <Button onClick={handleCreateFirstTask} className="w-full">
              {t('task.createFirst')}
            </Button>
            <Button
              variant="secondary"
              onClick={handleImportFirstTasks}
              className="w-full"
            >
              {t('task.importFromApp')}
            </Button>
          </div>
        </Modal>
        <TaskImportModal
          isOpen={showTaskImport}
          onClose={() => setShowTaskImport(false)}
        />
        <FeedbackModal
          isOpen={showFeedback}
          onClose={() => setShowFeedback(false)}
        />
      </PageContainer>
    </PageShell>
  );
}

function AssistantPreferenceSettings({
  preferences,
  configured,
  updatePreference,
}: {
  preferences: Preferences;
  configured: boolean;
  updatePreference: (key: keyof Preferences, value: any) => Promise<void>;
}) {
  const { t } = useI18n();
  const [descriptionWizardOpen, setDescriptionWizardOpen] = useState(false);
  return (
    <div className="space-y-4">
      {!configured && (
        <div data-setting-id="assistantAvailability">
          <Alert variant="warning">
            {t('assistant.voiceSetupUnavailable')}
          </Alert>
        </div>
      )}
      <SettingsControlGroup title={t('intention.essentials')}>
        <ToggleField
          id="destinationDescriptionsEnabled"
          checked={preferences.destinationDescriptionsEnabled ?? false}
          onChange={async value => {
            await updatePreference('destinationDescriptionsEnabled', value);
            if (value) setDescriptionWizardOpen(true);
          }}
          label={t('assistant.destinationDescriptions')}
          description={t('assistant.destinationDescriptionsDescription')}
        />
        {preferences.destinationDescriptionsEnabled && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => setDescriptionWizardOpen(true)}
            data-setting-id="assistantManageDescriptions"
          >
            {t('assistant.manageDescriptions')}
          </Button>
        )}
      </SettingsControlGroup>

      <SettingsControlGroup title={t('notifications.personalize')}>
        <ToggleField
          id="assistantTaskTranscriptsEnabled"
          checked={preferences.assistantTaskTranscriptsEnabled ?? false}
          onChange={value =>
            updatePreference('assistantTaskTranscriptsEnabled', value)
          }
          label={t('assistant.taskTranscripts')}
          icon={<FaFileAlt size={12} />}
          description={t('assistant.taskTranscriptsDescription')}
        />

        {preferences.assistantTaskTranscriptsEnabled && (
          <NumberField
            id="assistantTaskTranscriptMinWords"
            label={t('assistant.minimumTranscriptWords')}
            min={1}
            max={10000}
            value={preferences.assistantTaskTranscriptMinWords ?? 15}
            onChange={event => {
              const value = Number(event.target.value);
              if (Number.isInteger(value) && value >= 1 && value <= 10000) {
                void updatePreference('assistantTaskTranscriptMinWords', value);
              }
            }}
            helperText={t('assistant.minimumTranscriptWordsDescription')}
          />
        )}
      </SettingsControlGroup>
      <DescriptionWizardModal
        isOpen={descriptionWizardOpen}
        onClose={() => setDescriptionWizardOpen(false)}
      />
    </div>
  );
}
