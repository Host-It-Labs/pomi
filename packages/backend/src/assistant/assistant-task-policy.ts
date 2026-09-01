import { TASK_PRIORITIES, TIMER_TYPES } from '@pomi/shared';
import { normalizeOptionalString, toRecord } from './assistant-input-utils';
import { AssistantIntentionResolver } from './assistant-intention-resolver';
import {
  AssistantCaptureIntention,
  AssistantTaskDefaults,
  AssistantTaskTranscriptSettings,
  MAX_TASKS_PER_REQUEST,
  ParsedTaskDraft,
} from './assistant-input-types';

const MAX_TITLE_WORDS = 15;
const TARGET_TITLE_WORDS = 10;
const MIN_NATURAL_TITLE_SPLIT_WORDS = 8;
const FALLBACK_TITLE_WORDS = 10;
const MAX_SOURCE_SEGMENTS_PER_TASK = 32;
const MAX_DESCRIPTION_SOURCE_MATCH_CHARS = 20_000;
const DEFAULT_TRANSCRIPT_MIN_WORDS = 15;
const DAYPART_DUE_TIMES = [
  {
    pattern:
      /(?:\b(?:this\s+)?morning\b|esta\s+mañana|ce\s+matin|esta\s+manhã|pagi\s+ini|今天早上|今早|上午|هذا\s+الصباح|आज\s+सुबह|আজ\s+সকালে|آج\s+صبح)/iu,
    time: '09:00',
  },
  {
    pattern:
      /(?:\b(?:this\s+)?afternoon\b|esta\s+tarde|cet\s+après[-\s]midi|siang\s+ini|sore\s+ini|今天下午|下午|بعد\s+الظهر|आज\s+दोपहर|আজ\s+দুপুরে|آج\s+دوپہر)/iu,
    time: '14:00',
  },
  {
    pattern:
      /(?:\b(?:this\s+)?(?:evening|tonight)\b|esta\s+noche|ce\s+soir|esta\s+noite|malam\s+ini|今晚|今天晚上|晚上|هذا\s+المساء|الليلة|आज\s+(?:शाम|रात)|আজ\s+(?:সন্ধ্যায়|রাতে)|آج\s+(?:شام|رات))/iu,
    time: '20:00',
  },
] as const;
const AMBIGUOUS_DUE_TIME_PATTERN =
  /\b(?:later|sometime|end\s+of\s+(?:the\s+)?day|close\s+of\s+business|eod)\b/i;
const INDEPENDENT_LIST_ACTION_PATTERN =
  /^(?:please\s+)?(add|buy|order|purchase|get|collect|gather|pack|send|email|call|text|message|book|pay|check|review|read|watch|renew|prepare|submit|complete|finish|take|bring|remove|delete|cancel|update|fix|replace|install|download|upload|print|open|close|clean|wash|organize|sort|choose|select|compare|contact|invite|visit|return|pick up|drop off)\b/i;
const LIST_DETAIL_INTRODUCER_PATTERN =
  /\b(?:with|including|such as|for example|e\.g\.?|containing|featuring|comprising|consisting of)\b/i;
const EXPLICIT_LIST_MARKER_PATTERN =
  /^(?:the\s+)?(?:following|these|next)(?:\s+(?:items?|tasks?))?\s*:\s*/i;

const MULTILINGUAL_TIMER_ONLY_PATTERNS = [
  /^(?:please\s+)?(?:start|begin|launch|activate|set|put(?:\s+on)?)\s+(?:a\s+)?(?:(?:long[- ]?break|break|work)\s+)?(?:timer|pomodoro|session)(?:\s+(?:for|of)\s+\d+\s+(?:minutes?|mins?))?$/i,
  /^(?:please\s+)?(?:pause|stop|hold)\s+(?:the\s+|a\s+)?(?:current\s+)?(?:timer|pomodoro|session)$/i,
  /^(?:please\s+)?(?:add|give|put)\s+(?:me\s+)?(?:five|5)\s+minutes?\s+(?:to|on)\s+(?:the\s+)?(?:timer|pomodoro|session)$/i,
  /^(?:démarrer|démarre|lancer|lance|activer|active)\s+(?:un\s+)?(?:(?:longue?\s+pause|pause|travail)\s+)?(?:minuteur|timer|pomodoro|session)(?:\s+(?:pour|de)\s+\d+\s+minutes?)?$/iu,
  /^(?:mettre|mets|mettez)\s+(?:le\s+)?(?:minuteur|timer|pomodoro|session)\s+en\s+pause$/iu,
  /^(?:ajoute|ajouter|ajoutez)\s+(?:cinq|5)\s+minutes?\s+(?:au|sur\s+le)\s+(?:minuteur|timer|pomodoro|session)$/iu,
  /^(?:inicia|iniciar|comienza|comenzar|activa|activar)\s+(?:un\s+)?(?:temporizador|timer|pomodoro|sesión)(?:\s+(?:por|de)\s+\d+\s+minutos?)?$/iu,
  /^(?:pausa|pausar|detén|detener)\s+(?:el\s+)?(?:temporizador|timer|pomodoro|sesión)$/iu,
  /^(?:añade|añadir|agrega|agregar)\s+(?:cinco|5)\s+minutos?\s+(?:al|en\s+el)\s+(?:temporizador|timer|pomodoro|sesión)$/iu,
  /^(?:inicia|iniciar|começa|começar|ativa|ativar)\s+(?:o\s+)?(?:temporizador|timer|pomodoro|sessão)(?:\s+(?:por|de)\s+\d+\s+minutos?)?$/iu,
  /^(?:pausa|pausar|pare|parar)\s+(?:o\s+)?(?:temporizador|timer|pomodoro|sessão)$/iu,
  /^(?:adicione|adicionar|acrescente|acrescentar)\s+(?:cinco|5)\s+minutos?\s+(?:ao|no)\s+(?:temporizador|timer|pomodoro|sessão)$/iu,
  /^(?:mulai|jalankan|aktifkan)\s+(?:timer|pomodoro|sesi)(?:\s+selama\s+\d+\s+menit)?$/iu,
  /^(?:jeda|hentikan|berhentikan)\s+(?:timer|pomodoro|sesi)$/iu,
  /^(?:tambahkan|tambah)\s+(?:lima|5)\s+menit\s+(?:ke|pada)\s+(?:timer|pomodoro|sesi)$/iu,
  /^(?:开始|启动|开启)\s*(?:一个)?\s*(?:计时器|番茄钟|计时|会话)(?:\s*\d+\s*分钟)?$/u,
  /^(?:暂停|停止)\s*(?:当前)?\s*(?:计时器|番茄钟|计时|会话)$/u,
  /^(?:给|为)?\s*(?:计时器|番茄钟|计时|会话)\s*(?:增加|添加)\s*(?:五|5)\s*分钟$/u,
  /^\s*(?:टाइमर|पोमोडोरो|सत्र)\s+(?:शुरू|चालू)\s+(?:करो|करें|करिये)\s*$/u,
  /^\s*(?:टाइमर|पोमोडोरो|सत्र)\s+(?:रोकें|रोक|बंद करें|बन्द करें)\s*$/u,
  /^\s*(?:टाइमर|पोमोडोरो|सत्र)\s+में\s+(?:पाँच|पांच|5)\s+मिनट\s+जोड़ें\s*$/u,
  /^(?:ابدأ|شغّل|شغل)\s+(?:المؤقت|مؤقت|بومودورو|الجلسة)$/u,
  /^(?:أوقف|اوقف|أوقفْ|اوقفْ)\s+(?:المؤقت|مؤقت|بومودورو|الجلسة)$/u,
  /^(?:أضف|اضف)\s+(?:خمس|5)\s+دقائق?\s+(?:إلى|الى)\s+(?:المؤقت|مؤقت)$/u,
  /^(?:টাইমার|পোমোডোরো|সেশন)\s+(?:শুরু|চালু)\s+করুন$/u,
  /^(?:টাইমার|পোমোডোরো|সেশন)\s+(?:থামান|বন্ধ করুন)$/u,
  /^(?:টাইমারে|টাইমার|পোমোডোরোতে)\s+(?:পাঁচ|৫|5)\s+মিনিট\s+যোগ\s+করুন$/u,
  /^(?:ٹائمر|پومودورو|سیشن)\s+(?:شروع|چالو)\s+کریں$/u,
  /^(?:ٹائمر|پومودورو|سیشن)\s+(?:روکیں|بند کریں)$/u,
  /^(?:ٹائمر|پومودورو|سیشن)\s+میں\s+(?:پانچ|۵|5)\s+منٹ\s+شامل\s+کریں$/u,
] as const;

