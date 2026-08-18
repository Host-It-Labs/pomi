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
  FaCog,
  FaClock,
  FaKeyboard,
  FaCommentDots,
  FaFileAlt,
  FaLayerGroup,
  FaRobot,
  FaTasks,
} from 'react-icons/fa';
import { BackButton } from '../components/BackButton';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { NumberField } from '../components/ui/NumberField';
import { PageContainer } from '../components/ui/PageContainer';
import { PageShell } from '../components/ui/PageShell';
import { TaskImportModal } from '../components/tasks/TaskImportModal';
import { ToggleField } from '../components/ui/ToggleField';
import {
  SettingsControlGroup,
  SettingsSectionFrame,
  SettingsStickyNav,
} from '../components/settings/SettingsExperience';
import { useAssistantStore } from '../stores/assistantStore';
import { useAuthStore } from '../stores/authStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useTimerStore } from '../stores/timerStore';
import { useUiStore } from '../stores/uiStore';
import { apiClient } from '../utils/apiClient';
import { submitUserMutation } from '../utils/userActionQueue';
import { isDesktop, isIos } from '../utils/osUtils';
import { AssistantSettings } from './AssistantSettings';
import { GeneralSettings } from './GeneralSettings';
import { IntentionSettings } from './IntentionSettings';
import { KeyboardShortcutsSettings } from './KeyboardShortcutsSettings';
import { NotificationsSettings } from './NotificationsSettings';
import { SessionSettings } from './SessionSettings';
import { TaskSettings } from './TaskSettings';
import { TimerSettings } from './TimerSettings';
import { FeedbackModal } from '../components/feedback/FeedbackModal';
import { DescriptionWizardModal } from '../components/descriptions/DescriptionWizardModal';
import { SessionConfigModal } from './extensions/SessionConfigModal';
import { useI18n } from '../i18n';

type FeaturePreferenceKey =
  | 'sessionsExtension'
  | 'intentionExtension'
  | 'tasksExtension'
  | 'assistantExtension';

