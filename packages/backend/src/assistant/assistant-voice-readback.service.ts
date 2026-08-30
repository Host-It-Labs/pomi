import { Injectable } from '@nestjs/common';
import { normalizeAppLanguage, TIMER_TYPES, TimerTypes } from '@pomi/shared';
import { Intention } from '../intentions/intentions.entity';
import { TaskEntity } from '../tasks/tasks.entity';
import { toRecord } from './assistant-input-utils';
import { ParsedTaskDraft } from './assistant-input-interpreter';
import { translateAssistant } from '../i18n/assistant-localization';

type VoiceTaskReadbackSource = {
  rawTask: Record<string, unknown>;
  text: string;
};

@Injectable()
export class AssistantVoiceReadbackService {
  formatVoiceTasksCreatedMessage(
    tasks: TaskEntity[],
    drafts: ParsedTaskDraft[],
    rawTasks: unknown[],
    sourceText: string,
    intentions: Intention[],
    language: string | null | undefined,
    today = new Date().toISOString().slice(0, 10)
  ) {
    const readbacks = tasks.map((task, index) => {
      const draft = drafts[index] ?? { title: task.title };
      const metadataSource = this.findVoiceTaskMetadataSource(
        draft,
        rawTasks,
        sourceText,
        index,
        tasks.length
      );
      return {
        title: task.title,
        details: this.formatVoiceTaskReadbackDetails(
          task,
          metadataSource,
          intentions,
          language,
          today
        ),
      };
    });
    const created = this.formatTasksCreatedMessage(tasks, language);
    if (readbacks.length === 1) {
      const details = readbacks[0].details;
      return `${created}${details ? ` (${details})` : ''}`;
    }
    return `${created} ${readbacks
      .map(({ title, details }) => (details ? `${title} (${details})` : title))
      .join('; ')}`;
  }

  private formatTasksCreatedMessage(
    tasks: Array<{ title: string }>,
    language: string | null | undefined
  ) {
    return tasks.length === 1
      ? translateAssistant(language, 'taskCreated', { title: tasks[0].title })
      : translateAssistant(language, 'tasksCreated', { count: tasks.length });
  }

  private formatVoiceTaskReadbackDetails(
    task: TaskEntity,
    metadataSource: VoiceTaskReadbackSource,
    intentions: Intention[],
    language: string | null | undefined,
    today: string
  ) {
    const { rawTask, text: sourceText } = metadataSource;
    const linkedIntention = task.intentionSlug
      ? intentions.find(intention => intention.slug === task.intentionSlug)
      : undefined;
    const linkedSubIntention = task.subIntentionSlug
      ? intentions.find(intention => intention.slug === task.subIntentionSlug)
      : undefined;
    const rawIntentionSlug = this.voiceTaskString(rawTask, 'intentionSlug');
    const rawSubIntentionSlug = this.voiceTaskString(
      rawTask,
      'subIntentionSlug'
    );
    const rawIntentionMention = this.voiceTaskString(
      rawTask,
      'intentionMention'
    );
    const explicitSubIntention = Boolean(
      rawSubIntentionSlug ||
      (linkedSubIntention &&
        (rawIntentionSlug === linkedSubIntention.slug ||
          this.hasExplicitVoiceIntention(
            sourceText,
            linkedSubIntention.title
          ) ||
          (rawIntentionMention &&
            this.hasExplicitVoiceIntention(
              rawIntentionMention,
              linkedSubIntention.title
            ))))
    );
    const explicitIntention = Boolean(
      rawIntentionSlug ||
      explicitSubIntention ||
      (linkedIntention &&
        (this.hasExplicitVoiceIntention(sourceText, linkedIntention.title) ||
          (rawIntentionMention &&
            this.hasExplicitVoiceIntention(
              rawIntentionMention,
              linkedIntention.title
            ))))
    );
    const recurrence = this.getVoiceRecurrence(task);
    const explicitRecurrence = Boolean(
      recurrence && this.hasExplicitVoiceRecurrence(sourceText, rawTask)
    );
    const explicitRecurrenceAnchor = Boolean(
      explicitRecurrence &&
      task.recurrenceAnchorMode &&
      this.hasExplicitVoiceRecurrenceAnchor(sourceText, rawTask)
    );
    return translateAssistant(language, 'taskReadbackDetails', {
      dueDate:
        task.dueDate && this.hasExplicitVoiceDueDate(rawTask)
          ? this.formatDueDateForSpeech(task.dueDate, today, language)
          : '',
      dueTime:
        task.dueTime && this.hasExplicitVoiceDueTime(sourceText, rawTask)
          ? this.formatDueTimeForSpeech(task.dueTime, language)
          : '',
      priority: this.hasExplicitVoicePriority(sourceText, rawTask)
        ? task.priority
        : '',
      timerType: this.hasExplicitVoiceTimerType(sourceText, rawTask)
        ? task.timerType
        : '',
      intention: explicitIntention
        ? (linkedIntention?.title ?? task.intentionSlug ?? '')
        : '',
      subIntention: explicitSubIntention
        ? (linkedSubIntention?.title ?? task.subIntentionSlug ?? '')
        : '',
      recurrenceFrequency: explicitRecurrence
        ? (recurrence?.frequency ?? '')
        : '',
      recurrenceInterval: explicitRecurrence
        ? String(recurrence?.interval ?? 1)
        : '',
      recurrenceAnchor: explicitRecurrenceAnchor
        ? task.recurrenceAnchorMode
        : '',
    });
  }