type RawTask = Record<string, unknown>;

type SourceSpan = {
  taskIndex: number;
  start: number;
  end: number;
};

export class AssistantTaskPolicy {
  private readonly intentionResolver = new AssistantIntentionResolver();

  normalizeTasks(
    rawTasks: unknown[],
    sourceText: string,
    today: string,
    intentions: AssistantCaptureIntention[],
    defaults: AssistantTaskDefaults | undefined,
    resolutionNotes: string[],
    unresolvedMetadata: string[],
    voiceCommand: boolean,
    transcriptSettings?: AssistantTaskTranscriptSettings
  ) {
    const normalizedTranscriptSettings =
      this.normalizeTranscriptSettings(transcriptSettings);
    const sourceUrls = this.extractSourceUrls(sourceText);
    const expandedTasks = this.expandIndependentListTasks(rawTasks, sourceText);
    const taskCandidates = voiceCommand
      ? this.removeTimerOnlyTasks(expandedTasks)
      : expandedTasks;
    const groupedTasks = this.mergeContinuationTasks(taskCandidates);
    const tasks = groupedTasks.slice(0, MAX_TASKS_PER_REQUEST).map(task => {
      const sourceSegments = this.readSourceSegments(
        toRecord(task).sourceSegments,
        sourceText
      );
      return this.normalizeTask(
        task,
        sourceText,
        today,
        intentions,
        defaults,
        resolutionNotes,
        sourceSegments,
        normalizedTranscriptSettings,
        this.sourceUrlsForTask(
          task,
          sourceUrls,
          taskCandidates.length === 1 || toRecord(task).__listExpanded === true
        ),
        toRecord(task).__listExpanded === true || groupedTasks.length === 1
          ? sourceText
          : sourceSegments.join(' ')
      );
    });
    if (tasks.length === 0 || unresolvedMetadata.length === 0) {
      return tasks;
    }
    for (const fragment of unresolvedMetadata) {
      const normalized = this.normalizeWhitespace(fragment).toLowerCase();
      if (!normalized) continue;
      const targetIndex = tasks.findIndex(task =>
        this.normalizeWhitespace(`${task.title} ${task.description ?? ''}`)
          .toLowerCase()
          .includes(normalized)
      );
      if (targetIndex >= 0) continue;
      const fallbackIndex = tasks.findIndex(task =>
        this.normalizeWhitespace(task.description ?? '')
          .toLowerCase()
          .includes(normalized.split(/\s+/)[0] ?? '')
      );
      const index = fallbackIndex >= 0 ? fallbackIndex : 0;
      tasks[index] = {
        ...tasks[index],
        description: this.appendDescription(tasks[index].description, fragment),
      };
    }

    return tasks;
  }

  private expandIndependentListTasks(rawTasks: unknown[], sourceText: string) {
    const list = this.findIndependentList(sourceText);
    if (!list) return rawTasks;

    const listTaskIndex = rawTasks.reduce<{ index: number; score: number }>(
      (bestIndex, rawTask, index) => {
        const score = this.scoreIndependentListTask(rawTask, list.items);
        return score > bestIndex.score ? { index, score } : bestIndex;
      },
      { index: -1, score: 0 }
    );
    if (listTaskIndex.index < 0 || listTaskIndex.score < list.items.length) {
      return rawTasks;
    }

    const rawTask = toRecord(rawTasks[listTaskIndex.index]);
    const sourceCandidates = Array.isArray(rawTask.sourceSegments)
      ? rawTask.sourceSegments.filter(
          (segment): segment is string => typeof segment === 'string'
        )
      : [];
    if (
      sourceCandidates.length > 0 &&
      !list.items.every(item =>
        sourceCandidates.some(
          candidate => this.findSourceSegment(item, candidate) !== null
        )
      )
    ) {
      return rawTasks;
    }

    const description = normalizeOptionalString(rawTask.description);
    const cleanedDescription = this.isListSummaryDescription(description)
      ? null
      : description;
    const baseOutcomeKey =
      normalizeOptionalString(rawTask.outcomeKey) ?? 'independent-list';
    const expanded = list.items.map((item, index) => ({
      ...rawTask,
      title: `${list.action} ${item}`,
      description: cleanedDescription,
      sourceSegments: [item],
      essentialDetails: [item],
      outcomeKey: `${baseOutcomeKey}-${index + 1}`,
      __listExpanded: true,
    }));
    const remaining = rawTasks.filter(
      (candidate, index) =>
        index !== listTaskIndex.index &&
        !this.isDuplicateIndependentListTask(candidate, rawTask, list.items)
    );
    return [...expanded, ...remaining];
  }

  private scoreIndependentListTask(rawTask: unknown, items: string[]) {
    const value = toRecord(rawTask);
    const candidates = [
      value.title,
      value.description,
      ...(Array.isArray(value.sourceSegments) ? value.sourceSegments : []),
      ...(Array.isArray(value.essentialDetails) ? value.essentialDetails : []),
    ].filter((candidate): candidate is string => typeof candidate === 'string');
    return items.filter(item =>
      candidates.some(candidate => this.findSourceSegment(item, candidate))
    ).length;
  }

  private isDuplicateIndependentListTask(
    candidate: unknown,
    listTask: RawTask,
    items: string[]
  ) {
    const value = toRecord(candidate);
    const listCandidates = Array.isArray(listTask.sourceSegments)
      ? listTask.sourceSegments.filter(
          (segment): segment is string => typeof segment === 'string'
        )
      : [];
    const candidateSegments = Array.isArray(value.sourceSegments)
      ? value.sourceSegments.filter(
          (segment): segment is string => typeof segment === 'string'
        )
      : [];
    if (
      listCandidates.length === 0 ||
      candidateSegments.length === 0 ||
      !candidateSegments.every(candidateSegment =>
        listCandidates.some(listCandidate =>
          this.findSourceSegment(candidateSegment, listCandidate)
        )
      )
    ) {
      return false;
    }

    const taskText = [
      value.title,
      value.description,
      ...(Array.isArray(value.essentialDetails) ? value.essentialDetails : []),
    ]
      .filter((candidate): candidate is string => typeof candidate === 'string')
      .join(' ');
    return !items.some(item => this.findSourceSegment(item, taskText));
  }

