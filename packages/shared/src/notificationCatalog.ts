import {
  DEFAULT_APP_LANGUAGE,
  normalizeAppLanguage,
  type AppLanguage,
  type NotificationKey,
} from './constants';

export interface NotificationValues {
  minutes?: number;
  position?: number;
  total?: number;
}

export type NotificationTemplate =
  | string
  | ((values: NotificationValues) => string);

export type NotificationCatalog = Record<
  AppLanguage,
  Record<NotificationKey, NotificationTemplate>
>;

const ENGLISH: Record<NotificationKey, NotificationTemplate> = {
  workComplete: 'Work Timer Complete!',
  longBreakComplete: 'Long Break Complete!',
  breakComplete: 'Break Complete!',
  longBreakDetected: 'Long Break Detected',
  pausedTimerReminder: 'Timer Still Paused',
  breakTime: 'Time for a break.',
  readyToWork: 'Ready to get back to it?',
  longBreakDetectedBody: 'Session reset to start after long break.',
  pausedTimerReminderBody:
    'Your work timer has been paused for over 5 minutes.',
  minutesLeft: values => `${values.minutes ?? 0} Minutes Left`,
  timerEnding: values =>
    `Your work timer will end in ${values.minutes ?? 0} minutes.`,
  taskDue: 'Task due',
  workTimersDone: values =>
    `${values.position ?? 0} of ${values.total ?? values.position ?? 0} work timers done!`,
};

