import { normalizeAppLanguage } from '@pomi/shared';
import type { AppLanguage } from '@pomi/shared';

type AssistantLanguage = AppLanguage;

export const ASSISTANT_KEYS = [
  'tasksOff',
  'noSpeechDetected',
  'noSafeAction',
  'taskCreatedFallback',
  'fallbackTaskTitle',
  'assistantTextRequired',
  'voiceInputRequired',
  'voiceChunkManifestMismatch',
  'assistantTranscriptionModelRequired',
  'listMetadataUnsupported',
  'listDestinationAmbiguous',
  'listDestinationUnavailable',
  'listQuickAddSingleItem',
  'assistantResponseInvalid',
  'assistantTasksLimitExceeded',
  'assistantSourceEvidenceInvalid',
  'feedbackTranscriptionNotConfigured',
  'assistantTextModelNotConfigured',
  'aiTaskCaptureNotConfigured',
  'speechCaptureNotConfigured',
  'assistantNotConfigured',
  'tasksDisabled',
  'assistantDisabled',
  'aiUsageBudgetReached',
  'assistantSettingsUnavailable',
  'taskCreated',
  'tasksCreated',
  'taskReadbackDetails',
  'listItemAdded',
  'listItemsAdded',
  'timerStarted',
  'breakTimerStarted',
  'longBreakStarted',
  'timerPaused',
  'noTimerToPause',
  'fiveMinutesAdded',
  'noTimerToExtend',
  'timerCouldNotStart',
  'chooseIntention',
] as const;

type AssistantKey = (typeof ASSISTANT_KEYS)[number];

type AssistantTemplate =
  string | ((values: Record<string, string | number>) => string);

type TaskReadbackLabels = {
  dueDate: string;
  dueTime: string;
  recurrence: string;
  priorityPrefix: string;
  prioritySuffix: string;
  timerPrefix: string;
  timerSuffix: string;
  intention: string;
  subIntention: string;
  every: string;
  from: string;
  frequencies: Record<string, string>;
  units: Record<string, string>;
  anchors: Record<string, string>;
  priorities: Record<string, string>;
  timers: Record<string, string>;
  separator: string;
};

function readbackValue(value: unknown) {
  return value === undefined || value === null || value === ''
    ? ''
    : String(value);
}

function joinReadbackParts(...parts: string[]) {
  return parts.filter(Boolean).join(' ');
}

function formatTaskReadbackDetails(
  values: Record<string, string | number>,
  labels: TaskReadbackLabels
) {
  const details: string[] = [];
  const dueDate = readbackValue(values.dueDate);
  if (dueDate) details.push(joinReadbackParts(labels.dueDate, dueDate));

  const dueTime = readbackValue(values.dueTime);
  if (dueTime) details.push(joinReadbackParts(labels.dueTime, dueTime));

  const recurrenceFrequency = readbackValue(values.recurrenceFrequency);
  if (recurrenceFrequency) {
    const recurrenceInterval = Number(readbackValue(values.recurrenceInterval));
    const recurrenceValue =
      Number.isInteger(recurrenceInterval) && recurrenceInterval > 1
        ? joinReadbackParts(
            labels.every,
            String(recurrenceInterval),
            labels.units[recurrenceFrequency] ?? recurrenceFrequency
          )
        : (labels.frequencies[recurrenceFrequency] ?? recurrenceFrequency);
    const recurrenceAnchor =
      labels.anchors[readbackValue(values.recurrenceAnchor)] ?? '';
    details.push(
      joinReadbackParts(
        labels.recurrence,
        recurrenceValue,
        recurrenceAnchor ? joinReadbackParts(labels.from, recurrenceAnchor) : ''
      )
    );
  }

  const priority = readbackValue(values.priority);
  if (priority) {
    details.push(
      joinReadbackParts(
        labels.priorityPrefix,
        labels.priorities[priority] ?? priority,
        labels.prioritySuffix
      )
    );
  }

  const timerType = readbackValue(values.timerType);
  if (timerType) {
    details.push(
      joinReadbackParts(
        labels.timerPrefix,
        labels.timers[timerType] ?? timerType,
        labels.timerSuffix
      )
    );
  }

  const intention = readbackValue(values.intention);
  if (intention) details.push(joinReadbackParts(labels.intention, intention));

  const subIntention = readbackValue(values.subIntention);
  if (subIntention) {
    details.push(joinReadbackParts(labels.subIntention, subIntention));
  }

  return details.join(labels.separator);
}