  private findVoiceTaskMetadataSource(
    draft: ParsedTaskDraft,
    rawTasks: unknown[],
    sourceText: string,
    taskIndex: number,
    taskCount: number
  ): VoiceTaskReadbackSource {
    const normalizedTitle = this.normalizeReadbackText(draft.title);
    const candidates = rawTasks.map(rawTask => toRecord(rawTask));
    const matchedTask = candidates.find(rawTask => {
      const sourceSegments = Array.isArray(rawTask.sourceSegments)
        ? rawTask.sourceSegments.filter(
            (segment): segment is string => typeof segment === 'string'
          )
        : [];
      return sourceSegments.some(segment => {
        const normalizedSegment = this.normalizeReadbackText(segment);
        return Boolean(
          normalizedTitle &&
          (normalizedSegment.includes(normalizedTitle) ||
            normalizedTitle.includes(normalizedSegment))
        );
      });
    });
    const rawTask =
      matchedTask ??
      (candidates.length === taskCount ? (candidates[taskIndex] ?? {}) : {});
    const sourceSegments = Array.isArray(rawTask?.sourceSegments)
      ? rawTask.sourceSegments.filter(
          (segment): segment is string => typeof segment === 'string'
        )
      : [];
    return {
      rawTask,
      text:
        sourceSegments.length > 0
          ? sourceSegments.join(' ')
          : taskCount === 1
            ? sourceText
            : '',
    };
  }

  private hasExplicitVoiceDueDate(rawTask: Record<string, unknown>) {
    return /^\d{4}-\d{2}-\d{2}$/.test(this.voiceTaskString(rawTask, 'dueDate'));
  }