export const NOTIFICATION_TRANSLATIONS: NotificationCatalog = {
  en: ENGLISH,
  'zh-Hans': {
    workComplete: '工作计时完成！',
    longBreakComplete: '长休息完成！',
    breakComplete: '休息完成！',
    longBreakDetected: '检测到长休息',
    pausedTimerReminder: '计时器仍处于暂停状态',
    breakTime: '该休息一下了。',
    readyToWork: '准备继续工作吗？',
    longBreakDetectedBody: '长休息后，会话已重置。',
    pausedTimerReminderBody: '你的工作计时器已暂停超过 5 分钟。',
    minutesLeft: values => `还剩 ${values.minutes ?? 0} 分钟`,
    timerEnding: values => `工作计时将在 ${values.minutes ?? 0} 分钟后结束。`,
    taskDue: '任务到期',
    workTimersDone: values =>
      `已完成 ${values.total ?? values.position ?? 0} 个工作计时中的第 ${values.position ?? 0} 个。`,
  },
  hi: {
    workComplete: 'काम का टाइमर पूरा हुआ!',
    longBreakComplete: 'लंबा ब्रेक पूरा हुआ!',
    breakComplete: 'ब्रेक पूरा हुआ!',
    longBreakDetected: 'लंबा ब्रेक मिला',
    pausedTimerReminder: 'टाइमर अभी भी रुका हुआ है',
    breakTime: 'ब्रेक लेने का समय है।',
    readyToWork: 'क्या आप फिर से काम करने के लिए तैयार हैं?',
    longBreakDetectedBody: 'लंबे ब्रेक के बाद सत्र रीसेट हो गया है।',
    pausedTimerReminderBody:
      'आपका काम का टाइमर 5 मिनट से अधिक समय से रुका हुआ है।',
    minutesLeft: values => `${values.minutes ?? 0} मिनट बाकी`,
    timerEnding: values =>
      `आपका काम का टाइमर ${values.minutes ?? 0} मिनट में समाप्त होगा।`,
    taskDue: 'कार्य की समय सीमा',
    workTimersDone: values =>
      `${values.total ?? values.position ?? 0} में से ${values.position ?? 0} काम टाइमर पूरे हुए।`,
  },
  es: {
    workComplete: '¡Temporizador de trabajo completado!',
    longBreakComplete: '¡Descanso largo completado!',
    breakComplete: '¡Descanso completado!',
    longBreakDetected: 'Descanso largo detectado',
    pausedTimerReminder: 'El temporizador sigue pausado',
    breakTime: 'Es hora de descansar.',
    readyToWork: '¿Listo para volver al trabajo?',
    longBreakDetectedBody: 'La sesión se reinició después del descanso largo.',
    pausedTimerReminderBody:
      'Tu temporizador de trabajo lleva pausado más de 5 minutos.',
    minutesLeft: values => `Faltan ${values.minutes ?? 0} minutos`,
    timerEnding: values =>
      `Tu temporizador de trabajo terminará en ${values.minutes ?? 0} minutos.`,
    taskDue: 'Tarea pendiente',
    workTimersDone: values =>
      `Se completó el temporizador ${values.position ?? 0} de ${values.total ?? values.position ?? 0}.`,
  },
  ar: {
    workComplete: 'اكتمل مؤقت العمل!',
    longBreakComplete: 'اكتملت الاستراحة الطويلة!',
    breakComplete: 'اكتملت الاستراحة!',
    longBreakDetected: 'تم اكتشاف استراحة طويلة',
    pausedTimerReminder: 'لا يزال المؤقت متوقفًا مؤقتًا',
    breakTime: 'حان وقت الاستراحة.',
    readyToWork: 'هل أنت مستعد للعودة إلى العمل؟',
    longBreakDetectedBody: 'تمت إعادة ضبط الجلسة بعد الاستراحة الطويلة.',
    pausedTimerReminderBody: 'تم إيقاف مؤقت العمل مؤقتًا لأكثر من 5 دقائق.',
    minutesLeft: values => `تبقى ${values.minutes ?? 0} دقيقة`,
    timerEnding: values =>
      `سينتهي مؤقت العمل خلال ${values.minutes ?? 0} دقيقة.`,
    taskDue: 'حان موعد المهمة',
    workTimersDone: values =>
      `اكتمل مؤقت العمل ${values.position ?? 0} من ${values.total ?? values.position ?? 0}.`,
  },
  fr: {
    workComplete: 'Minuteur de travail terminé !',
    longBreakComplete: 'Longue pause terminée !',
    breakComplete: 'Pause terminée !',
    longBreakDetected: 'Longue pause détectée',
    pausedTimerReminder: 'Le minuteur est toujours en pause',
    breakTime: "C'est l'heure de faire une pause.",
    readyToWork: 'Prêt à reprendre le travail ?',
    longBreakDetectedBody:
      'La session a été réinitialisée après la longue pause.',
    pausedTimerReminderBody:
      'Votre minuteur de travail est en pause depuis plus de 5 minutes.',
    minutesLeft: values => `Encore ${values.minutes ?? 0} minutes`,
    timerEnding: values =>
      `Votre minuteur de travail se terminera dans ${values.minutes ?? 0} minutes.`,
    taskDue: 'Tâche à échéance',
    workTimersDone: values =>
      `Minuteur de travail ${values.position ?? 0} sur ${values.total ?? values.position ?? 0} terminé.`,
  },
  bn: {
    workComplete: 'কাজের টাইমার সম্পন্ন!',
    longBreakComplete: 'দীর্ঘ বিরতি সম্পন্ন!',
    breakComplete: 'বিরতি সম্পন্ন!',
    longBreakDetected: 'দীর্ঘ বিরতি শনাক্ত হয়েছে',
    pausedTimerReminder: 'টাইমার এখনও বিরতিতে আছে',
    breakTime: 'বিরতি নেওয়ার সময় হয়েছে।',
    readyToWork: 'আবার কাজে ফিরতে প্রস্তুত?',
    longBreakDetectedBody: 'দীর্ঘ বিরতির পরে সেশন রিসেট হয়েছে।',
    pausedTimerReminderBody:
      'আপনার কাজের টাইমার ৫ মিনিটের বেশি সময় ধরে থামানো আছে।',
    minutesLeft: values => `${values.minutes ?? 0} মিনিট বাকি`,
    timerEnding: values =>
      `আপনার কাজের টাইমার ${values.minutes ?? 0} মিনিটের মধ্যে শেষ হবে।`,
    taskDue: 'কাজের সময়সীমা',
    workTimersDone: values =>
      `${values.total ?? values.position ?? 0}টির মধ্যে ${values.position ?? 0}টি কাজের টাইমার সম্পন্ন।`,
  },
  'pt-BR': {
    workComplete: 'Temporizador de trabalho concluído!',
    longBreakComplete: 'Pausa longa concluída!',
    breakComplete: 'Pausa concluída!',
    longBreakDetected: 'Pausa longa detectada',
    pausedTimerReminder: 'O temporizador continua pausado',
    breakTime: 'Hora de fazer uma pausa.',
    readyToWork: 'Pronto para voltar ao trabalho?',
    longBreakDetectedBody: 'A sessão foi reiniciada após a pausa longa.',
    pausedTimerReminderBody:
      'Seu temporizador de trabalho está pausado há mais de 5 minutos.',
    minutesLeft: values => `Faltam ${values.minutes ?? 0} minutos`,
    timerEnding: values =>
      `Seu temporizador de trabalho terminará em ${values.minutes ?? 0} minutos.`,
    taskDue: 'Tarefa pendente',
    workTimersDone: values =>
      `${values.position ?? 0} de ${values.total ?? values.position ?? 0} temporizadores de trabalho concluídos.`,
  },
  id: {
    workComplete: 'Timer kerja selesai!',
    longBreakComplete: 'Istirahat panjang selesai!',
    breakComplete: 'Istirahat selesai!',
    longBreakDetected: 'Istirahat panjang terdeteksi',
    pausedTimerReminder: 'Timer masih dijeda',
    breakTime: 'Waktunya beristirahat.',
    readyToWork: 'Siap kembali bekerja?',
    longBreakDetectedBody: 'Sesi diatur ulang setelah istirahat panjang.',
    pausedTimerReminderBody:
      'Timer kerja Anda telah dijeda selama lebih dari 5 menit.',
    minutesLeft: values => `Tersisa ${values.minutes ?? 0} menit`,
    timerEnding: values =>
      `Timer kerja Anda akan berakhir dalam ${values.minutes ?? 0} menit.`,
    taskDue: 'Tugas jatuh tempo',
    workTimersDone: values =>
      `${values.position ?? 0} dari ${values.total ?? values.position ?? 0} timer kerja selesai.`,
  },
  ur: {
    workComplete: 'کام کا ٹائمر مکمل ہو گیا!',
    longBreakComplete: 'طویل وقفہ مکمل ہو گیا!',
    breakComplete: 'وقفہ مکمل ہو گیا!',
    longBreakDetected: 'طویل وقفہ معلوم ہوا',
    pausedTimerReminder: 'ٹائمر ابھی بھی موقوف ہے',
    breakTime: 'وقفہ لینے کا وقت ہے۔',
    readyToWork: 'کیا آپ دوبارہ کام کے لیے تیار ہیں؟',
    longBreakDetectedBody: 'طویل وقفے کے بعد سیشن دوبارہ ترتیب دیا گیا ہے۔',
    pausedTimerReminderBody:
      'آپ کا کام کا ٹائمر 5 منٹ سے زیادہ عرصے سے موقوف ہے۔',
    minutesLeft: values => `${values.minutes ?? 0} منٹ باقی`,
    timerEnding: values =>
      `آپ کا کام کا ٹائمر ${values.minutes ?? 0} منٹ میں ختم ہو جائے گا۔`,
    taskDue: 'کام کی آخری تاریخ',
    workTimersDone: values =>
      `${values.total ?? values.position ?? 0} میں سے ${values.position ?? 0} کام کے ٹائمر مکمل۔`,
  },
};

export function translateNotificationCatalog(
  language: string | null | undefined,
  key: NotificationKey,
  values?: NotificationValues
): string {
  const normalized = normalizeAppLanguage(language) ?? DEFAULT_APP_LANGUAGE;
  const template = NOTIFICATION_TRANSLATIONS[normalized]?.[key] ?? ENGLISH[key];
  return typeof template === 'function' ? template(values ?? {}) : template;
}
