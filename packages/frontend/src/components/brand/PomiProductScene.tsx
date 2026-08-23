import clsx from 'clsx';
import { FaCheck, FaForward, FaPause } from 'react-icons/fa6';
import { useI18n } from '../../i18n';

type ProductScene = 'sync' | 'tasks' | 'timer' | 'welcome';

interface PomiProductSceneProps {
  className?: string;
  scene: ProductScene;
}

const INTENTIONS = [
  { emoji: '🐛', key: 'access.preview.intention.debug' },
  { emoji: '🎯', key: 'access.preview.intention.focus' },
  { emoji: '📚', key: 'access.preview.intention.read' },
] as const;

function TimerDial({
  compact = false,
  minimal = false,
  watch = false,
}: {
  compact?: boolean;
  minimal?: boolean;
  watch?: boolean;
}) {
  return (
    <div
      data-product-motif="timer"
      className={clsx(
        'relative flex shrink-0 items-center justify-center',
        watch ? 'h-16 w-16' : compact ? 'h-24 w-24' : 'h-52 w-52'
      )}
    >
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full -rotate-90 overflow-visible drop-shadow-[0_0_24px_rgba(99,102,241,0.24)]"
        viewBox="0 0 120 120"
      >
        <circle
          cx="60"
          cy="60"
          r="51"
          fill="none"
          stroke="#1e293b"
          strokeWidth={compact ? 7 : 6}
        />
        <circle
          cx="60"
          cy="60"
          r="51"
          fill="none"
          stroke="#6366f1"
          strokeWidth={compact ? 7 : 6}
          strokeDasharray="321 321"
          strokeLinecap="round"
        />
      </svg>

      {!minimal ? (
        <span
          className={clsx(
            'absolute top-[18%] flex items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-300',
            compact ? 'h-5 w-5 text-[7px]' : 'h-7 w-7 text-[9px]'
          )}
        >
          <FaPause />
        </span>
      ) : null}

      <strong
        className={clsx(
          'font-mono font-bold tracking-[-0.05em] text-indigo-400',
          watch ? 'text-sm' : compact ? 'text-xl' : 'text-4xl'
        )}
      >
        25:00
      </strong>

      {!minimal ? (
        <span
          className={clsx(
            'absolute bottom-[16%] flex items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-300',
            compact ? 'h-5 w-5 text-[7px]' : 'h-7 w-7 text-[9px]'
          )}
        >
          <FaForward />
        </span>
      ) : null}
    </div>
  );
}

function IntentionNode({
  intention,
  className,
}: {
  intention: (typeof INTENTIONS)[number];
  className?: string;
}) {
  const { t } = useI18n();

  return (
    <div
      data-product-motif="intention"
      className={clsx(
        'absolute flex items-center gap-2 text-[10px] font-medium text-slate-300',
        className
      )}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-indigo-400/30 bg-slate-900/90 text-base leading-none shadow-[0_12px_28px_rgba(2,6,23,.55)]">
        {intention.emoji}
      </span>
      <span className="drop-shadow-[0_2px_4px_rgba(2,6,23,.9)]">
        {t(intention.key)}
      </span>
    </div>
  );
}

function FocusComposition({ cinematic = false }: { cinematic?: boolean }) {
  return (
    <div className="relative h-full overflow-hidden bg-slate-950">
      <div className="absolute left-1/2 top-[48%] h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full border border-indigo-400/8" />
      <div className="absolute left-1/2 top-[48%] h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-800/50" />
      <div
        className={clsx(
          'absolute left-1/2 top-[48%] -translate-x-1/2 -translate-y-1/2',
          cinematic && 'scale-110'
        )}
      >
        <TimerDial />
      </div>

      <IntentionNode
        intention={INTENTIONS[0]}
        className="left-[5%] top-[15%]"
      />
      <IntentionNode
        intention={INTENTIONS[1]}
        className="right-[4%] top-[24%]"
      />
      {!cinematic ? (
        <IntentionNode
          intention={INTENTIONS[2]}
          className="bottom-[8%] left-[8%]"
        />
      ) : null}

      <div className="absolute inset-x-0 bottom-0 h-20 bg-linear-to-t from-slate-950 to-transparent" />
    </div>
  );
}

function TaskCard({
  accent,
  emoji,
  titleKey,
  className,
}: {
  accent: 'amber' | 'rose';
  emoji: string;
  titleKey: string;
  className?: string;
}) {
  const { t } = useI18n();

  return (
    <div
      data-product-motif="task"
      className={clsx(
        'absolute grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border bg-slate-900/95 px-4 py-4 shadow-[0_22px_45px_rgba(2,6,23,.55)]',
        accent === 'rose' ? 'border-rose-500/35' : 'border-amber-400/30',
        className
      )}
    >
      <span
        className={clsx(
          'flex h-7 w-7 items-center justify-center rounded-full border',
          accent === 'rose'
            ? 'border-rose-300/50 text-rose-200'
            : 'border-amber-300/50 text-amber-200'
        )}
      >
        <FaCheck className="text-[10px] opacity-25" />
      </span>
      <span className="min-w-0">
        <strong className="block truncate text-[12px] font-semibold text-slate-100">
          {t(titleKey)}
        </strong>
        <span className="mt-1 block text-sm leading-none">{emoji}</span>
      </span>
      <span
        className={clsx(
          'h-9 w-1 rounded-full',
          accent === 'rose' ? 'bg-rose-400' : 'bg-amber-400'
        )}
      />
    </div>
  );
}

