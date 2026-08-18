import { translateNotificationCatalog } from '@pomi/shared/src/notificationCatalog';
import { normalizeAppLanguage } from '@pomi/shared/src/constants';
import type {
  AppLanguage,
  NotificationKey as SharedNotificationKey,
} from '@pomi/shared/src/constants';

type PlatformNotificationKey =
  | 'desktopWorkComplete'
  | 'taskNeedsAttention'
  | 'sessionComplete'
  | 'desktopWorkBody'
  | 'desktopBreakBody';

export type NotificationKey = SharedNotificationKey | PlatformNotificationKey;

type NotificationTemplate =
  | string
  | ((values: Record<string, string | number>) => string);

const ENGLISH_PLATFORM: Record<PlatformNotificationKey, NotificationTemplate> =
  {
    desktopWorkComplete: 'Work Session Complete!',
    taskNeedsAttention: 'A task needs attention.',
    sessionComplete: 'Session complete! Great work!',
    desktopWorkBody: 'Time for a break. Take some time to relax.',
    desktopBreakBody: 'Break is over. Ready to get back to work?',
  };

const PLATFORM_TRANSLATIONS: Partial<
  Record<
    AppLanguage,
    Partial<Record<PlatformNotificationKey, NotificationTemplate>>
  >
> = {
  'zh-Hans': {
    desktopWorkComplete: '工作会话完成！',
    taskNeedsAttention: '有任务需要处理。',
    sessionComplete: '会话完成！做得好！',
    desktopWorkBody: '该休息一下了。放松片刻吧。',
    desktopBreakBody: '休息结束。准备继续工作吗？',
  },
  hi: {
    desktopWorkComplete: 'काम का सत्र पूरा हुआ!',
    taskNeedsAttention: 'एक कार्य पर ध्यान देना है।',
    sessionComplete: 'सत्र पूरा हुआ! शानदार काम!',
    desktopWorkBody: 'ब्रेक लेने का समय है। थोड़ा आराम करें।',
    desktopBreakBody: 'ब्रेक समाप्त। काम पर लौटने के लिए तैयार?',
  },
  es: {
    desktopWorkComplete: '¡Sesión de trabajo completada!',
    taskNeedsAttention: 'Una tarea necesita atención.',
    sessionComplete: '¡Sesión completada! ¡Buen trabajo!',
    desktopWorkBody: 'Es hora de descansar. Relájate un rato.',
    desktopBreakBody: 'Terminó el descanso. ¿Listo para volver al trabajo?',
  },
  ar: {
    desktopWorkComplete: 'اكتملت جلسة العمل!',
    taskNeedsAttention: 'هناك مهمة تحتاج إلى انتباهك.',
    sessionComplete: 'اكتملت الجلسة! عمل رائع!',
    desktopWorkBody: 'حان وقت الاستراحة. خذ وقتًا للاسترخاء.',
    desktopBreakBody: 'انتهت الاستراحة. هل أنت مستعد للعودة إلى العمل؟',
  },
  fr: {
    desktopWorkComplete: 'Session de travail terminée !',
    taskNeedsAttention: 'Une tâche nécessite votre attention.',
    sessionComplete: 'Session terminée ! Beau travail !',
    desktopWorkBody: "C'est l'heure de faire une pause. Détendez-vous.",
    desktopBreakBody: 'La pause est terminée. Prêt à reprendre le travail ?',
  },
  bn: {
    desktopWorkComplete: 'কাজের সেশন সম্পন্ন!',
    taskNeedsAttention: 'একটি কাজে মনোযোগ প্রয়োজন।',
    sessionComplete: 'সেশন সম্পন্ন! দারুণ কাজ!',
    desktopWorkBody: 'বিরতি নেওয়ার সময় হয়েছে। একটু বিশ্রাম নিন।',
    desktopBreakBody: 'বিরতি শেষ। কাজে ফিরতে প্রস্তুত?',
  },
  'pt-BR': {
    desktopWorkComplete: 'Sessão de trabalho concluída!',
    taskNeedsAttention: 'Uma tarefa precisa de atenção.',
    sessionComplete: 'Sessão concluída! Bom trabalho!',
    desktopWorkBody: 'Hora de fazer uma pausa. Relaxe um pouco.',
    desktopBreakBody: 'A pausa terminou. Pronto para voltar ao trabalho?',
  },
  id: {
    desktopWorkComplete: 'Sesi kerja selesai!',
    taskNeedsAttention: 'Ada tugas yang perlu diperhatikan.',
    sessionComplete: 'Sesi selesai! Kerja bagus!',
    desktopWorkBody: 'Waktunya beristirahat. Bersantailah sejenak.',
    desktopBreakBody: 'Istirahat selesai. Siap kembali bekerja?',
  },
  ur: {
    desktopWorkComplete: 'کام کا سیشن مکمل ہو گیا!',
    taskNeedsAttention: 'ایک کام پر توجہ درکار ہے۔',
    sessionComplete: 'سیشن مکمل! بہت اچھا کام!',
    desktopWorkBody: 'وقفہ لینے کا وقت ہے۔ کچھ دیر آرام کریں۔',
    desktopBreakBody: 'وقفہ ختم۔ کیا آپ کام پر واپس آنے کے لیے تیار ہیں؟',
  },
};

function isPlatformNotificationKey(
  key: NotificationKey
): key is PlatformNotificationKey {
  return key in ENGLISH_PLATFORM;
}

export function translateNotification(
  language: string | null | undefined,
  key: NotificationKey,
  values?: Record<string, string | number>
) {
  if (!isPlatformNotificationKey(key)) {
    return translateNotificationCatalog(language, key, {
      minutes: readNumber(values?.minutes),
      position: readNumber(values?.position),
      total: readNumber(values?.total),
    });
  }

  const normalized = normalizeAppLanguage(language) ?? 'en';
  const template =
    PLATFORM_TRANSLATIONS[normalized]?.[key] ?? ENGLISH_PLATFORM[key];
  return typeof template === 'function' ? template(values ?? {}) : template;
}

function readNumber(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