const TASK_READBACK_LABELS: Record<AssistantLanguage, TaskReadbackLabels> = {
  en: {
    dueDate: 'due',
    dueTime: 'at',
    recurrence: 'repeats',
    priorityPrefix: '',
    prioritySuffix: 'priority',
    timerPrefix: '',
    timerSuffix: 'timer',
    intention: 'intention',
    subIntention: 'sub-intention',
    every: 'every',
    from: 'from',
    frequencies: { daily: 'daily', weekly: 'weekly', monthly: 'monthly' },
    units: { daily: 'days', weekly: 'weeks', monthly: 'months' },
    anchors: { planned: 'planned date', completion: 'completion' },
    priorities: {
      low: 'low',
      normal: 'normal',
      high: 'high',
      urgent: 'urgent',
    },
    timers: { work: 'work', break: 'break', longBreak: 'long break' },
    separator: ', ',
  },
  'zh-Hans': {
    dueDate: '截止',
    dueTime: '时间',
    recurrence: '重复',
    priorityPrefix: '',
    prioritySuffix: '优先级',
    timerPrefix: '',
    timerSuffix: '计时器',
    intention: '目标',
    subIntention: '子目标',
    every: '每',
    from: '从',
    frequencies: { daily: '每天', weekly: '每周', monthly: '每月' },
    units: { daily: '天', weekly: '周', monthly: '月' },
    anchors: { planned: '计划日期', completion: '完成' },
    priorities: { low: '低', normal: '普通', high: '高', urgent: '紧急' },
    timers: { work: '工作', break: '休息', longBreak: '长休息' },
    separator: '，',
  },
  hi: {
    dueDate: 'नियत',
    dueTime: 'समय',
    recurrence: 'दोहराव',
    priorityPrefix: 'प्राथमिकता',
    prioritySuffix: '',
    timerPrefix: '',
    timerSuffix: 'टाइमर',
    intention: 'इंटेंशन',
    subIntention: 'उप-इंटेंशन',
    every: 'हर',
    from: 'से',
    frequencies: { daily: 'दैनिक', weekly: 'साप्ताहिक', monthly: 'मासिक' },
    units: { daily: 'दिन', weekly: 'हफ्ते', monthly: 'महीने' },
    anchors: { planned: 'निर्धारित तारीख', completion: 'पूरा होने' },
    priorities: {
      low: 'कम',
      normal: 'सामान्य',
      high: 'उच्च',
      urgent: 'अत्यावश्यक',
    },
    timers: { work: 'काम', break: 'ब्रेक', longBreak: 'लंबा ब्रेक' },
    separator: ', ',
  },
  es: {
    dueDate: 'vence',
    dueTime: 'a las',
    recurrence: 'repite',
    priorityPrefix: 'prioridad',
    prioritySuffix: '',
    timerPrefix: 'temporizador de',
    timerSuffix: '',
    intention: 'intención',
    subIntention: 'subintención',
    every: 'cada',
    from: 'desde',
    frequencies: { daily: 'diario', weekly: 'semanal', monthly: 'mensual' },
    units: { daily: 'días', weekly: 'semanas', monthly: 'meses' },
    anchors: { planned: 'fecha planificada', completion: 'finalización' },
    priorities: {
      low: 'baja',
      normal: 'normal',
      high: 'alta',
      urgent: 'urgente',
    },
    timers: { work: 'trabajo', break: 'descanso', longBreak: 'descanso largo' },
    separator: ', ',
  },
  ar: {
    dueDate: 'الاستحقاق',
    dueTime: 'الساعة',
    recurrence: 'يتكرر',
    priorityPrefix: 'أولوية',
    prioritySuffix: '',
    timerPrefix: 'مؤقت',
    timerSuffix: '',
    intention: 'النية',
    subIntention: 'النية الفرعية',
    every: 'كل',
    from: 'من',
    frequencies: { daily: 'يوميًا', weekly: 'أسبوعيًا', monthly: 'شهريًا' },
    units: { daily: 'أيام', weekly: 'أسابيع', monthly: 'أشهر' },
    anchors: { planned: 'التاريخ المخطط', completion: 'الإكمال' },
    priorities: {
      low: 'منخفضة',
      normal: 'عادية',
      high: 'عالية',
      urgent: 'عاجلة',
    },
    timers: { work: 'عمل', break: 'استراحة', longBreak: 'استراحة طويلة' },
    separator: '، ',
  },
  fr: {
    dueDate: 'pour',
    dueTime: 'à',
    recurrence: 'répète',
    priorityPrefix: 'priorité',
    prioritySuffix: '',
    timerPrefix: 'minuteur de',
    timerSuffix: '',
    intention: 'intention',
    subIntention: 'sous-intention',
    every: 'tous les',
    from: 'à partir de',
    frequencies: {
      daily: 'quotidien',
      weekly: 'hebdomadaire',
      monthly: 'mensuel',
    },
    units: { daily: 'jours', weekly: 'semaines', monthly: 'mois' },
    anchors: { planned: 'date planifiée', completion: 'achèvement' },
    priorities: {
      low: 'faible',
      normal: 'normale',
      high: 'haute',
      urgent: 'urgente',
    },
    timers: { work: 'travail', break: 'pause', longBreak: 'longue pause' },
    separator: ', ',
  },
  bn: {
    dueDate: 'শেষ তারিখ',
    dueTime: 'সময়',
    recurrence: 'পুনরাবৃত্তি',
    priorityPrefix: 'অগ্রাধিকার',
    prioritySuffix: '',
    timerPrefix: '',
    timerSuffix: 'টাইমার',
    intention: 'ইচ্ছা',
    subIntention: 'উপ-ইচ্ছা',
    every: 'প্রতি',
    from: 'থেকে',
    frequencies: { daily: 'দৈনিক', weekly: 'সাপ্তাহিক', monthly: 'মাসিক' },
    units: { daily: 'দিন', weekly: 'সপ্তাহ', monthly: 'মাস' },
    anchors: { planned: 'পরিকল্পিত তারিখ', completion: 'সম্পন্ন হওয়া' },
    priorities: {
      low: 'কম',
      normal: 'স্বাভাবিক',
      high: 'উচ্চ',
      urgent: 'জরুরি',
    },
    timers: { work: 'কাজ', break: 'বিরতি', longBreak: 'দীর্ঘ বিরতি' },
    separator: ', ',
  },
  'pt-BR': {
    dueDate: 'para',
    dueTime: 'às',
    recurrence: 'repete',
    priorityPrefix: 'prioridade',
    prioritySuffix: '',
    timerPrefix: 'temporizador de',
    timerSuffix: '',
    intention: 'intenção',
    subIntention: 'subintenção',
    every: 'a cada',
    from: 'a partir de',
    frequencies: { daily: 'diário', weekly: 'semanal', monthly: 'mensal' },
    units: { daily: 'dias', weekly: 'semanas', monthly: 'meses' },
    anchors: { planned: 'data planejada', completion: 'conclusão' },
    priorities: {
      low: 'baixa',
      normal: 'normal',
      high: 'alta',
      urgent: 'urgente',
    },
    timers: { work: 'trabalho', break: 'pausa', longBreak: 'pausa longa' },
    separator: ', ',
  },
  id: {
    dueDate: 'jatuh tempo',
    dueTime: 'pukul',
    recurrence: 'berulang',
    priorityPrefix: 'prioritas',
    prioritySuffix: '',
    timerPrefix: 'timer',
    timerSuffix: '',
    intention: 'niat',
    subIntention: 'subniat',
    every: 'setiap',
    from: 'dari',
    frequencies: { daily: 'harian', weekly: 'mingguan', monthly: 'bulanan' },
    units: { daily: 'hari', weekly: 'minggu', monthly: 'bulan' },
    anchors: { planned: 'tanggal terencana', completion: 'penyelesaian' },
    priorities: {
      low: 'rendah',
      normal: 'normal',
      high: 'tinggi',
      urgent: 'mendesak',
    },
    timers: {
      work: 'kerja',
      break: 'istirahat',
      longBreak: 'istirahat panjang',
    },
    separator: ', ',
  },
  ur: {
    dueDate: 'مقرر',
    dueTime: 'بجے',
    recurrence: 'دہرائی',
    priorityPrefix: 'ترجیح',
    prioritySuffix: '',
    timerPrefix: 'ٹائمر',
    timerSuffix: '',
    intention: 'نیت',
    subIntention: 'ذیلی نیت',
    every: 'ہر',
    from: 'سے',
    frequencies: { daily: 'روزانہ', weekly: 'ہفتہ وار', monthly: 'ماہانہ' },
    units: { daily: 'دن', weekly: 'ہفتے', monthly: 'مہینے' },
    anchors: { planned: 'منصوبہ بند تاریخ', completion: 'تکمیل' },
    priorities: { low: 'کم', normal: 'معمول', high: 'زیادہ', urgent: 'فوری' },
    timers: { work: 'کام', break: 'وقفہ', longBreak: 'طویل وقفہ' },
    separator: '، ',
  },
};