function TaskComposition() {
  return (
    <div className="relative h-full overflow-hidden bg-slate-950">
      <div className="absolute left-[12%] top-[17%] h-[62%] w-[76%] rounded-[36px] border border-indigo-500/10 bg-indigo-500/5" />
      <TaskCard
        accent="amber"
        emoji="📬"
        titleKey="access.preview.task.clearInbox"
        className="left-[9%] right-[16%] top-[27%] -rotate-3 opacity-65"
      />
      <TaskCard
        accent="rose"
        emoji="🐛🩹"
        titleKey="access.preview.task.fixBug"
        className="left-[16%] right-[7%] top-[48%] rotate-2"
      />
      <div className="absolute bottom-[8%] left-1/2 h-px w-[56%] -translate-x-1/2 bg-linear-to-r from-transparent via-indigo-400/30 to-transparent" />
    </div>
  );
}

function DesktopDevice() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border-2 border-slate-600 bg-slate-950 shadow-[0_20px_40px_rgba(2,6,23,.55)]">
      <div className="flex h-5 items-center gap-1 border-b border-slate-800 px-2">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
        <span className="h-1.5 w-1.5 rounded-full bg-slate-700" />
      </div>
      <div className="flex flex-1 items-center justify-center">
        <TimerDial compact minimal />
      </div>
    </div>
  );
}

function PhoneDevice() {
  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden rounded-[24px] border-[3px] border-slate-600 bg-slate-950 shadow-[0_22px_42px_rgba(2,6,23,.65)]">
      <span className="absolute left-1/2 top-2 h-1.5 w-8 -translate-x-1/2 rounded-full bg-slate-700" />
      <TimerDial compact minimal />
    </div>
  );
}

function WatchDevice() {
  return (
    <div className="relative aspect-[0.82] w-full rounded-[31%] border-[3px] border-slate-600 bg-black p-1.5 shadow-[0_18px_36px_rgba(2,6,23,.65)]">
      <span className="absolute -right-1.5 top-[30%] h-5 w-1.5 rounded-r bg-slate-600" />
      <div className="flex h-full items-center justify-center overflow-hidden rounded-[26%] bg-slate-950">
        <TimerDial minimal watch />
      </div>
    </div>
  );
}

function DeviceComposition() {
  return (
    <div className="relative h-full overflow-hidden bg-slate-950">
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 400 250"
        preserveAspectRatio="none"
      >
        <path
          d="M 18 176 C 108 44, 272 40, 382 160"
          fill="none"
          stroke="#4f46e5"
          strokeOpacity="0.22"
          strokeWidth="2"
        />
        <path
          d="M 30 188 C 132 80, 276 74, 370 172"
          fill="none"
          stroke="#38bdf8"
          strokeOpacity="0.1"
          strokeWidth="1"
        />
      </svg>

      <div
        data-device="desktop"
        className="absolute bottom-7 left-[4%] top-9 w-[43%]"
      >
        <DesktopDevice />
      </div>
      <div
        data-device="phone"
        className="absolute bottom-3 left-[41%] top-3 w-[30%]"
      >
        <PhoneDevice />
      </div>
      <div
        data-device="watch"
        className="absolute right-[4%] top-[34%] w-[23%]"
      >
        <WatchDevice />
      </div>
    </div>
  );
}

function CinematicWelcome() {
  return (
    <div className="relative h-full overflow-hidden bg-slate-950">
      <div className="absolute left-[18%] top-[5%] h-56 w-56 rounded-full bg-indigo-500/18 blur-3xl" />

      <div className="absolute -bottom-[6%] -left-[8%] top-[4%] w-[72%] -rotate-6 overflow-hidden rounded-[28px] border border-slate-600/70 bg-slate-950 shadow-[0_28px_60px_rgba(2,6,23,.7)]">
        <div className="flex h-6 items-center gap-1 border-b border-slate-800 px-3">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
          <span className="h-1.5 w-1.5 rounded-full bg-slate-700" />
        </div>
        <div className="flex h-[calc(100%-1.5rem)] items-center justify-center">
          <TimerDial />
        </div>
      </div>

      <div className="absolute -bottom-[4%] right-[2%] top-[9%] w-[38%] rotate-6 overflow-hidden rounded-[30px] border-[3px] border-slate-600 bg-slate-950 shadow-[0_28px_55px_rgba(2,6,23,.72)]">
        <span className="absolute left-1/2 top-2 z-10 h-1.5 w-9 -translate-x-1/2 rounded-full bg-slate-700" />
        <div className="flex h-full items-center justify-center">
          <TimerDial compact />
        </div>
      </div>

      <div className="absolute bottom-[2%] left-[3%] z-20 w-[20%] rotate-6">
        <WatchDevice />
      </div>

      <IntentionNode
        intention={INTENTIONS[0]}
        className="left-[4%] top-[10%] z-20"
      />
      <IntentionNode
        intention={INTENTIONS[1]}
        className="right-[4%] top-[4%] z-20"
      />
    </div>
  );
}

export function PomiProductScene({ className, scene }: PomiProductSceneProps) {
  if (scene === 'welcome') {
    return (
      <div
        aria-hidden="true"
        data-product-scene="welcome"
        className={clsx(
          'relative isolate overflow-hidden bg-slate-950',
          className
        )}
      >
        <div className="absolute inset-x-0 -top-3 bottom-0 opacity-95">
          <CinematicWelcome />
        </div>
        <div className="absolute inset-0 bg-linear-to-b from-transparent via-slate-950/10 to-slate-950" />
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      data-product-scene={scene}
      className={clsx('overflow-hidden rounded-2xl bg-slate-950', className)}
    >
      {scene === 'timer' ? <FocusComposition /> : null}
      {scene === 'tasks' ? <TaskComposition /> : null}
      {scene === 'sync' ? <DeviceComposition /> : null}
    </div>
  );
}
