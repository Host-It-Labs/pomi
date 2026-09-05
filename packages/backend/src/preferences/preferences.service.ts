import {
  Inject,
  Injectable,
  InternalServerErrorException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AppLanguage, DEFAULT_APP_LANGUAGE } from '@pomi/shared';
import { Subject } from 'rxjs';
import { TimerService } from 'src/timer/timer.service';
import { Repository } from 'typeorm';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { Preferences } from './preferences.entity';
import { PreferencesStore } from './preferences.store';

const DEFAULT_PREFERENCES = {
  language: DEFAULT_APP_LANGUAGE,
  workTimerDuration: 25 * 60 * 1000,
  breakTimerDuration: 5 * 60 * 1000,
  autoStartBreak: false,
  autoStartWork: false,
  autoStartLongBreak: false,
  notifications: true,
  notifyOnWorkComplete: true,
  notifyOnBreakComplete: true,
  notifyBeforeWorkComplete: true,
  notifyBeforeTime: 5 * 60 * 1000,
  soundNotifications: true,
  pushNotifications: true,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  globalShortcut: false,
  keyboardShortcuts: true,
  intentionExtension: true,
  intentionRequireSelection: false,
  intentionShowDailyCount: false,
  intentionBreakIntentions: false,
  intentionMultiSelect: false,
  intentionShowBreakIntentionsInLongBreak: false,
  intentionCustomDurations: true,
  intentionSubIntentions: true,
  intentionHabits: false,
  intentionPrioritizeUnfinishedHabits: false,
  workTimerLogsExtension: true,
  sessionsExtension: true,
  sessionPomodorosCount: 3,
  sessionHasLongBreak: true,
  sessionLongBreakDuration: 15 * 60 * 1000,
  resetBreakOnFirstIntention: false,
  resetLongBreakOnFirstIntention: false,
  resetWorkOnFirstIntention: false,
  sessionShowLongBreakButton: false,
  sessionShowEta: false,
  sessionStackTimers: false,
  sessionAutoDetectLongBreak: false,
  keepScreenAwake: false,
  undoAlerts: false,
  tasksExtension: true,
  tasksShowSetupPrompts: true,
  tasksShowInMinimizedTimer: false,
  tasksAutoSwitchToIntentionMode: true,
  taskDefaultDueDateMode: 'tomorrow',
  taskDefaultDueDateDays: 1,
  taskDefaultSortMode: 'default',
  hiddenHelpTips: [],
  dismissedSettingSuggestions: [],
  taskReminderPriorities: ['high', 'urgent'],
  taskBeforeDueReminderMinutes: 0,
  taskUrgentReminderRepeatEnabled: true,
  taskUrgentReminderRepeatIntervalMinutes: 30,
  advancedSkip: true,
  timerExtension: true,
  timerExtrasSeen: false,
  sessionsExtrasSeen: false,
  intentionsExtrasSeen: false,
  assistantExtension: false,
  assistantTaskTranscriptsEnabled: false,
  assistantTaskTranscriptMinWords: 15,
  destinationDescriptionsEnabled: false,
  listsExtension: true,
  vacationExtension: false,
  vacationCoverageConfigured: false,
  tasksShowVacationCovered: false,
  longBreakToBreakEnabled: false,
} satisfies Partial<Preferences>;

@Injectable()
export class PreferencesService {
  readonly onPreferencesUpdate = new Subject<{
    userId: string;
    preferences: Preferences;
  }>();

  constructor(
    @InjectRepository(Preferences)
    private preferencesRepository: Repository<Preferences>,
    private readonly preferencesStore: PreferencesStore,
    @Inject(forwardRef(() => TimerService))
    private timerService?: TimerService
  ) {}

  async getPreferences(
    userId: string,
    initialLanguage?: AppLanguage
  ): Promise<Preferences> {
    const preferences = await this.preferencesStore.getOrLoad(
      userId,
      () => this.loadPreferences(userId, initialLanguage),
      initialLanguage !== undefined
    );
    return this.applyDefaultPreferences(preferences);
  }

  private async loadPreferences(
    userId: string,
    initialLanguage?: AppLanguage
  ): Promise<Preferences> {
    let preferences = await this.preferencesRepository.findOne({
      where: { userId },
    });

    if (!preferences) {
      const defaults = this.preferencesRepository.create({
        ...DEFAULT_PREFERENCES,
        userId,
        ...(initialLanguage ? { language: initialLanguage } : {}),
      });
      await this.preferencesRepository
        .createQueryBuilder()
        .insert()
        .into(Preferences)
        .values(defaults)
        .orIgnore()
        .execute();
      preferences = await this.preferencesRepository.findOne({
        where: { userId },
      });
      if (!preferences) {
        throw new InternalServerErrorException(
          'Failed to initialize preferences'
        );
      }
    }

    if (
      (preferences.language === null || preferences.language === undefined) &&
      initialLanguage !== undefined
    ) {
      preferences.language = initialLanguage;
      preferences = await this.preferencesRepository.save(preferences);
    }

    return this.applyDefaultPreferences(preferences);
  }

  async updatePreferences(
    userId: string,
    updates: UpdatePreferencesDto
  ): Promise<Preferences> {
    const preferences = await this.getPreferences(userId);
    const nextUpdates = { ...updates };
    const wasSessionsDisabled = !preferences.sessionsExtension;
    const sessionCountChanged =
      nextUpdates.sessionPomodorosCount !== undefined &&
      nextUpdates.sessionPomodorosCount !== preferences.sessionPomodorosCount;

    Object.assign(preferences, nextUpdates);

    const savedPreferences = await this.preferencesStore.writeThrough(
      userId,
      async () =>
        this.applyDefaultPreferences(
          await this.preferencesRepository.save(preferences)
        )
    );
    this.onPreferencesUpdate.next({ userId, preferences: savedPreferences });

    // If sessions extension was just enabled, apply it to current timer
    if (
      wasSessionsDisabled &&
      nextUpdates.sessionsExtension &&
      this.timerService
    ) {
      await this.timerService.applySessionToCurrentTimer(userId);
    }

    // If session pomodoro count changed, update the current session
    if (
      sessionCountChanged &&
      preferences.sessionsExtension &&
      this.timerService
    ) {
      await this.timerService.updateSessionTotal(userId);
    }

    return savedPreferences;
  }

  async invalidateCache(userId: string): Promise<void> {
    await this.preferencesStore.invalidate(userId);
  }

  private applyDefaultPreferences(preferences: Preferences): Preferences {
    for (const [key, value] of Object.entries(DEFAULT_PREFERENCES)) {
      const preferenceKey = key as keyof typeof DEFAULT_PREFERENCES;
      if (
        preferences[preferenceKey] === null ||
        preferences[preferenceKey] === undefined
      ) {
        preferences[preferenceKey] = value as never;
      }
    }

    return preferences;
  }
}