const ENGLISH: Record<AssistantKey, AssistantTemplate> = {
  tasksOff: 'Tasks are off.',
  noSpeechDetected: 'No speech detected.',
  noSafeAction: 'No safe action found.',
  taskCreatedFallback: 'Task created. Smart parsing failed.',
  fallbackTaskTitle: 'Review captured task request',
  assistantTextRequired: 'Assistant text is required',
  voiceInputRequired: 'Voice audio or transcript is required',
  voiceChunkManifestMismatch:
    'Voice chunk does not match its preparation manifest',
  assistantTranscriptionModelRequired:
    'Assistant transcription model is required',
  listMetadataUnsupported:
    'List items support title, due date, priority, and Vacation Coverage only',
  listDestinationAmbiguous: 'Choose one List destination before saving',
  listDestinationUnavailable:
    'That List is unavailable. Choose an existing List before saving',
  listQuickAddSingleItem: 'Add one List item at a time',
  assistantResponseInvalid: 'Assistant response was not JSON',
  assistantTasksLimitExceeded: values =>
    `Assistant returned more than ${values.count} Tasks`,
  assistantSourceEvidenceInvalid: 'Assistant source evidence was invalid',
  feedbackTranscriptionNotConfigured:
    'Feedback transcription is not configured',
  assistantTextModelNotConfigured: 'Assistant text model is not configured',
  aiTaskCaptureNotConfigured: 'AI Task capture is not configured',
  speechCaptureNotConfigured: 'Speech capture is not configured',
  assistantNotConfigured: 'Assistant is not configured',
  tasksDisabled: 'Tasks are disabled',
  assistantDisabled: 'Assistant is disabled',
  aiUsageBudgetReached: 'AI usage budget reached',
  assistantSettingsUnavailable: 'Assistant settings are unavailable',
  taskCreated: values => `Task created: ${values.title}`,
  tasksCreated: values => `${values.count} Tasks created.`,
  taskReadbackDetails: values =>
    formatTaskReadbackDetails(values, TASK_READBACK_LABELS.en),
  listItemAdded: values => `List item added: ${values.title}`,
  listItemsAdded: values => `Added ${values.count} items to the List.`,
  timerStarted: 'Timer started.',
  breakTimerStarted: 'Break timer started.',
  longBreakStarted: 'Long break started.',
  timerPaused: 'Timer paused.',
  noTimerToPause: 'No timer to pause.',
  fiveMinutesAdded: 'Added 5 minutes.',
  noTimerToExtend: 'No timer to extend.',
  timerCouldNotStart: 'Timer could not start.',
  chooseIntention:
    'Choose an intention and required sub-intention before starting a work timer.',
};