export function Settings() {
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
  const navRef = useRef<HTMLDivElement | null>(null);
  const [activeSection, setActiveSection] = useState('');

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
        <div className="text-white">{t('common.loading')}</div>
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
    setActiveTab('tasks');
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
      longBreakAutoStart: boolean;
    }) => {
      await applyPreferenceUpdates({
        sessionsExtension: true,
        sessionPomodorosCount: config.pomodorosCount,
        sessionHasLongBreak: config.hasLongBreak,
        sessionLongBreakDuration: config.longBreakDuration,
        sessionLongBreakAutoStart: config.longBreakAutoStart,
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

    setActiveSection(key);
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
    const base: Array<{
      key: string;
      label: string;
      title: string;
      icon: ReactNode;
      content: ReactNode;
      visible: boolean;
      featureKey?: FeaturePreferenceKey;
      accentClassName?: string;
    }> = [
      {
        key: 'general',
        label: t('settings.general'),
        title: t('settings.general'),
        icon: <FaCog size={18} />,
        content: (
          <GeneralSettings
            preferences={preferences}
            updatePreference={updatePreference}
            updateLanguagePreference={updateLanguagePreference}
            reloadPreferences={loadPreferences}
            adminContent={
              user?.isAdmin === true ? (
                <AssistantSettings onSaved={loadAssistantStatus} />
              ) : undefined
            }
          />
        ),
        visible: true,
      },
      {
        key: 'timer',
        label: t('settings.timer'),
        title: t('settings.timer'),
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
        icon: <FaBell size={18} />,
        content: (
          <NotificationsSettings
            preferences={preferences}
            updatePreference={updatePreference}
          />
        ),
        visible: true,
        accentClassName: 'text-amber-300',
      },
      {
        key: 'shortcuts',
        label: t('settings.keyboardShortcuts'),
        title: t('settings.keyboardShortcuts'),
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
        icon: <FaLayerGroup size={18} />,
        content: (
          <SessionSettings
            preferences={preferences}
            updatePreference={updatePreference}
          />
        ),
        visible: true,
        featureKey: 'sessionsExtension',
        accentClassName: 'text-fuchsia-300',
      },
      {
        key: 'intentions',
        label: t('settings.intentions'),
        title: t('settings.intentions'),
        icon: <FaBullseye size={18} />,
        content: (
          <IntentionSettings
            preferences={preferences}
            updatePreference={updatePreference}
          />
        ),
        visible: true,
        featureKey: 'intentionExtension',
        accentClassName: 'text-cyan-300',
      },
      {
        key: 'tasks',
        label: t('settings.tasks'),
        title: t('settings.tasks'),
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
        accentClassName: 'text-rose-300',
      },
      {
        key: 'assistant',
        label: t('settings.assistant'),
        title: t('settings.assistant'),
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
        accentClassName: 'text-violet-300',
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

  useEffect(() => {
    if (!sections.length) {
      return;
    }

    if (!sections.some(section => section.key === activeSection)) {
      setActiveSection(sections[0].key);
    }
  }, [sections, activeSection]);

  useEffect(() => {
    if (!sections.length) {
      return;
    }

    const handleScroll = () => {
      const scrollPosition = window.scrollY + 100;
      let currentKey = sections[0].key;

      sections.forEach(section => {
        const node = sectionRefs.current[section.key];
        if (!node) {
          return;
        }

        if (node.offsetTop <= scrollPosition) {
          currentKey = section.key;
        }
      });

      if (currentKey !== activeSection) {
        setActiveSection(currentKey);
      }
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [sections, activeSection]);

  useEffect(() => {
    if (!activeSection || !navRef.current) {
      return;
    }

    const activeButton = navRef.current.querySelector(
      `[data-section-key="${activeSection}"]`
    ) as HTMLButtonElement;

    if (!activeButton) {
      return;
    }

    const nav = navRef.current;
    const buttonLeft = activeButton.offsetLeft;
    const buttonWidth = activeButton.offsetWidth;
    const navWidth = nav.offsetWidth;

    const targetScroll = buttonLeft - navWidth / 2 + buttonWidth / 2;

    nav.scrollTo({
      left: targetScroll,
      behavior: 'smooth',
    });
  }, [activeSection]);

  return (
    <PageShell>
      <PageContainer size="lg" className="pb-28">
        <div className="space-y-8">
          {isDesktop && (
            <div
              data-tauri-drag-region
              className="fixed top-0 left-0 right-0 h-6 z-50 bg-slate-950/95 backdrop-blur supports-backdrop-filter:bg-slate-950/80"
            />
          )}
          {isIos && (
            <div className="fixed top-0 left-0 right-0 z-20 h-[env(safe-area-inset-top)] bg-slate-950/95 backdrop-blur supports-backdrop-filter:bg-slate-950/80" />
          )}
          <div className="flex items-center justify-between gap-3 pb-3 pt-3">
            <div className="flex min-w-0 items-center gap-3">
              <BackButton targetTab="timer" />
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold tracking-tight text-white">
                  {t('settings.title')}
                </h1>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="gap-2"
              onClick={() => setShowFeedback(true)}
            >
              <FaCommentDots size={12} /> {t('feedback.title')}
            </Button>
          </div>
          <SettingsStickyNav isDesktop={isDesktop} isIos={isIos}>
            <nav
              ref={navRef}
              className="app-scrollbar flex gap-1.5 overflow-x-auto py-2"
            >
              {sections.map(section => (
                <button
                  key={section.key}
                  type="button"
                  data-section-key={section.key}
                  onClick={() => handleTabClick(section.key)}
                  className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-all motion-reduce:transition-none ${
                    activeSection === section.key
                      ? 'bg-indigo-500/90 text-white shadow-md shadow-indigo-950/40'
                      : 'bg-slate-900/70 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  <span className="text-[11px] opacity-80">{section.icon}</span>
                  {section.label}
                </button>
              ))}
            </nav>
          </SettingsStickyNav>

          {error && (
            <Alert variant="error" className="animate-pulse">
              {error}
            </Alert>
          )}

          <div className="space-y-8">
            {sections.map(section => (
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
                          onToggle: () =>
                            void handleFeatureToggle(section.featureKey!),
                        }
                      : undefined
                  }
                >
                  <div className="text-slate-200">{section.content}</div>
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
            longBreakAutoStart: preferences.sessionLongBreakAutoStart ?? false,
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
        <Alert variant="warning">{t('assistant.voiceSetupUnavailable')}</Alert>
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