  private hasExplicitVoiceDueTime(
    sourceText: string,
    rawTask: Record<string, unknown>
  ) {
    if (
      /^([01]\d|2[0-3]):[0-5]\d$/.test(this.voiceTaskString(rawTask, 'dueTime'))
    ) {
      return true;
    }
    return (
      /\b(?:at|by)\s+(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:am|pm)?\b|\b(?:noon|midnight|morning|afternoon|evening|tonight)\b|\b(?:[01]?\d|2[0-3]):[0-5]\d\b/i.test(
        sourceText
      ) ||
      /(?:midi|minuit|ce matin|cet après-midi|ce soir|mediodía|medianoche|中午|午夜|今天早上|今天下午|今天晚上|दोपहर|आधी रात|आज सुबह|आज दोपहर|आज शाम|ظهر|منتصف الليل|هذا الصباح|بعد الظهر|الليلة|দুপুর|মধ্যরাত|আজ সকালে|আজ দুপুরে|আজ রাতে|meio-dia|meia-noite|esta manhã|esta tarde|esta noite|pagi ini|siang ini|malam ini|دوپہر|نصف شب|آج صبح|آج دوپہر|آج شام|آج رات)/u.test(
        sourceText
      )
    );
  }

  private hasExplicitVoicePriority(
    sourceText: string,
    rawTask: Record<string, unknown>
  ) {
    const rawPriority = this.voiceTaskString(rawTask, 'priority');
    if (
      ['low', 'normal', 'high', 'urgent'].includes(rawPriority) &&
      rawPriority !== 'normal'
    ) {
      return true;
    }
    return (
      /\b(?:low|normal|high|urgent)\s+(?:priority|task|item|request)\b|\bpriority\s+(?:is\s+|to\s+)?(?:low|normal|high|urgent)\b|\b(?:make|mark|set|put|flag|label|treat)(?:\s+(?:this|it))?(?:\s+as)?(?:\s+to)?\s+(?:low|normal|high|urgent)\b|\b(?:low|normal|high|urgent)(?=\s*[.!?]?$)/i.test(
        sourceText.trim()
      ) ||
      /(?:priorité basse|priorité normale|priorité haute|priorité urgente|prioridad baja|prioridad normal|prioridad alta|prioridad urgente|优先级低|优先级普通|优先级高|优先级紧急|कम प्राथमिकता|सामान्य प्राथमिकता|उच्च प्राथमिकता|अत्यावश्यक प्राथमिकता|أولوية منخفضة|أولوية عادية|أولوية عالية|أولوية عاجلة|কম অগ্রাধিকার|স্বাভাবিক অগ্রাধিকার|উচ্চ অগ্রাধিকার|জরুরি অগ্রাধিকার|prioridade baixa|prioridade normal|prioridade alta|prioridade urgente|prioritas rendah|prioritas normal|prioritas tinggi|prioritas mendesak|کم ترجیح|معمول ترجیح|زیادہ ترجیح|فوری ترجیح)/u.test(
        sourceText
      )
    );
  }

  private hasExplicitVoiceTimerType(
    sourceText: string,
    rawTask: Record<string, unknown>
  ) {
    const rawTimerType = this.voiceTaskString(rawTask, 'timerType');
    if (
      [TIMER_TYPES.WORK, TIMER_TYPES.BREAK, TIMER_TYPES.LONG_BREAK].includes(
        rawTimerType as TimerTypes
      ) &&
      rawTimerType !== TIMER_TYPES.WORK
    ) {
      return true;
    }
    return /\b(?:work|break|long[- ]?break)\s+(?:task|item|request)\b|\b(?:task|item|request)\s+(?:for|of)\s+(?:work|break|long[- ]?break)\b/i.test(
      sourceText
    );
  }

  private hasExplicitVoiceIntention(sourceText: string, title: string) {
    const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(
      `(?:\\b(?:for|under|within|in|to)\\s+(?:the\\s+)?${escapedTitle}(?:\\s+intention)?\\b|\\bintention\\s+${escapedTitle}\\b|\\b${escapedTitle}\\s+intention\\b)`,
      'i'
    ).test(sourceText);
  }