  private findIndependentList(sourceText: string) {
    const text = this.normalizeWhitespace(sourceText).replace(/[.!?]+$/, '');
    const actionMatch = text.match(INDEPENDENT_LIST_ACTION_PATTERN);
    if (!actionMatch) return null;

    const action = actionMatch[1];
    let remainder = text.slice(actionMatch[0].length).trim();
    const explicitMarker = remainder.match(EXPLICIT_LIST_MARKER_PATTERN);
    if (explicitMarker) {
      remainder = remainder.slice(explicitMarker[0].length).trim();
    }

    const targetMatch = remainder.match(
      /\s+(?:to|under|within|in|for)\s+[^.!?]+$/i
    );
    const listHead = (
      targetMatch ? remainder.slice(0, targetMatch.index) : remainder
    ).trim();
    if (!listHead) return null;

    const firstSeparator = listHead.search(/\s*,\s*/);
    const firstItemPrefix =
      firstSeparator >= 0 ? listHead.slice(0, firstSeparator) : listHead;
    if (
      !explicitMarker &&
      (LIST_DETAIL_INTRODUCER_PATTERN.test(firstItemPrefix) ||
        /[:;]/.test(firstItemPrefix))
    ) {
      return null;
    }

    const commaParts = listHead
      .split(/\s*,\s*/)
      .map(part => part.trim())
      .filter(Boolean);
    let items = commaParts;
    if (commaParts.length > 1) {
      const last = commaParts.pop() ?? '';
      const lastItems = last
        .replace(/^(?:and|or)\s+/i, '')
        .split(/\s+(?:and|or)\s+/i)
        .map(part => part.trim())
        .filter(Boolean);
      items = [...commaParts, ...lastItems];
    } else if (explicitMarker || /\s+(?:and|or)\s+/i.test(listHead)) {
      items = listHead
        .split(/\s+(?:and|or)\s+/i)
        .map(part => part.trim())
        .filter(Boolean);
    }

    if (
      items.length < 2 ||
      items.some(
        item =>
          item.split(/\s+/).length > 8 ||
          item.length > 80 ||
          this.isMetadataLikeListItem(item)
      )
    ) {
      return null;
    }
    const sourceItems = items.map(item =>
      this.findSourceSegmentWithIndex(item, sourceText)
    );
    if (
      sourceItems.some(item => item === null) ||
      new Set(sourceItems.map(item => item?.text.toLowerCase())).size !==
        sourceItems.length
    ) {
      return null;
    }
    return {
      action: action.charAt(0).toUpperCase() + action.slice(1),
      items: sourceItems.map(item => item!.text),
    };
  }

  private isListSummaryDescription(value: string | null) {
    if (!value) return false;
    const normalized = this.normalizeMatchText(value);
    return (
      normalized.split(/\s+/).length <= 6 &&
      /\b(?:item|items|list|things|entries|following)\b/.test(normalized)
    );
  }

  private isMetadataLikeListItem(value: string) {
    return /\b(?:every|each|starting|today|tomorrow|tonight|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|due|priority|urgent|normal|high|low|intention|recurring|daily|weekly|monthly)\b/i.test(
      value
    );
  }

  /**
   * Voice capture has a separate timer command channel.  Models occasionally
   * echo "start a break timer" as a Task as well; discard that echo while
   * retaining any real Task that shares the same recording.
   */
  private removeTimerOnlyTasks(rawTasks: unknown[]): unknown[] {
    return rawTasks.filter(rawTask => !this.isTimerOnlyTask(rawTask));
  }

  private isTimerOnlyTask(rawTask: unknown) {
    const value = toRecord(rawTask);
    const titleAndDescription = [value.title, value.description]
      .filter((candidate): candidate is string => typeof candidate === 'string')
      .join(' ');
    if (!this.isTimerOnlyPhrase(titleAndDescription)) return false;

    const sourceSegments = Array.isArray(value.sourceSegments)
      ? value.sourceSegments.filter(
          (segment): segment is string => typeof segment === 'string'
        )
      : [];
    return (
      sourceSegments.length === 0 ||
      sourceSegments.every(segment => this.isTimerOnlyPhrase(segment))
    );
  }

  private isTimerOnlyPhrase(value: string) {
    const text = this.normalizeWhitespace(value).replace(/[.!?]+$/, '');
    return MULTILINGUAL_TIMER_ONLY_PATTERNS.some(pattern => pattern.test(text));
  }

  /**
   * The model may emit one draft for each sentence when a user returns to an
   * earlier outcome. outcomeKey is preferred evidence for grouping; a clear
   * continuation marker plus shared outcome language covers models that emit
   * different keys while keeping unrelated Tasks independent.
   */
  private mergeContinuationTasks(rawTasks: unknown[]): RawTask[] {
    const grouped: RawTask[] = [];
    const indexes = new Map<string, number>();
    for (const rawTask of rawTasks) {
      const value = { ...toRecord(rawTask) };
      const key = normalizeOptionalString(value.outcomeKey)?.toLowerCase();
      const index = key ? indexes.get(key) : undefined;
      if (index === undefined) {
        const continuationIndex = this.findImplicitContinuationIndex(
          grouped,
          value
        );
        if (continuationIndex !== undefined) {
          this.mergeTaskValues(grouped[continuationIndex], value);
          if (key) indexes.set(key, continuationIndex);
          continue;
        }
        if (key) indexes.set(key, grouped.length);
        grouped.push(value);
        continue;
      }

      this.mergeTaskValues(grouped[index], value);
    }
    return grouped;
  }

  private findImplicitContinuationIndex(
    grouped: RawTask[],
    candidate: RawTask
  ) {
    if (candidate.__listExpanded === true) return undefined;
    const candidateText = this.taskEvidenceText(candidate);
    if (!this.hasContinuationMarker(candidateText)) return undefined;
    const candidateIntention = normalizeOptionalString(candidate.intentionSlug);
    const candidateSubIntention = normalizeOptionalString(
      candidate.subIntentionSlug
    );
    const candidateTokens = this.meaningfulTaskTokens(
      candidateText,
      candidateIntention,
      candidateSubIntention
    );
    if (candidateTokens.size === 0) return undefined;

    for (let index = grouped.length - 1; index >= 0; index -= 1) {
      const previous = grouped[index];
      if (previous.__listExpanded === true) continue;
      if (
        normalizeOptionalString(previous.intentionSlug) !==
          candidateIntention ||
        normalizeOptionalString(previous.subIntentionSlug) !==
          candidateSubIntention
      ) {
        continue;
      }
      const previousTokens = this.meaningfulTaskTokens(
        this.taskEvidenceText(previous),
        normalizeOptionalString(previous.intentionSlug),
        normalizeOptionalString(previous.subIntentionSlug)
      );
      if ([...candidateTokens].some(token => previousTokens.has(token))) {
        return index;
      }
    }
    return undefined;
  }

  private hasContinuationMarker(value: string) {
    return /\b(?:back\s+to|return(?:ing)?\s+to|going\s+back\s+to|continue(?:\s+(?:with|on))?|continuing(?:\s+(?:with|on))?|as\s+for|on\s+that|to\s+continue)\b/i.test(
      value
    );
  }

  private taskEvidenceText(value: RawTask) {
    return [
      value.title,
      value.description,
      ...(Array.isArray(value.sourceSegments) ? value.sourceSegments : []),
      ...(Array.isArray(value.essentialDetails) ? value.essentialDetails : []),
    ]
      .filter((candidate): candidate is string => typeof candidate === 'string')
      .join(' ');
  }

  private meaningfulTaskTokens(
    value: string,
    intentionSlug: string | null,
    subIntentionSlug: string | null
  ) {
    const ignored = new Set([
      'about',
      'after',
      'also',
      'back',
      'before',
      'break',
      'check',
      'continue',
      'date',
      'feature',
      'for',
      'from',
      'into',
      'make',
      'mode',
      'note',
      'on',
      'project',
      'return',
      'returning',
      'the',
      'this',
      'under',
      'with',
    ]);
    for (const slug of [intentionSlug, subIntentionSlug]) {
      for (const token of this.normalizeMatchText(slug ?? '').split(/\s+/)) {
        if (token) ignored.add(token);
      }
    }
    return new Set(
      this.normalizeMatchText(value)
        .split(/\s+/)
        .filter(token => token.length >= 4 && !ignored.has(token))
    );
  }

  private mergeTaskValues(current: RawTask, value: RawTask) {
    current.sourceSegments = this.mergeStringArrays(
      current.sourceSegments,
      value.sourceSegments
    );
    current.essentialDetails = this.mergeStringArrays(
      current.essentialDetails,
      value.essentialDetails
    );
    const currentDescription = normalizeOptionalString(current.description);
    const nextDescription = normalizeOptionalString(value.description);
    if (nextDescription && nextDescription !== currentDescription) {
      current.description = this.appendDescription(
        currentDescription,
        nextDescription
      );
    }
    for (const field of [
      'dueDate',
      'dueTime',
      'priority',
      'timerType',
      'recurrenceRule',
      'recurrenceInterval',
      'recurrenceAnchorMode',
      'intentionSlug',
      'subIntentionSlug',
      'intentionMention',
    ]) {
      if (
        (current[field] === undefined || current[field] === null) &&
        value[field] !== undefined &&
        value[field] !== null
      ) {
        current[field] = value[field];
      }
    }
  }