export const ASSISTANT_TRANSLATIONS = {
  en: ENGLISH,
  'zh-Hans': {
    tasksOff: '任务功能已关闭。',
    noSpeechDetected: '未检测到语音。',
    noSafeAction: '未找到安全操作。',
    taskCreatedFallback: '任务已创建。智能解析失败。',
    fallbackTaskTitle: '查看捕获的任务请求',
    assistantTextRequired: '需要提供助手文本。',
    voiceInputRequired: '需要语音音频或转录文本。',
    voiceChunkManifestMismatch: '语音片段与其准备清单不匹配。',
    assistantTranscriptionModelRequired: '需要设置助手转录模型。',
    listMetadataUnsupported:
      '列表项目仅支持标题、截止日期、优先级和 Vacation Coverage。',
    listDestinationAmbiguous: '保存前请选择一个列表目标。',
    listDestinationUnavailable: '该列表不可用。请在保存前选择一个现有列表。',
    listQuickAddSingleItem: '一次只能添加一个列表项目。',
    assistantResponseInvalid: '助手响应不是有效的 JSON。',
    assistantTasksLimitExceeded: values =>
      `助手返回的任务超过 ${values.count} 个。`,
    assistantSourceEvidenceInvalid: '助手无法验证任务的来源详情。',
    feedbackTranscriptionNotConfigured: '尚未配置反馈转录。',
    assistantTextModelNotConfigured: '尚未配置助手文本模型。',
    aiTaskCaptureNotConfigured: '尚未配置 AI 任务捕获。',
    speechCaptureNotConfigured: '尚未配置语音捕获。',
    assistantNotConfigured: '尚未配置助手。',
    tasksDisabled: '任务功能已关闭。',
    assistantDisabled: '助手已关闭。',
    aiUsageBudgetReached: '已达到 AI 使用预算。',
    assistantSettingsUnavailable: '助手设置不可用。',
    taskCreated: values => `已创建任务：${values.title}`,
    tasksCreated: values => `已创建 ${values.count} 个任务。`,
    taskReadbackDetails: values =>
      formatTaskReadbackDetails(values, TASK_READBACK_LABELS['zh-Hans']),
    listItemAdded: values => `已添加列表项：${values.title}`,
    listItemsAdded: values => `已向列表添加 ${values.count} 项。`,
    timerStarted: '计时器已开始。',
    breakTimerStarted: '休息计时器已开始。',
    longBreakStarted: '长休息已开始。',
    timerPaused: '计时器已暂停。',
    noTimerToPause: '没有可暂停的计时器。',
    fiveMinutesAdded: '已增加 5 分钟。',
    noTimerToExtend: '没有可延长的计时器。',
    timerCouldNotStart: '计时器无法开始。',
    chooseIntention: '开始工作计时器前，请选择目标及必需的子目标。',
  },
  hi: {
    tasksOff: 'कार्य बंद हैं।',
    noSpeechDetected: 'कोई आवाज़ नहीं मिली।',
    noSafeAction: 'कोई सुरक्षित कार्रवाई नहीं मिली।',
    taskCreatedFallback: 'कार्य बनाया गया। स्मार्ट पार्सिंग विफल रही।',
    fallbackTaskTitle: 'कैप्चर किए गए कार्य अनुरोध की समीक्षा करें',
    assistantTextRequired: 'असिस्टेंट टेक्स्ट आवश्यक है।',
    voiceInputRequired: 'वॉइस ऑडियो या ट्रांसक्रिप्ट आवश्यक है।',
    voiceChunkManifestMismatch:
      'वॉइस खंड उसके तैयारी मेनिफेस्ट से मेल नहीं खाता।',
    assistantTranscriptionModelRequired:
      'असिस्टेंट ट्रांसक्रिप्शन मॉडल आवश्यक है।',
    listMetadataUnsupported:
      'सूची आइटम केवल शीर्षक, नियत तिथि, प्राथमिकता और Vacation Coverage का समर्थन करते हैं।',
    listDestinationAmbiguous: 'सहेजने से पहले एक सूची गंतव्य चुनें।',
    listDestinationUnavailable:
      'वह सूची उपलब्ध नहीं है। सहेजने से पहले कोई मौजूदा सूची चुनें।',
    listQuickAddSingleItem: 'एक बार में केवल एक सूची आइटम जोड़ें।',
    assistantResponseInvalid: 'असिस्टेंट का उत्तर मान्य JSON नहीं था।',
    assistantTasksLimitExceeded: values =>
      `असिस्टेंट ने ${values.count} से अधिक कार्य लौटाए।`,
    assistantSourceEvidenceInvalid:
      'असिस्टेंट कार्य के स्रोत विवरण की पुष्टि नहीं कर सका।',
    feedbackTranscriptionNotConfigured:
      'फीडबैक ट्रांसक्रिप्शन कॉन्फ़िगर नहीं है।',
    assistantTextModelNotConfigured:
      'असिस्टेंट टेक्स्ट मॉडल कॉन्फ़िगर नहीं है।',
    aiTaskCaptureNotConfigured: 'AI कार्य कैप्चर कॉन्फ़िगर नहीं है।',
    speechCaptureNotConfigured: 'स्पीच कैप्चर कॉन्फ़िगर नहीं है।',
    assistantNotConfigured: 'असिस्टेंट कॉन्फ़िगर नहीं है।',
    tasksDisabled: 'कार्य बंद हैं।',
    assistantDisabled: 'असिस्टेंट बंद है।',
    aiUsageBudgetReached: 'AI उपयोग बजट पूरा हो गया है।',
    assistantSettingsUnavailable: 'असिस्टेंट सेटिंग उपलब्ध नहीं हैं।',
    taskCreated: values => `कार्य बनाया गया: ${values.title}`,
    tasksCreated: values => `${values.count} कार्य बनाए गए।`,
    taskReadbackDetails: values =>
      formatTaskReadbackDetails(values, TASK_READBACK_LABELS.hi),
    listItemAdded: values => `सूची आइटम जोड़ा गया: ${values.title}`,
    listItemsAdded: values => `सूची में ${values.count} आइटम जोड़े गए।`,
    timerStarted: 'टाइमर शुरू हो गया।',
    breakTimerStarted: 'ब्रेक टाइमर शुरू हो गया।',
    longBreakStarted: 'लंबा ब्रेक शुरू हो गया।',
    timerPaused: 'टाइमर रोक दिया गया।',
    noTimerToPause: 'रोकने के लिए कोई टाइमर नहीं है।',
    fiveMinutesAdded: '5 मिनट जोड़े गए।',
    noTimerToExtend: 'बढ़ाने के लिए कोई टाइमर नहीं है।',
    timerCouldNotStart: 'टाइमर शुरू नहीं हो सका।',
    chooseIntention:
      'काम का टाइमर शुरू करने से पहले इंटेंशन और आवश्यक उप-इंटेंशन चुनें।',
  },
  es: {
    tasksOff: 'Las tareas están desactivadas.',
    noSpeechDetected: 'No se detectó voz.',
    noSafeAction: 'No se encontró ninguna acción segura.',
    taskCreatedFallback: 'Tarea creada. El análisis inteligente falló.',
    fallbackTaskTitle: 'Revisa la solicitud de tarea capturada',
    assistantTextRequired: 'Se requiere texto para el asistente.',
    voiceInputRequired: 'Se requiere audio de voz o una transcripción.',
    voiceChunkManifestMismatch:
      'El fragmento de voz no coincide con su manifiesto de preparación.',
    assistantTranscriptionModelRequired:
      'Se requiere el modelo de transcripción del asistente.',
    listMetadataUnsupported:
      'Los elementos de lista solo admiten título, fecha de vencimiento, prioridad y Vacation Coverage.',
    listDestinationAmbiguous:
      'Elige un único destino de lista antes de guardar.',
    listDestinationUnavailable:
      'Esa lista no está disponible. Elige una lista existente antes de guardar.',
    listQuickAddSingleItem: 'Añade un solo elemento de lista cada vez.',
    assistantResponseInvalid:
      'La respuesta del asistente no era un JSON válido.',
    assistantTasksLimitExceeded: values =>
      `El asistente devolvió más de ${values.count} tareas.`,
    assistantSourceEvidenceInvalid:
      'El asistente no pudo verificar los detalles de origen de la tarea.',
    feedbackTranscriptionNotConfigured:
      'La transcripción de comentarios no está configurada.',
    assistantTextModelNotConfigured:
      'El modelo de texto del asistente no está configurado.',
    aiTaskCaptureNotConfigured:
      'La captura de tareas con IA no está configurada.',
    speechCaptureNotConfigured: 'La captura de voz no está configurada.',
    assistantNotConfigured: 'El asistente no está configurado.',
    tasksDisabled: 'Las tareas están desactivadas.',
    assistantDisabled: 'El asistente está desactivado.',
    aiUsageBudgetReached: 'Se alcanzó el presupuesto de uso de IA.',
    assistantSettingsUnavailable:
      'La configuración del asistente no está disponible.',
    taskCreated: values => `Tarea creada: ${values.title}`,
    tasksCreated: values => `Se crearon ${values.count} tareas.`,
    taskReadbackDetails: values =>
      formatTaskReadbackDetails(values, TASK_READBACK_LABELS.es),
    listItemAdded: values => `Elemento de lista añadido: ${values.title}`,
    listItemsAdded: values =>
      `Se añadieron ${values.count} elementos a la lista.`,
    timerStarted: 'Temporizador iniciado.',
    breakTimerStarted: 'Temporizador de descanso iniciado.',
    longBreakStarted: 'Descanso largo iniciado.',
    timerPaused: 'Temporizador pausado.',
    noTimerToPause: 'No hay ningún temporizador que pausar.',
    fiveMinutesAdded: 'Se añadieron 5 minutos.',
    noTimerToExtend: 'No hay ningún temporizador que ampliar.',
    timerCouldNotStart: 'No se pudo iniciar el temporizador.',
    chooseIntention:
      'Elige una intención y una subintención obligatoria antes de iniciar el temporizador de trabajo.',
  },
  ar: {
    tasksOff: 'المهام متوقفة.',
    noSpeechDetected: 'لم يتم اكتشاف كلام.',
    noSafeAction: 'لم يتم العثور على إجراء آمن.',
    taskCreatedFallback: 'تم إنشاء المهمة. فشل التحليل الذكي.',
    fallbackTaskTitle: 'راجع طلب المهمة المسجل',
    assistantTextRequired: 'نص المساعد مطلوب.',
    voiceInputRequired: 'الصوت أو النص المفرغ مطلوب.',
    voiceChunkManifestMismatch:
      'لا يتطابق مقطع الصوت مع بيان التحضير الخاص به.',
    assistantTranscriptionModelRequired:
      'نموذج تحويل كلام المساعد إلى نص مطلوب.',
    listMetadataUnsupported:
      'تدعم عناصر القائمة العنوان وتاريخ الاستحقاق والأولوية وVacation Coverage فقط.',
    listDestinationAmbiguous: 'اختر وجهة قائمة واحدة قبل الحفظ.',
    listDestinationUnavailable:
      'هذه القائمة غير متاحة. اختر قائمة موجودة قبل الحفظ.',
    listQuickAddSingleItem: 'أضف عنصرًا واحدًا إلى القائمة في كل مرة.',
    assistantResponseInvalid: 'لم تكن استجابة المساعد بصيغة JSON صالحة.',
    assistantTasksLimitExceeded: values =>
      `أعاد المساعد أكثر من ${values.count} مهام.`,
    assistantSourceEvidenceInvalid:
      'تعذر على المساعد التحقق من تفاصيل مصدر المهمة.',
    feedbackTranscriptionNotConfigured: 'لم يتم إعداد تحويل الملاحظات إلى نص.',
    assistantTextModelNotConfigured: 'لم يتم إعداد نموذج نص المساعد.',
    aiTaskCaptureNotConfigured: 'لم يتم إعداد التقاط المهام بالذكاء الاصطناعي.',
    speechCaptureNotConfigured: 'لم يتم إعداد التقاط الكلام.',
    assistantNotConfigured: 'لم يتم إعداد المساعد.',
    tasksDisabled: 'المهام متوقفة.',
    assistantDisabled: 'المساعد متوقف.',
    aiUsageBudgetReached: 'تم الوصول إلى ميزانية استخدام الذكاء الاصطناعي.',
    assistantSettingsUnavailable: 'إعدادات المساعد غير متاحة.',
    taskCreated: values => `تم إنشاء المهمة: ${values.title}`,
    tasksCreated: values => `تم إنشاء ${values.count} مهام.`,
    taskReadbackDetails: values =>
      formatTaskReadbackDetails(values, TASK_READBACK_LABELS.ar),
    listItemAdded: values => `تمت إضافة عنصر القائمة: ${values.title}`,
    listItemsAdded: values => `تمت إضافة ${values.count} عناصر إلى القائمة.`,
    timerStarted: 'بدأ المؤقت.',
    breakTimerStarted: 'بدأ مؤقت الاستراحة.',
    longBreakStarted: 'بدأت الاستراحة الطويلة.',
    timerPaused: 'تم إيقاف المؤقت مؤقتًا.',
    noTimerToPause: 'لا يوجد مؤقت لإيقافه مؤقتًا.',
    fiveMinutesAdded: 'تمت إضافة 5 دقائق.',
    noTimerToExtend: 'لا يوجد مؤقت لتمديده.',
    timerCouldNotStart: 'تعذر بدء المؤقت.',
    chooseIntention: 'اختر نية ونية فرعية مطلوبة قبل بدء مؤقت العمل.',
  },
  fr: {
    tasksOff: 'Les tâches sont désactivées.',
    noSpeechDetected: 'Aucune parole détectée.',
    noSafeAction: 'Aucune action sûre trouvée.',
    taskCreatedFallback: 'Tâche créée. L’analyse intelligente a échoué.',
    fallbackTaskTitle: 'Vérifier la demande de tâche capturée',
    assistantTextRequired: 'Le texte de l’assistant est requis.',
    voiceInputRequired: 'Un audio vocal ou une transcription est requis.',
    voiceChunkManifestMismatch:
      'Le fragment vocal ne correspond pas à son manifeste de préparation.',
    assistantTranscriptionModelRequired:
      'Le modèle de transcription de l’assistant est requis.',
    listMetadataUnsupported:
      'Les éléments de liste prennent uniquement en charge le titre, la date d’échéance, la priorité et Vacation Coverage.',
    listDestinationAmbiguous:
      'Choisissez une seule destination de liste avant l’enregistrement.',
    listDestinationUnavailable:
      'Cette liste est indisponible. Choisissez une liste existante avant l’enregistrement.',
    listQuickAddSingleItem: 'Ajoutez un seul élément de liste à la fois.',
    assistantResponseInvalid:
      'La réponse de l’assistant n’était pas un JSON valide.',
    assistantTasksLimitExceeded: values =>
      `L’assistant a renvoyé plus de ${values.count} tâches.`,
    assistantSourceEvidenceInvalid:
      'L’assistant n’a pas pu vérifier les détails source de la tâche.',
    feedbackTranscriptionNotConfigured:
      'La transcription des retours n’est pas configurée.',
    assistantTextModelNotConfigured:
      'Le modèle texte de l’assistant n’est pas configuré.',
    aiTaskCaptureNotConfigured:
      'La capture de tâches par IA n’est pas configurée.',
    speechCaptureNotConfigured: 'La capture vocale n’est pas configurée.',
    assistantNotConfigured: 'L’assistant n’est pas configuré.',
    tasksDisabled: 'Les tâches sont désactivées.',
    assistantDisabled: 'L’assistant est désactivé.',
    aiUsageBudgetReached: 'Le budget d’utilisation de l’IA est atteint.',
    assistantSettingsUnavailable:
      'Les paramètres de l’assistant sont indisponibles.',
    taskCreated: values => `Tâche créée : ${values.title}`,
    tasksCreated: values => `${values.count} tâches créées.`,
    taskReadbackDetails: values =>
      formatTaskReadbackDetails(values, TASK_READBACK_LABELS.fr),
    listItemAdded: values => `Élément de liste ajouté : ${values.title}`,
    listItemsAdded: values => `${values.count} éléments ajoutés à la liste.`,
    timerStarted: 'Minuteur démarré.',
    breakTimerStarted: 'Minuteur de pause démarré.',
    longBreakStarted: 'Longue pause démarrée.',
    timerPaused: 'Minuteur mis en pause.',
    noTimerToPause: 'Aucun minuteur à mettre en pause.',
    fiveMinutesAdded: '5 minutes ajoutées.',
    noTimerToExtend: 'Aucun minuteur à prolonger.',
    timerCouldNotStart: 'Impossible de démarrer le minuteur.',
    chooseIntention:
      'Choisissez une intention et une sous-intention requise avant de démarrer le minuteur de travail.',
  },
  bn: {
    tasksOff: 'কাজ বন্ধ আছে।',
    noSpeechDetected: 'কোনও কথা শনাক্ত হয়নি।',
    noSafeAction: 'কোনও নিরাপদ কাজ পাওয়া যায়নি।',
    taskCreatedFallback: 'কাজ তৈরি হয়েছে। স্মার্ট পার্সিং ব্যর্থ হয়েছে।',
    fallbackTaskTitle: 'ক্যাপচার করা কাজের অনুরোধ পর্যালোচনা করুন',
    assistantTextRequired: 'অ্যাসিস্ট্যান্টের লেখা প্রয়োজন।',
    voiceInputRequired: 'ভয়েস অডিও বা ট্রান্সক্রিপ্ট প্রয়োজন।',
    voiceChunkManifestMismatch:
      'ভয়েস অংশটি তার প্রস্তুতি ম্যানিফেস্টের সঙ্গে মেলে না।',
    assistantTranscriptionModelRequired:
      'অ্যাসিস্ট্যান্ট ট্রান্সক্রিপশন মডেল প্রয়োজন।',
    listMetadataUnsupported:
      'তালিকার আইটেমে শুধু শিরোনাম, শেষ তারিখ, অগ্রাধিকার এবং Vacation Coverage সমর্থিত।',
    listDestinationAmbiguous: 'সংরক্ষণ করার আগে একটি তালিকার গন্তব্য বেছে নিন।',
    listDestinationUnavailable:
      'এই তালিকাটি উপলভ্য নয়। সংরক্ষণ করার আগে একটি বিদ্যমান তালিকা বেছে নিন।',
    listQuickAddSingleItem: 'একবারে একটি তালিকা আইটেম যোগ করুন।',
    assistantResponseInvalid: 'অ্যাসিস্ট্যান্টের উত্তর বৈধ JSON ছিল না।',
    assistantTasksLimitExceeded: values =>
      `অ্যাসিস্ট্যান্ট ${values.count}-এর বেশি কাজ ফিরিয়েছে।`,
    assistantSourceEvidenceInvalid:
      'অ্যাসিস্ট্যান্ট কাজের উৎসের বিবরণ যাচাই করতে পারেনি।',
    feedbackTranscriptionNotConfigured:
      'ফিডব্যাক ট্রান্সক্রিপশন কনফিগার করা নেই।',
    assistantTextModelNotConfigured:
      'অ্যাসিস্ট্যান্ট টেক্সট মডেল কনফিগার করা নেই।',
    aiTaskCaptureNotConfigured: 'AI কাজ ক্যাপচার কনফিগার করা নেই।',
    speechCaptureNotConfigured: 'স্পিচ ক্যাপচার কনফিগার করা নেই।',
    assistantNotConfigured: 'অ্যাসিস্ট্যান্ট কনফিগার করা নেই।',
    tasksDisabled: 'কাজ বন্ধ আছে।',
    assistantDisabled: 'অ্যাসিস্ট্যান্ট বন্ধ আছে।',
    aiUsageBudgetReached: 'AI ব্যবহারের বাজেট শেষ হয়েছে।',
    assistantSettingsUnavailable: 'অ্যাসিস্ট্যান্ট সেটিংস উপলভ্য নয়।',
    taskCreated: values => `কাজ তৈরি হয়েছে: ${values.title}`,
    tasksCreated: values => `${values.count}টি কাজ তৈরি হয়েছে।`,
    taskReadbackDetails: values =>
      formatTaskReadbackDetails(values, TASK_READBACK_LABELS.bn),
    listItemAdded: values => `তালিকার আইটেম যোগ করা হয়েছে: ${values.title}`,
    listItemsAdded: values =>
      `তালিকায় ${values.count}টি আইটেম যোগ করা হয়েছে।`,
    timerStarted: 'টাইমার শুরু হয়েছে।',
    breakTimerStarted: 'বিরতির টাইমার শুরু হয়েছে।',
    longBreakStarted: 'দীর্ঘ বিরতি শুরু হয়েছে।',
    timerPaused: 'টাইমার থামানো হয়েছে।',
    noTimerToPause: 'থামানোর মতো কোনও টাইমার নেই।',
    fiveMinutesAdded: '৫ মিনিট যোগ করা হয়েছে।',
    noTimerToExtend: 'বাড়ানোর মতো কোনও টাইমার নেই।',
    timerCouldNotStart: 'টাইমার শুরু করা যায়নি।',
    chooseIntention:
      'কাজের টাইমার শুরু করার আগে একটি ইচ্ছা ও প্রয়োজনীয় উপ-ইচ্ছা বেছে নিন।',
  },
  'pt-BR': {
    tasksOff: 'As tarefas estão desativadas.',
    noSpeechDetected: 'Nenhuma fala detectada.',
    noSafeAction: 'Nenhuma ação segura encontrada.',
    taskCreatedFallback: 'Tarefa criada. A análise inteligente falhou.',
    fallbackTaskTitle: 'Revise a solicitação de tarefa capturada',
    assistantTextRequired: 'O texto do assistente é obrigatório.',
    voiceInputRequired: 'É necessário áudio de voz ou uma transcrição.',
    voiceChunkManifestMismatch:
      'O trecho de voz não corresponde ao manifesto de preparação.',
    assistantTranscriptionModelRequired:
      'O modelo de transcrição do assistente é obrigatório.',
    listMetadataUnsupported:
      'Os itens da lista aceitam apenas título, data de vencimento, prioridade e Vacation Coverage.',
    listDestinationAmbiguous:
      'Escolha um único destino de lista antes de salvar.',
    listDestinationUnavailable:
      'Essa lista não está disponível. Escolha uma lista existente antes de salvar.',
    listQuickAddSingleItem: 'Adicione um único item de lista por vez.',
    assistantResponseInvalid:
      'A resposta do assistente não era um JSON válido.',
    assistantTasksLimitExceeded: values =>
      `O assistente retornou mais de ${values.count} tarefas.`,
    assistantSourceEvidenceInvalid:
      'O assistente não conseguiu verificar os detalhes de origem da tarefa.',
    feedbackTranscriptionNotConfigured:
      'A transcrição de feedback não está configurada.',
    assistantTextModelNotConfigured:
      'O modelo de texto do assistente não está configurado.',
    aiTaskCaptureNotConfigured:
      'A captura de tarefas por IA não está configurada.',
    speechCaptureNotConfigured: 'A captura de voz não está configurada.',
    assistantNotConfigured: 'O assistente não está configurado.',
    tasksDisabled: 'As tarefas estão desativadas.',
    assistantDisabled: 'O assistente está desativado.',
    aiUsageBudgetReached: 'O orçamento de uso de IA foi atingido.',
    assistantSettingsUnavailable:
      'As configurações do assistente estão indisponíveis.',
    taskCreated: values => `Tarefa criada: ${values.title}`,
    tasksCreated: values => `${values.count} tarefas criadas.`,
    taskReadbackDetails: values =>
      formatTaskReadbackDetails(values, TASK_READBACK_LABELS['pt-BR']),
    listItemAdded: values => `Item de lista adicionado: ${values.title}`,
    listItemsAdded: values => `${values.count} itens adicionados à lista.`,
    timerStarted: 'Temporizador iniciado.',
    breakTimerStarted: 'Temporizador de pausa iniciado.',
    longBreakStarted: 'Pausa longa iniciada.',
    timerPaused: 'Temporizador pausado.',
    noTimerToPause: 'Não há temporizador para pausar.',
    fiveMinutesAdded: '5 minutos adicionados.',
    noTimerToExtend: 'Não há temporizador para estender.',
    timerCouldNotStart: 'Não foi possível iniciar o temporizador.',
    chooseIntention:
      'Escolha uma intenção e uma subintenção obrigatória antes de iniciar o temporizador de trabalho.',
  },
  id: {
    tasksOff: 'Tugas dinonaktifkan.',
    noSpeechDetected: 'Tidak ada ucapan yang terdeteksi.',
    noSafeAction: 'Tidak ada tindakan aman yang ditemukan.',
    taskCreatedFallback: 'Tugas dibuat. Penguraian cerdas gagal.',
    fallbackTaskTitle: 'Tinjau permintaan tugas yang direkam',
    assistantTextRequired: 'Teks asisten wajib diisi.',
    voiceInputRequired: 'Audio suara atau transkrip wajib diisi.',
    voiceChunkManifestMismatch:
      'Potongan suara tidak sesuai dengan manifes persiapannya.',
    assistantTranscriptionModelRequired:
      'Model transkripsi asisten wajib diisi.',
    listMetadataUnsupported:
      'Item daftar hanya mendukung judul, tanggal jatuh tempo, prioritas, dan Vacation Coverage.',
    listDestinationAmbiguous: 'Pilih satu tujuan Daftar sebelum menyimpan.',
    listDestinationUnavailable:
      'Daftar itu tidak tersedia. Pilih Daftar yang ada sebelum menyimpan.',
    listQuickAddSingleItem: 'Tambahkan satu item Daftar setiap kali.',
    assistantResponseInvalid: 'Respons asisten bukan JSON yang valid.',
    assistantTasksLimitExceeded: values =>
      `Asisten mengembalikan lebih dari ${values.count} tugas.`,
    assistantSourceEvidenceInvalid:
      'Asisten tidak dapat memverifikasi detail sumber tugas.',
    feedbackTranscriptionNotConfigured:
      'Transkripsi masukan belum dikonfigurasi.',
    assistantTextModelNotConfigured: 'Model teks asisten belum dikonfigurasi.',
    aiTaskCaptureNotConfigured: 'Penangkapan tugas AI belum dikonfigurasi.',
    speechCaptureNotConfigured: 'Penangkapan suara belum dikonfigurasi.',
    assistantNotConfigured: 'Asisten belum dikonfigurasi.',
    tasksDisabled: 'Tugas dinonaktifkan.',
    assistantDisabled: 'Asisten dinonaktifkan.',
    aiUsageBudgetReached: 'Anggaran penggunaan AI telah tercapai.',
    assistantSettingsUnavailable: 'Pengaturan asisten tidak tersedia.',
    taskCreated: values => `Tugas dibuat: ${values.title}`,
    tasksCreated: values => `${values.count} tugas dibuat.`,
    taskReadbackDetails: values =>
      formatTaskReadbackDetails(values, TASK_READBACK_LABELS.id),
    listItemAdded: values => `Item Daftar ditambahkan: ${values.title}`,
    listItemsAdded: values => `${values.count} item ditambahkan ke Daftar.`,
    timerStarted: 'Timer dimulai.',
    breakTimerStarted: 'Timer istirahat dimulai.',
    longBreakStarted: 'Istirahat panjang dimulai.',
    timerPaused: 'Timer dijeda.',
    noTimerToPause: 'Tidak ada timer untuk dijeda.',
    fiveMinutesAdded: '5 menit ditambahkan.',
    noTimerToExtend: 'Tidak ada timer untuk diperpanjang.',
    timerCouldNotStart: 'Timer tidak dapat dimulai.',
    chooseIntention:
      'Pilih niat dan subniat yang diperlukan sebelum memulai timer kerja.',
  },
  ur: {
    tasksOff: 'کام بند ہیں۔',
    noSpeechDetected: 'آواز نہیں ملی۔',
    noSafeAction: 'کوئی محفوظ کارروائی نہیں ملی۔',
    taskCreatedFallback: 'کام بنا دیا گیا۔ اسمارٹ تجزیہ ناکام ہو گیا۔',
    fallbackTaskTitle: 'ریکارڈ کیے گئے کام کی درخواست کا جائزہ لیں',
    assistantTextRequired: 'اسسٹنٹ کا متن ضروری ہے۔',
    voiceInputRequired: 'آواز کی آڈیو یا ٹرانسکرپٹ ضروری ہے۔',
    voiceChunkManifestMismatch:
      'آواز کا حصہ اپنے تیاری کے مینی فیسٹ سے مطابقت نہیں رکھتا۔',
    assistantTranscriptionModelRequired: 'اسسٹنٹ کا ٹرانسکرپشن ماڈل ضروری ہے۔',
    listMetadataUnsupported:
      'فہرست کی اشیا میں صرف عنوان، مقررہ تاریخ، ترجیح اور Vacation Coverage کی سہولت ہے۔',
    listDestinationAmbiguous:
      'محفوظ کرنے سے پہلے فہرست کی ایک منزل منتخب کریں۔',
    listDestinationUnavailable:
      'یہ فہرست دستیاب نہیں۔ محفوظ کرنے سے پہلے موجود فہرست منتخب کریں۔',
    listQuickAddSingleItem: 'ایک وقت میں فہرست کا صرف ایک آئٹم شامل کریں۔',
    assistantResponseInvalid: 'اسسٹنٹ کا جواب درست JSON نہیں تھا۔',
    assistantTasksLimitExceeded: values =>
      `اسسٹنٹ نے ${values.count} سے زیادہ کام واپس کیے۔`,
    assistantSourceEvidenceInvalid:
      'اسسٹنٹ کام کے ماخذ کی تفصیلات کی تصدیق نہیں کر سکا۔',
    feedbackTranscriptionNotConfigured: 'فیڈبیک ٹرانسکرپشن ترتیب نہیں دی گئی۔',
    assistantTextModelNotConfigured: 'اسسٹنٹ کا ٹیکسٹ ماڈل ترتیب نہیں دیا گیا۔',
    aiTaskCaptureNotConfigured: 'AI کام کی گرفت ترتیب نہیں دی گئی۔',
    speechCaptureNotConfigured: 'اسپیچ کی گرفت ترتیب نہیں دی گئی۔',
    assistantNotConfigured: 'اسسٹنٹ ترتیب نہیں دیا گیا۔',
    tasksDisabled: 'کام بند ہیں۔',
    assistantDisabled: 'اسسٹنٹ بند ہے۔',
    aiUsageBudgetReached: 'AI استعمال کا بجٹ پورا ہو گیا ہے۔',
    assistantSettingsUnavailable: 'اسسٹنٹ کی ترتیبات دستیاب نہیں ہیں۔',
    taskCreated: values => `کام بنا دیا گیا: ${values.title}`,
    tasksCreated: values => `${values.count} کام بنا دیے گئے۔`,
    taskReadbackDetails: values =>
      formatTaskReadbackDetails(values, TASK_READBACK_LABELS.ur),
    listItemAdded: values => `فہرست کا آئٹم شامل کر دیا گیا: ${values.title}`,
    listItemsAdded: values =>
      `فہرست میں ${values.count} آئٹمز شامل کر دیے گئے۔`,
    timerStarted: 'ٹائمر شروع ہو گیا۔',
    breakTimerStarted: 'وقفے کا ٹائمر شروع ہو گیا۔',
    longBreakStarted: 'طویل وقفہ شروع ہو گیا۔',
    timerPaused: 'ٹائمر روک دیا گیا۔',
    noTimerToPause: 'روکنے کے لیے کوئی ٹائمر نہیں ہے۔',
    fiveMinutesAdded: '5 منٹ شامل کر دیے گئے۔',
    noTimerToExtend: 'بڑھانے کے لیے کوئی ٹائمر نہیں ہے۔',
    timerCouldNotStart: 'ٹائمر شروع نہیں ہو سکا۔',
    chooseIntention:
      'کام کا ٹائمر شروع کرنے سے پہلے نیت اور مطلوبہ ذیلی نیت منتخب کریں۔',
  },
} satisfies Record<AssistantLanguage, Record<AssistantKey, AssistantTemplate>>;

export function translateAssistant(
  language: string | null | undefined,
  key: AssistantKey,
  values?: Record<string, string | number>
) {
  const normalized = normalizeAppLanguage(language) as AssistantLanguage | null;
  const template = ASSISTANT_TRANSLATIONS[normalized ?? 'en'][key];
  return typeof template === 'function' ? template(values ?? {}) : template;
}

export type { AssistantKey };