  private hasExplicitVoiceRecurrence(
    sourceText: string,
    rawTask: Record<string, unknown>
  ) {
    if (
      this.hasVoiceTaskValue(rawTask, 'recurrenceRule') ||
      this.hasVoiceTaskValue(rawTask, 'recurrenceInterval') ||
      this.hasVoiceTaskValue(rawTask, 'recurrenceAnchorMode')
    ) {
      return true;
    }
    return /\b(?:every|each)\s+(?:other\s+)?(?:\d+\s+)?(?:day|days|week|weeks|month|months)\b|\b(?:daily|weekly|monthly|recurring|repeat(?:ing)?)\b|(?:每天|每周|每月|每日|ہر روز|ہر ہفتے|ہر ماہ|روزانہ|ہفتہ وار|ماہانہ)/iu.test(
      sourceText
    );
  }

  private hasExplicitVoiceRecurrenceAnchor(
    sourceText: string,
    rawTask: Record<string, unknown>
  ) {
    if (this.hasVoiceTaskValue(rawTask, 'recurrenceAnchorMode')) return true;
    return /\b(?:from completion|after completion|when completed|when complete|from the due date|from planned date)\b|(?:完成后|पूरा होने के बाद|بعد الإكمال|সম্পন্ন হওয়ার পর|após a conclusão|setelah selesai|تکمیل کے بعد)/iu.test(
      sourceText
    );
  }

  private getVoiceRecurrence(task: TaskEntity) {
    const rule = task.recurrenceRule?.toUpperCase().replace(/^RRULE:/, '');
    const frequencyMatch = rule?.match(
      /(?:^|;)FREQ=(DAILY|WEEKLY|MONTHLY)(?:;|$)/
    );
    const frequency = frequencyMatch?.[1]?.toLowerCase();
    if (!frequency) return null;
    const interval =
      rule?.match(/(?:^|;)INTERVAL=(\d+)(?:;|$)/)?.[1] ??
      (task.recurrenceInterval ? String(task.recurrenceInterval) : '1');
    return { frequency, interval: Number(interval) || 1 };
  }

  private formatDueDateForSpeech(
    dueDate: string,
    today: string,
    language: string | null | undefined
  ) {
    const due = this.parseCalendarDate(dueDate);
    const reference = this.parseCalendarDate(today);
    if (!due || !reference) return dueDate;

    const locale = normalizeAppLanguage(language) ?? 'en';
    const dayDifference = Math.round(
      (due.getTime() - reference.getTime()) / 86_400_000
    );
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (Math.abs(dayDifference) <= 2) {
      return relative.format(dayDifference, 'day');
    }
    if (dayDifference !== 0 && dayDifference % 7 === 0) {
      const weekDifference = dayDifference / 7;
      if (Math.abs(weekDifference) <= 4) {
        return relative.format(weekDifference, 'week');
      }
    }

    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      ...(due.getUTCFullYear() === reference.getUTCFullYear()
        ? {}
        : { year: 'numeric' as const }),
      timeZone: 'UTC',
    }).format(due);
  }

  private formatDueTimeForSpeech(
    dueTime: string,
    language: string | null | undefined
  ) {
    const match = dueTime.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!match) return dueTime;
    const date = new Date(
      Date.UTC(2000, 0, 1, Number(match[1]), Number(match[2]))
    );
    return new Intl.DateTimeFormat(normalizeAppLanguage(language) ?? 'en', {
      hour: 'numeric',
      minute: match[2] === '00' ? undefined : '2-digit',
      timeZone: 'UTC',
    }).format(date);
  }

  private parseCalendarDate(value: string) {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    );
    return date.toISOString().slice(0, 10) === value ? date : null;
  }

  private voiceTaskString(rawTask: Record<string, unknown>, key: string) {
    const value = rawTask[key];
    return typeof value === 'string' ? value.trim() : '';
  }

  private hasVoiceTaskValue(rawTask: Record<string, unknown>, key: string) {
    const value = rawTask[key];
    return (
      (typeof value === 'string' && value.trim().length > 0) ||
      (typeof value === 'number' && Number.isFinite(value))
    );
  }

  private normalizeReadbackText(value: string) {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }
}