  private mergeStringArrays(left: unknown, right: unknown) {
    return [
      ...(Array.isArray(left) ? left : []),
      ...(Array.isArray(right) ? right : []),
    ].filter(
      (value, index, all): value is string =>
        typeof value === 'string' &&
        value.trim().length > 0 &&
        all.indexOf(value) === index
    );
  }

  createFallbackTask(
    sourceText: string,
    today: string,
    defaults: AssistantTaskDefaults | undefined,
    intentions: AssistantCaptureIntention[],
    resolutionNotes: string[],
    transcriptSettings?: AssistantTaskTranscriptSettings,
    localizedFallbackTitle?: string
  ): ParsedTaskDraft {
    const normalizedTranscriptSettings =
      this.normalizeTranscriptSettings(transcriptSettings);
    const sourceTranscript = this.buildSourceTranscript(
      [sourceText],
      normalizedTranscriptSettings,
      this.buildTranscriptSemanticText(
        [sourceText],
        defaults ?? {},
        intentions,
        null
      )
    );
    const fallbackDescription = sourceTranscript
      ? defaults?.description
      : this.appendDescription(defaults?.description, sourceText);
    let title = this.normalizeWhitespace(sourceText)
      .replace(
        /^(?:please\s+)?(?:create|add|make)\s+(?:a\s+)?task(?:\s+to)?\s+/i,
        ''
      )
      .replace(/^remind\s+me\s+to\s+/i, '');
    title = title
      .replace(/\bfor\s+[^,.;]{1,60}\s+intention\b/gi, ' ')
      .replace(/\bintention\s+[^,.;]+/gi, ' ');
    title = title.split(
      /\b(?:today|tomorrow|due|priority|intention)\b|\b(?:on|by|at)\s+(?=\d)/i
    )[0];
    title = this.cleanTitlePunctuation(title);
    const words = title
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, FALLBACK_TITLE_WORDS);
    const fallbackTitle = words.join(' ');
    const safeTitle = fallbackTitle || localizedFallbackTitle || sourceText;
    const capitalizedTitle = safeTitle
      ? `${safeTitle.charAt(0).toUpperCase()}${safeTitle.slice(1)}`
      : safeTitle;
    const withDefaults = this.applyRecurrenceDueDateInvariant(
      this.applyDefaults(
        {
          title: capitalizedTitle,
          description: fallbackDescription,
          priority: this.extractSourcePriority(sourceText),
        },
        defaults
      ),
      today
    );
    const resolved = this.intentionResolver.resolve(
      {},
      sourceText,
      intentions,
      resolutionNotes
    );
    const linked: ParsedTaskDraft = {
      ...withDefaults,
      intentionSlug:
        resolved.intentionSlug !== undefined
          ? resolved.intentionSlug
          : (withDefaults.intentionSlug ?? undefined),
      subIntentionSlug:
        resolved.subIntentionSlug !== undefined
          ? resolved.subIntentionSlug
          : (withDefaults.subIntentionSlug ?? undefined),
    };
    linked.timerType = this.resolveTimerType(linked, sourceText, intentions);
    return {
      ...this.cleanTaskTitle(linked, intentions, null, sourceText),
      sourceTranscript,
    };
  }

  private normalizeTask(
    input: unknown,
    sourceText: string,
    today: string,
    intentions: AssistantCaptureIntention[],
    defaults: AssistantTaskDefaults | undefined,
    resolutionNotes: string[],
    sourceSegments: string[],
    transcriptSettings: AssistantTaskTranscriptSettings,
    sourceUrls: string[],
    metadataSourceText: string
  ): ParsedTaskDraft {
    const value = toRecord(input);
    const base: ParsedTaskDraft = {
      title: normalizeOptionalString(value.title) ?? sourceText,
      description: this.normalizeModelDescription(
        normalizeOptionalString(value.description),
        sourceSegments,
        sourceText
      ),
      dueDate: this.sanitizeDueDate(value.dueDate),
      dueTime: this.resolveDueTime(
        this.sanitizeDueTime(value.dueTime),
        metadataSourceText || sourceText,
        resolutionNotes
      ),
      priority: this.resolvePriority(value.priority, metadataSourceText),
      timerType: this.sanitizeTimerType(value.timerType),
      recurrenceRule: this.sanitizeRecurrenceRule(value.recurrenceRule),
      recurrenceInterval: this.sanitizeRecurrenceInterval(
        value.recurrenceInterval
      ),
      recurrenceAnchorMode: this.sanitizeRecurrenceAnchor(
        value.recurrenceAnchorMode
      ),
    };
    const withDefaults = this.applyRecurrenceDueDateInvariant(
      this.applyDefaults(base, defaults),
      today
    );
    const resolved = this.intentionResolver.resolve(
      value,
      metadataSourceText,
      intentions,
      resolutionNotes
    );
    const intentionMention = normalizeOptionalString(value.intentionMention);
    const linked = {
      ...withDefaults,
      intentionSlug:
        resolved.intentionSlug !== undefined
          ? resolved.intentionSlug
          : (withDefaults.intentionSlug ?? undefined),
      subIntentionSlug:
        resolved.subIntentionSlug !== undefined
          ? resolved.subIntentionSlug
          : (withDefaults.subIntentionSlug ?? undefined),
    };
    linked.timerType = this.resolveTimerType(
      linked,
      metadataSourceText,
      intentions
    );
    if (intentionMention && !linked.intentionSlug) {
      linked.description = this.appendDescription(
        linked.description,
        this.findIntentionSourceFragment(metadataSourceText, intentionMention)
      );
    }
    linked.description = this.appendSourceUrls(linked.description, sourceUrls);
    linked.description = this.appendMissingEssentialDetails(
      linked.description,
      this.readEssentialDetails(
        value.essentialDetails,
        metadataSourceText || sourceText
      ),
      linked.title
    );
    linked.sourceTranscript = this.buildSourceTranscript(
      sourceSegments,
      transcriptSettings,
      this.buildTranscriptSemanticText(
        sourceSegments,
        linked,
        intentions,
        intentionMention
      )
    );
    return this.cleanTaskTitle(
      {
        ...linked,
        title: this.cleanTitlePunctuation(
          this.normalizeWhitespace(linked.title)
        ),
      },
      intentions,
      intentionMention,
      metadataSourceText
    );
  }

  private applyDefaults(
    draft: ParsedTaskDraft,
    defaults?: AssistantTaskDefaults
  ): ParsedTaskDraft {
    if (!defaults) return draft;
    return {
      ...draft,
      description: draft.description ?? defaults.description,
      dueDate: draft.dueDate ?? defaults.dueDate,
      dueTime: draft.dueTime ?? defaults.dueTime,
      priority: draft.priority ?? defaults.priority,
      timerType: draft.timerType ?? defaults.timerType,
      recurrenceRule: draft.recurrenceRule ?? defaults.recurrenceRule,
      recurrenceInterval:
        draft.recurrenceInterval ?? defaults.recurrenceInterval,
      recurrenceAnchorMode:
        draft.recurrenceAnchorMode ?? defaults.recurrenceAnchorMode,
      intentionSlug: draft.intentionSlug ?? defaults.intentionSlug,
      subIntentionSlug: draft.subIntentionSlug ?? defaults.subIntentionSlug,
    };
  }

  needsReview(rawTasks: unknown[], sourceText?: string) {
    if (
      sourceText !== undefined &&
      this.hasAmbiguousSourceOwnership(rawTasks, sourceText)
    ) {
      return true;
    }

    return rawTasks.some(rawTask => {
      const task = toRecord(rawTask);
      const title = normalizeOptionalString(task.title);
      if (!title || title.split(/\s+/).length > MAX_TITLE_WORDS) return true;

      if (
        !Array.isArray(task.sourceSegments) ||
        task.sourceSegments.length === 0 ||
        task.sourceSegments.some(segment => {
          if (typeof segment !== 'string' || !segment.trim()) return true;
          return (
            sourceText !== undefined &&
            this.findSourceSegment(segment, sourceText) === null
          );
        })
      ) {
        return true;
      }

      return (
        (sourceText !== undefined &&
          this.hasAmbiguousDueTime(sourceText) &&
          this.hasConcreteDueTime(rawTasks)) ||
        this.isInvalidOptionalValue(task.dueDate, value =>
          this.sanitizeDueDate(value)
        ) ||
        this.isInvalidOptionalValue(task.dueTime, value =>
          this.sanitizeDueTime(value)
        ) ||
        this.isInvalidOptionalValue(task.priority, value =>
          this.sanitizePriority(value)
        ) ||
        this.isInvalidOptionalValue(task.timerType, value =>
          this.sanitizeTimerType(value)
        ) ||
        this.isInvalidOptionalValue(task.recurrenceRule, value =>
          this.sanitizeRecurrenceRule(value)
        ) ||
        (task.recurrenceInterval !== undefined &&
          task.recurrenceInterval !== null &&
          this.sanitizeRecurrenceInterval(task.recurrenceInterval) ===
            undefined) ||
        this.isInvalidOptionalValue(task.recurrenceAnchorMode, value =>
          this.sanitizeRecurrenceAnchor(value)
        )
      );
    });
  }

  hasInvalidSourceSegments(rawTasks: unknown[], sourceText: string) {
    return rawTasks.some(rawTask => {
      const sourceSegments = toRecord(rawTask).sourceSegments;
      return (
        !Array.isArray(sourceSegments) ||
        sourceSegments.length === 0 ||
        sourceSegments.some(
          segment =>
            typeof segment !== 'string' ||
            !segment.trim() ||
            this.findSourceSegment(segment, sourceText) === null
        )
      );
    });
  }

  hasAmbiguousSourceOwnership(rawTasks: unknown[], sourceText: string) {
    const ownershipTasks = this.expandIndependentListTasks(
      rawTasks,
      sourceText
    );
    const spans: SourceSpan[] = [];
    for (const [taskIndex, rawTask] of ownershipTasks.entries()) {
      const sourceSegments = toRecord(rawTask).sourceSegments;
      if (!Array.isArray(sourceSegments)) continue;

      for (const segment of sourceSegments) {
        if (typeof segment !== 'string' || !segment.trim()) continue;
        const matches = this.findSourceSegmentMatches(segment, sourceText);
        if (matches.length !== 1) return true;
        const [match] = matches;
        if (
          spans.some(
            span =>
              span.taskIndex === taskIndex &&
              span.start === match.start &&
              span.end === match.end
          )
        ) {
          continue;
        }
        spans.push({ taskIndex, start: match.start, end: match.end });
      }
    }

    return spans.some((span, index) =>
      spans
        .slice(index + 1)
        .some(
          other =>
            span.taskIndex !== other.taskIndex &&
            span.start < other.end &&
            other.start < span.end
        )
    );
  }

  hasUnassignedSourceUrls(rawTasks: unknown[], sourceText: string) {
    const sourceUrls = this.extractSourceUrls(sourceText);
    return sourceUrls.some(
      url =>
        !rawTasks.some(rawTask => {
          const value = toRecord(rawTask);
          return [
            value.title,
            value.description,
            ...(Array.isArray(value.sourceSegments)
              ? value.sourceSegments
              : []),
          ].some(
            candidate =>
              typeof candidate === 'string' && candidate.includes(url)
          );
        })
    );
  }

  private isInvalidOptionalValue(
    value: unknown,
    sanitize: (value: unknown) => unknown
  ) {
    return (
      normalizeOptionalString(value) !== null && sanitize(value) === undefined
    );
  }

  private applyRecurrenceDueDateInvariant(
    draft: ParsedTaskDraft,
    today: string
  ): ParsedTaskDraft {
    if (!draft.recurrenceRule || draft.dueDate) return draft;
    const [year, month, day] = today.split('-').map(Number);
    const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
    return {
      ...draft,
      dueDate: tomorrow.toISOString().slice(0, 10),
    };
  }

  private sanitizeRecurrenceRule(value: unknown): string | undefined {
    const recurrenceRule = normalizeOptionalString(value);
    if (!recurrenceRule) return undefined;

    const normalizedRule = recurrenceRule.toUpperCase().replace(/^RRULE:/, '');
    const parts = Object.fromEntries(
      normalizedRule.split(';').map(part => part.split('='))
    );
    const allowedParts = new Set([
      'FREQ',
      'INTERVAL',
      'COUNT',
      'UNTIL',
      'BYDAY',
      'BYMONTHDAY',
      'EXDATE',
    ]);
    const entries = normalizedRule.split(';').map(part => part.split('='));
    if (
      entries.some(
        ([key, entryValue, extra]) =>
          !key || !entryValue || extra !== undefined || !allowedParts.has(key)
      ) ||
      Object.keys(parts).length !== entries.length ||
      !['DAILY', 'WEEKLY', 'MONTHLY'].includes(parts.FREQ) ||
      !this.isPositiveInteger(parts.INTERVAL ?? '1') ||
      (parts.COUNT !== undefined && !this.isPositiveInteger(parts.COUNT)) ||
      (parts.UNTIL !== undefined && !this.isRecurrenceDate(parts.UNTIL)) ||
      (parts.EXDATE !== undefined &&
        !parts.EXDATE.split(',').every(date => this.isRecurrenceDate(date))) ||
      (parts.BYDAY !== undefined &&
        !parts.BYDAY.split(',').every(day =>
          ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].includes(day)
        )) ||
      (parts.BYMONTHDAY !== undefined &&
        !parts.BYMONTHDAY.split(',').every(day => {
          const monthDay = Number(day);
          return Number.isInteger(monthDay) && monthDay >= 1 && monthDay <= 31;
        }))
    ) {
      return undefined;
    }

    return recurrenceRule;
  }

  private sanitizeRecurrenceInterval(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const interval = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(interval) && interval >= 1 ? interval : undefined;
  }

  private isPositiveInteger(value: string): boolean {
    const number = Number(value);
    return Number.isInteger(number) && number >= 1;
  }

  private isRecurrenceDate(value: string): boolean {
    const datePart = value.split('T')[0];
    const normalizedDate =
      datePart.length === 8
        ? `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}`
        : datePart;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) return false;
    const [year, month, day] = normalizedDate.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }

  private cleanTaskTitle(
    draft: ParsedTaskDraft,
    intentions: AssistantCaptureIntention[],
    intentionMention: string | null,
    sourceText: string
  ) {
    let title = this.normalizeWhitespace(draft.title);
    const linkedSlugs = [draft.intentionSlug, draft.subIntentionSlug].filter(
      (slug): slug is string => Boolean(slug)
    );
    for (const slug of linkedSlugs) {
      const intention = intentions.find(candidate => candidate.slug === slug);
      if (!intention) continue;
      title = this.removeIntentionQualifier(title, intention.title);
      if (
        this.sourceContainsIntentionQualifier(sourceText, intention.title) ||
        this.sourceContainsImplicitIntentionContext(sourceText, intention.title)
      ) {
        title = title.replace(
          new RegExp(`\\b${this.escapeRegExp(intention.title)}\\b`, 'gi'),
          ' '
        );
      }
    }
    if (intentionMention) {
      title = this.removeIntentionQualifier(title, intentionMention);
      const bareIntentionMention = intentionMention.replace(
        /\s+intention$/i,
        ''
      );
      if (
        this.sourceContainsIntentionQualifier(sourceText, bareIntentionMention)
      ) {
        title = title.replace(
          new RegExp(`\\b${this.escapeRegExp(bareIntentionMention)}\\b`, 'gi'),
          ' '
        );
      }
    }
    if (draft.dueDate) {
      title = title
        .replace(
          new RegExp(
            `\\b(?:due|on|by)\\s+${this.escapeRegExp(draft.dueDate)}\\b`,
            'gi'
          ),
          ' '
        )
        .replace(/\b(?:due\s+)?(?:today|tomorrow|tonight)\b/gi, ' ')
        .replace(
          /\b(?:due|on|by)\s+(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
          ' '
        )
        .replace(
          /\b(?:due|on|by)\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi,
          ' '
        )
        .replace(
          /\b(?:due|on|by)\s+\d{1,4}[/-]\d{1,2}(?:[/-]\d{1,4})?\b/gi,
          ' '
        );
    }
    if (draft.dueTime) {
      title = title
        .replace(
          new RegExp(
            `\\b(?:at|by)\\s+${this.escapeRegExp(draft.dueTime)}\\b`,
            'gi'
          ),
          ' '
        )
        .replace(/\b(?:at|by)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, ' ');
    }
    if (
      draft.priority &&
      this.sourceHasPriorityQualifier(sourceText, draft.priority)
    ) {
      title = title.replace(
        new RegExp(
          `\\b(?:priority\\s+(?:is\\s+|to\\s+)?${draft.priority}|${draft.priority}\\s+(?:priority|task|item|request)|(?:make|mark|set|put|flag|label|treat)(?:\\s+(?:this|it))?(?:\\s+as)?(?:\\s+to)?\\s+${draft.priority})\\b|\\b${draft.priority}(?=\\s*[.!?]?$)`,
          'gi'
        ),
        ' '
      );
      title = title.replace(/\b(?:low|normal|high|urgent)\b/gi, ' ');
    }
    if (draft.recurrenceRule) {
      title = title
        .replace(new RegExp(this.escapeRegExp(draft.recurrenceRule), 'gi'), ' ')
        .replace(
          /\b(?:every\s+(?:day|week|month)|daily|weekly|monthly)\b/gi,
          ' '
        );
    }
    if (draft.timerType) {
      title = title.replace(
        /\b(?:work|break|long[- ]?break)\s+task\b|\btask\s+(?:for\s+)?(?:work|break|long[- ]?break)\b/gi,
        ' '
      );
    }
    title = this.removeSourceLinkDetails(title, sourceText);
    title = title.replace(/\s+(?:and|then|also|with|including|plus)\s*$/i, ' ');
    title = this.cleanTitlePunctuation(title);
    return this.splitLongTitle({ ...draft, title });
  }

  private removeIntentionQualifier(title: string, intentionName: string) {
    const name = this.escapeRegExp(intentionName);
    return title
      .replace(new RegExp(`\\bfor\\s+${name}\\s+intention\\b`, 'gi'), ' ')
      .replace(new RegExp(`\\b${name}\\s+intention\\b`, 'gi'), ' ')
      .replace(new RegExp(`\\bintention\\s+${name}\\b`, 'gi'), ' ')
      .replace(new RegExp(`\\b(?:for|under)\\s+${name}\\b`, 'gi'), ' ');
  }

  private findIntentionSourceFragment(
    sourceText: string,
    intentionName: string
  ) {
    const match = sourceText.match(
      new RegExp(
        `(?:for|under)\\s+${this.escapeRegExp(intentionName)}\\s+intention|intention\\s+${this.escapeRegExp(intentionName)}|${this.escapeRegExp(intentionName)}\\s+intention`,
        'i'
      )
    );
    return match?.[0] ?? intentionName;
  }

  private sourceContainsIntentionQualifier(
    sourceText: string,
    intentionName: string
  ) {
    const name = this.escapeRegExp(intentionName);
    return new RegExp(
      `(?:\\b(?:for|under|within|in)\\s+${name}(?:\\s+intention)?\\b|\\bintention\\s+${name}\\b|\\b${name}\\s+intention\\b)`,
      'i'
    ).test(sourceText);
  }

  private sourceContainsImplicitIntentionContext(
    sourceText: string,
    intentionName: string
  ) {
    const name = this.escapeRegExp(intentionName);
    return new RegExp(
      `\\b(?:some|the|my|our|a|an|these|those)\\s+${name}\\b|\\b${name}\\s+(?:list|items?|things?)\\b`,
      'i'
    ).test(sourceText);
  }

  private splitLongTitle(draft: ParsedTaskDraft) {
    const words = draft.title.split(/\s+/).filter(Boolean);
    const naturalSplitIndex = words.findIndex(
      (word, index) =>
        index + 1 >= MIN_NATURAL_TITLE_SPLIT_WORDS &&
        index + 1 <= TARGET_TITLE_WORDS &&
        (/[,;:]$/.test(word) ||
          (index + 1 < words.length &&
            /^(?:then|while|before|after)$/i.test(words[index + 1])))
    );
    const splitAt =
      naturalSplitIndex >= 0
        ? naturalSplitIndex + 1
        : words.length > MAX_TITLE_WORDS
          ? MAX_TITLE_WORDS
          : null;
    if (splitAt === null) {
      return {
        ...draft,
        title: draft.title || draft.sourceTranscript || '',
      };
    }
    const kept = this.cleanTitlePunctuation(words.slice(0, splitAt).join(' '));
    const overflow = words.slice(splitAt).join(' ');
    return {
      ...draft,
      title: kept,
      description: this.appendDescription(draft.description, overflow),
    };
  }

  private sanitizePriority(value: unknown) {
    const priority = normalizeOptionalString(value)?.toLowerCase();
    return priority === TASK_PRIORITIES.LOW ||
      priority === TASK_PRIORITIES.NORMAL ||
      priority === TASK_PRIORITIES.HIGH ||
      priority === TASK_PRIORITIES.URGENT
      ? priority
      : undefined;
  }

  private sanitizeTimerType(value: unknown) {
    return value === TIMER_TYPES.WORK ||
      value === TIMER_TYPES.BREAK ||
      value === TIMER_TYPES.LONG_BREAK
      ? value
      : undefined;
  }

  private resolveTimerType(
    draft: Pick<
      ParsedTaskDraft,
      'intentionSlug' | 'subIntentionSlug' | 'timerType'
    >,
    sourceText: string,
    intentions: AssistantCaptureIntention[]
  ) {
    const linkedSlug = draft.subIntentionSlug ?? draft.intentionSlug;
    const linkedIntention = linkedSlug
      ? intentions.find(intention => intention.slug === linkedSlug)
      : undefined;
    if (linkedIntention) return linkedIntention.type;

    if (draft.timerType) return draft.timerType;

    if (
      /\b(?:long[- ]?break|break)\s+(?:task|item|request)\b/i.test(sourceText)
    ) {
      return /\blong[- ]?break\b/i.test(sourceText)
        ? TIMER_TYPES.LONG_BREAK
        : TIMER_TYPES.BREAK;
    }
    return TIMER_TYPES.WORK;
  }

  private sanitizeRecurrenceAnchor(value: unknown) {
    return value === 'planned' || value === 'completion' ? value : undefined;
  }

  private sanitizeDueDate(value: unknown) {
    const text = normalizeOptionalString(value);
    return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
  }

  private sanitizeDueTime(value: unknown) {
    const text = normalizeOptionalString(value);
    return text && /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : undefined;
  }

  private resolveDueTime(
    modelDueTime: string | undefined,
    sourceText: string,
    resolutionNotes: string[]
  ) {
    const explicitTime = this.extractExplicitDueTime(sourceText);
    if (explicitTime) {
      return explicitTime;
    }

    if (this.hasAmbiguousDueTime(sourceText)) {
      resolutionNotes.push(
        'Due time is ambiguous; review the requested time before saving.'
      );
      return undefined;
    }

    const daypart = DAYPART_DUE_TIMES.find(({ pattern }) =>
      pattern.test(sourceText)
    );
    if (daypart) {
      return modelDueTime ?? daypart.time;
    }

    // A date-only request must not receive a model-invented wall-clock time.
    return undefined;
  }

  private extractExplicitDueTime(sourceText: string) {
    const matches = Array.from(
      sourceText.matchAll(
        /\b(?:(at|by)\s+)?((?:[01]?\d|2[0-3]):[0-5]\d|(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*(?:am|pm)|noon|midnight)\b/gi
      )
    );
    const duePhraseMatch =
      matches.find(match => match[1]?.toLowerCase() === 'by') ??
      matches.find(match => match[1]);
    if (duePhraseMatch) {
      return this.normalizeExplicitDueTime(duePhraseMatch[2] ?? '');
    }

    const standaloneMatch = matches.find(match => {
      const timeText = match[2]?.replace(/\s+/g, '').toLowerCase() ?? '';
      const isStandaloneTime =
        /^\d{1,2}:[0-5]\d$/.test(timeText) ||
        /^(?:noon|midnight)$/.test(timeText);
      return (
        !match[1] &&
        isStandaloneTime &&
        !this.isIncidentalClockReference(
          sourceText,
          match.index ?? 0,
          match[0].length
        )
      );
    });
    return standaloneMatch
      ? this.normalizeExplicitDueTime(standaloneMatch[2] ?? '')
      : undefined;
  }

  private normalizeExplicitDueTime(value: string) {
    const timeText = value.replace(/\s+/g, '').toLowerCase();
    if (timeText === 'noon') return '12:00';
    if (timeText === 'midnight') return '00:00';

    const meridiemParts = timeText.match(/^(\d{1,2})(?::([0-5]\d))?(am|pm)$/i);
    if (meridiemParts) {
      const hour = Number(meridiemParts[1]);
      if (hour < 1 || hour > 12) return undefined;
      const normalizedHour =
        (hour % 12) + (meridiemParts[3].toLowerCase() === 'pm' ? 12 : 0);
      return `${String(normalizedHour).padStart(2, '0')}:${meridiemParts[2] ?? '00'}`;
    }

    const twentyFourHourParts = timeText.match(/^(\d{1,2}):([0-5]\d)$/);
    if (!twentyFourHourParts) return undefined;
    const hour = Number(twentyFourHourParts[1]);
    if (hour > 23) return undefined;
    return `${String(hour).padStart(2, '0')}:${twentyFourHourParts[2]}`;
  }

  private isIncidentalClockReference(
    sourceText: string,
    matchIndex: number,
    matchLength: number
  ) {
    return /^\s+(?:meeting|call|appointment|event|session|class|flight|train)\b/i.test(
      sourceText.slice(matchIndex + matchLength)
    );
  }

  private hasConcreteDueTime(rawTasks: unknown[]) {
    return rawTasks.some(rawTask => {
      const dueTime = this.sanitizeDueTime(toRecord(rawTask).dueTime);
      return dueTime !== undefined;
    });
  }

  private hasAmbiguousDueTime(sourceText: string) {
    if (!AMBIGUOUS_DUE_TIME_PATTERN.test(sourceText)) return false;
    return (
      !this.extractExplicitDueTime(sourceText) &&
      !DAYPART_DUE_TIMES.some(({ pattern }) => pattern.test(sourceText))
    );
  }

  private normalizeWhitespace(value: string) {
    return value.replace(/\s+/g, ' ').trim();
  }

  private cleanTitlePunctuation(value: string) {
    return this.normalizeWhitespace(value)
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/^[,.;:\-\s]+|[,.;:\-\s]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  private appendDescription(
    current: string | null | undefined,
    detail: string
  ) {
    return [normalizeOptionalString(current), normalizeOptionalString(detail)]
      .filter(Boolean)
      .join('\n\n');
  }

  private appendSourceUrls(
    current: string | null | undefined,
    sourceUrls: string[]
  ) {
    let description = normalizeOptionalString(current);
    for (const detail of sourceUrls) {
      const normalizedDetail = normalizeOptionalString(detail);
      if (!normalizedDetail) continue;
      if (description && description.includes(normalizedDetail)) continue;
      description = this.appendDescription(description, normalizedDetail);
    }
    return description;
  }

  private normalizeModelDescription(
    description: string | null,
    sourceSegments: string[],
    sourceText: string
  ) {
    if (!description) return null;
    const candidates = [sourceText, ...sourceSegments]
      .map(candidate => this.normalizeWhitespace(candidate))
      .filter(Boolean)
      .filter(
        candidate => candidate.length <= MAX_DESCRIPTION_SOURCE_MATCH_CHARS
      )
      .sort((a, b) => b.length - a.length)
      .filter((candidate, index, all) => all.indexOf(candidate) === index);
    let cleaned = description;
    for (const candidate of candidates) {
      const pattern = candidate
        .split(/\s+/)
        .map(token => this.escapeRegExp(token))
        .join('\\s+');
      cleaned = cleaned.replace(new RegExp(pattern, 'gi'), ' ');
    }
    cleaned = cleaned
      .replace(
        /^\s*(?:transcript|source(?:\s+text)?|original\s+request)\s*[:-]\s*/i,
        ''
      )
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (
      !cleaned ||
      /^(?:transcript|source(?:\s+text)?|original\s+request)[:-]?$/i.test(
        cleaned
      )
    ) {
      return null;
    }
    return cleaned;
  }

  private normalizeTranscriptSettings(
    settings?: AssistantTaskTranscriptSettings
  ): AssistantTaskTranscriptSettings {
    const minWords = Number(settings?.minWords);
    return {
      enabled: settings?.enabled === true,
      minWords:
        Number.isInteger(minWords) && minWords >= 1
          ? minWords
          : DEFAULT_TRANSCRIPT_MIN_WORDS,
    };
  }

  private buildSourceTranscript(
    sourceSegments: string[],
    settings: AssistantTaskTranscriptSettings,
    semanticText = sourceSegments.join(' ')
  ) {
    if (!settings.enabled || sourceSegments.length === 0) return null;
    const transcript = sourceSegments.join('\n\n').trim();
    return this.countWords(semanticText) > settings.minWords
      ? transcript
      : null;
  }

  private readEssentialDetails(value: unknown, sourceText: string) {
    if (!Array.isArray(value)) return [];
    const details: string[] = [];
    for (const candidate of value) {
      if (typeof candidate !== 'string') continue;
      const match = this.findSourceSegmentWithIndex(candidate, sourceText);
      if (!match || this.isMetadataOnlyDetail(match.text)) continue;
      if (!details.includes(match.text)) details.push(match.text);
    }
    return details;
  }

  private appendMissingEssentialDetails(
    current: string | null | undefined,
    details: string[],
    title: string
  ) {
    let description = normalizeOptionalString(current);
    let represented = this.normalizeMatchText(`${title} ${description ?? ''}`);
    for (const detail of details) {
      const normalized = this.normalizeMatchText(detail);
      if (!normalized || represented.includes(normalized)) continue;
      description = this.appendDescription(description, detail);
      represented = this.normalizeMatchText(`${title} ${description ?? ''}`);
    }
    return description;
  }

  /**
   * Count only the user outcome wording for transcript eligibility. The value
   * returned to the Task remains the untouched source transcript.
   */
  private buildTranscriptSemanticText(
    sourceSegments: string[],
    draft: Pick<
      ParsedTaskDraft,
      | 'intentionSlug'
      | 'subIntentionSlug'
      | 'dueDate'
      | 'dueTime'
      | 'priority'
      | 'recurrenceRule'
      | 'timerType'
    >,
    intentions: AssistantCaptureIntention[],
    intentionMention: string | null
  ) {
    const linkedNames = [draft.intentionSlug, draft.subIntentionSlug]
      .map(slug => intentions.find(intention => intention.slug === slug)?.title)
      .filter((name): name is string => Boolean(name));
    const names = [...linkedNames, intentionMention].filter(
      (name): name is string => Boolean(name)
    );
    return sourceSegments
      .map(segment => {
        let semantic = segment;
        for (const name of names) {
          const escaped = this.escapeRegExp(name);
          semantic = semantic
            .replace(
              new RegExp(
                `\\b(?:for|under|within|in|to)\\s+${escaped}(?:\\s+intention)?\\b|\\bintention\\s+${escaped}\\b|\\b${escaped}\\s+intention\\b`,
                'gi'
              ),
              ' '
            )
            .replace(new RegExp(`\\b${escaped}\\b`, 'gi'), ' ');
        }
        semantic = semantic
          .replace(/https?:\/\/\S+/gi, ' ')
          .replace(/\b(?:today|tomorrow|tonight)\b/gi, ' ')
          .replace(
            /\b(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
            ' '
          )
          .replace(
            /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi,
            ' '
          )
          .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
          .replace(/\b(?:at|by)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, ' ')
          .replace(
            /\bstarting\s+(?:today|tomorrow|tonight|next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
            ' '
          )
          .replace(/\bstarting\s+(?:today|tomorrow|tonight)\b/gi, ' ')
          .replace(
            /\b(?:every|each)\s+(?:other\s+)?\d*\s*(?:day|days|week|weeks|month|months)\b/gi,
            ' '
          )
          .replace(/\b(?:daily|weekly|monthly)\b/gi, ' ')
          .replace(
            /\b(?:low|normal|high|urgent)\s+priority\b|\bpriority\s+(?:is\s+|to\s+)?(?:low|normal|high|urgent)\b|\b(?:make|mark|set|put|flag|label|treat)(?:\s+(?:this|it))?(?:\s+as)?\s+(?:low|normal|high|urgent)\b/gi,
            ' '
          )
          .replace(
            /\b(?:as\s+)?(?:a\s+)?(?:long[- ]?break|break|work)\s+(?:task|item|request)\b/gi,
            ' '
          )
          .replace(
            /^(?:please\s+)?(?:create|add|make)\s+(?:a\s+)?task(?:\s+to)?\s+/i,
            ' '
          )
          .replace(/\s+/g, ' ')
          .trim();
        if (draft.priority) {
          semantic = semantic.replace(
            new RegExp(`\\b${this.escapeRegExp(draft.priority)}\\b`, 'gi'),
            ' '
          );
        }
        return semantic;
      })
      .filter(Boolean)
      .join(' ');
  }

  private isMetadataOnlyDetail(value: string) {
    return /^(?:low|normal|high|urgent|today|tomorrow|tonight|daily|weekly|monthly|(?:long[- ]?break|break|work)\s+task|.+\s+intention)$/i.test(
      this.normalizeWhitespace(value)
    );
  }

  private normalizeMatchText(value: string) {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private removeSourceLinkDetails(title: string, sourceText: string) {
    const hadUrl = /https?:\/\/\S+/i.test(title);
    const sourceHasUrl = /https?:\/\/\S+/i.test(sourceText);
    let cleaned = title.replace(/https?:\/\/\S+/gi, ' ');
    if (!hadUrl && !sourceHasUrl) return cleaned;

    cleaned = cleaned
      .replace(
        /\b(?:paste|add|include|insert|put|attach)\s+(?:the\s+)?(?:link|url)?\s*(?:in|into|to)?\s*(?:the\s+)?description\b/gi,
        ' '
      )
      .replace(/\s*[,.!?]\s*(?:paste|add|include|insert|put|attach)\s*$/i, ' ')
      .replace(/\b(?:paste|add|include|insert|put|attach)\s*$/i, ' ')
      .replace(/\s+(?:and|then|also|with|including|plus)\s*$/i, ' ');
    return cleaned;
  }

  private extractSourceUrls(sourceText: string) {
    return [...sourceText.matchAll(/https?:\/\/[^\s<>"']+/gi)]
      .map(match => match[0].replace(/[),.;:!?]+$/g, ''))
      .filter(Boolean);
  }

  private sourceUrlsForTask(
    input: unknown,
    sourceUrls: string[],
    includeAll: boolean
  ) {
    if (includeAll) return sourceUrls;
    const value = toRecord(input);
    const sourceCandidates = [
      value.title,
      value.description,
      ...(Array.isArray(value.sourceSegments) ? value.sourceSegments : []),
    ]
      .filter((candidate): candidate is string => typeof candidate === 'string')
      .join(' ');
    return sourceUrls.filter(url => sourceCandidates.includes(url));
  }

  private readSourceSegments(value: unknown, sourceText: string) {
    if (!Array.isArray(value)) return [];
    const segments: Array<{ text: string; index: number }> = [];
    for (const candidate of value.slice(0, MAX_SOURCE_SEGMENTS_PER_TASK)) {
      if (typeof candidate !== 'string') continue;
      const match = this.findSourceSegmentWithIndex(candidate, sourceText);
      if (match && !segments.some(segment => segment.text === match.text)) {
        segments.push(match);
      }
    }
    return segments
      .sort((a, b) => a.index - b.index)
      .map(segment => segment.text);
  }

  private findSourceSegment(candidate: string, sourceText: string) {
    return this.findSourceSegmentWithIndex(candidate, sourceText)?.text ?? null;
  }

  private findSourceSegmentMatches(
    candidate: string,
    sourceText: string
  ): Array<{ text: string; index: number; start: number; end: number }> {
    const normalizedCandidate = candidate.trim();
    if (!normalizedCandidate) return [];

    const matches: Array<{
      text: string;
      index: number;
      start: number;
      end: number;
    }> = [];
    let directIndex = sourceText.indexOf(normalizedCandidate);
    while (directIndex >= 0) {
      const end = directIndex + normalizedCandidate.length;
      if (this.isStandaloneSourceMatch(sourceText, directIndex, end)) {
        matches.push({
          text: sourceText.slice(directIndex, end),
          index: directIndex,
          start: directIndex,
          end,
        });
      }
      directIndex = sourceText.indexOf(
        normalizedCandidate,
        directIndex + normalizedCandidate.length
      );
    }

    const tokens = normalizedCandidate
      .split(/\s+/)
      .map(token => this.escapeRegExp(token))
      .join('\\s+');
    for (const match of sourceText.matchAll(new RegExp(tokens, 'gi'))) {
      if (match.index === undefined || !match[0]) continue;
      const end = match.index + match[0].length;
      if (!this.isStandaloneSourceMatch(sourceText, match.index, end)) {
        continue;
      }
      if (
        !matches.some(item => item.index === match.index && item.end === end)
      ) {
        matches.push({
          text: match[0],
          index: match.index,
          start: match.index,
          end,
        });
      }
    }

    return matches.sort((left, right) => left.index - right.index);
  }

  private isStandaloneSourceMatch(
    sourceText: string,
    start: number,
    end: number
  ) {
    const isWordCharacter = (value: string | undefined) =>
      value !== undefined && /[\p{L}\p{N}]/u.test(value);
    return (
      !isWordCharacter(sourceText[start - 1]) &&
      !isWordCharacter(sourceText[end])
    );
  }

  private findSourceSegmentWithIndex(
    candidate: string,
    sourceText: string
  ): { text: string; index: number } | null {
    const [match] = this.findSourceSegmentMatches(candidate, sourceText);
    return match ? { text: match.text, index: match.index } : null;
  }

  private sourceHasPriorityQualifier(sourceText: string, priority: string) {
    return this.extractSourcePriority(sourceText) === priority;
  }

  private resolvePriority(value: unknown, sourceText: string) {
    return (
      this.extractSourcePriority(sourceText) ?? this.sanitizePriority(value)
    );
  }

  private extractSourcePriority(sourceText: string) {
    const match = sourceText.match(
      /^\s*(?:please\s+)?(low|normal|high|urgent)(?=\s*[:,-])|\bpriority\s+(?:is\s+|to\s+)?(low|normal|high|urgent)\b|\b(low|normal|high|urgent)\s+priority\b|\b(?:make|mark|set|put|flag|label|treat)(?:\s+(?:this|it))?(?:\s+as)?(?:\s+a)?(?:\s+to)?\s+(low|normal|high|urgent)\b|\b(low|normal|high|urgent)\s+(?:task|item|request)\b|\b(low|normal|high|urgent)(?=\s*[.!?]?$)/i
    );
    const value = match?.slice(1).find(Boolean);
    return value ? this.sanitizePriority(value) : undefined;
  }

  private countWords(value: string) {
    return value.trim().split(/\s+/).filter(Boolean).length;
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
