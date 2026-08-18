import type { Preferences, Timer } from '@pomi/shared';
import { TIMER_STATUSES, TIMER_TYPES } from '@pomi/shared/src/constants';
import clsx from 'clsx';
import { type KeyboardEvent, useEffect, useState } from 'react';
import { FaForward, FaPause, FaPlay } from 'react-icons/fa';
import { TimerActionButtons } from '../../components/TimerActionButtons';
import { IconButton } from '../../components/ui/IconButton';
import { IntentionEmojiPair } from '../../components/ui/IntentionEmojiPair';
import { KeyboardShortcut } from '../../components/ui/KeyboardShortcut';
import { COLORS, HEX_COLORS } from '../../config/colors';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { useUiStore } from '../../stores/uiStore';
import { useTimerStore } from '../../stores/timerStore';
import { isDesktop } from '../../utils/osUtils';
import { formatTime } from '../../utils/timeUtils';
import { useI18n } from '../../i18n';

interface TimeRemainingCircleProps {
  showSessionIndicator?: boolean;
  sessionPosition?: number;
  sessionTotal?: number;
  isExpanded?: boolean;
}

interface SessionProgressRingProps {
  colors: ReturnType<typeof getTimerColorsForTimer>;
  isDisconnected: boolean;
  preferences?: Preferences | null;
  radius: number;
  sessionPosition: number;
  sessionTotal: number;
  setSessionPosition: (position: number) => void;
  timer: Timer;
}

const RING_CENTER = 160;
const RING_VIEW_BOX_SIZE = 320;
const RING_DISPLAY_BOX_SIZE = 288;
const RING_DISPLAY_VIEW_BOX = `${(RING_VIEW_BOX_SIZE - RING_DISPLAY_BOX_SIZE) / 2} ${(RING_VIEW_BOX_SIZE - RING_DISPLAY_BOX_SIZE) / 2} ${RING_DISPLAY_BOX_SIZE} ${RING_DISPLAY_BOX_SIZE}`;
const SESSION_RING_STROKE_WIDTH = 8;
const SESSION_RING_HIT_WIDTH = 36;
const SESSION_RING_LABEL_OFFSET = 15;
const DESKTOP_TIMER_CONTROLS_POSITION_CLASS = 'top-[calc(50%+36px)]';
const MOBILE_RUNNING_CONTROLS_POSITION_CLASS = 'bottom-[62px]';
const MOBILE_PENDING_CONTROLS_POSITION_CLASS = 'bottom-[92px]';
const MOBILE_PRE_START_SKIP_POSITION_CLASS = 'bottom-[62px]';
const MOBILE_EXTENSION_PRE_START_POSITION_CLASS = 'bottom-[80px]';

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const polarToCartesian = (radius: number, angleInDegrees: number) => {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;

  return {
    x: RING_CENTER + radius * Math.cos(angleInRadians),
    y: RING_CENTER + radius * Math.sin(angleInRadians),
  };
};

const timerProgressToCartesian = (radius: number, progressAngle: number) =>
  polarToCartesian(radius, -progressAngle);

const describeArcPath = (
  radius: number,
  startAngle: number,
  endAngle: number
) => {
  const sweep = Math.max(0, endAngle - startAngle);
  const start = timerProgressToCartesian(radius, startAngle);

  if (sweep >= 359.999) {
    const mid = timerProgressToCartesian(radius, startAngle + 180);
    return [
      `M ${start.x} ${start.y}`,
      `A ${radius} ${radius} 0 1 0 ${mid.x} ${mid.y}`,
      `A ${radius} ${radius} 0 1 0 ${start.x} ${start.y}`,
    ].join(' ');
  }

  const end = timerProgressToCartesian(radius, endAngle);
  const largeArcFlag = sweep > 180 ? 1 : 0;

  return [
    `M ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
  ].join(' ');
};

const describeAnnularSegmentPath = (
  radius: number,
  hitWidth: number,
  startAngle: number,
  endAngle: number
) => {
  const outerRadius = radius + hitWidth / 2;
  const innerRadius = Math.max(1, radius - hitWidth / 2);
  const sweep = Math.max(0, endAngle - startAngle);
  const outerStart = timerProgressToCartesian(outerRadius, startAngle);
  const innerStart = timerProgressToCartesian(innerRadius, startAngle);

  if (sweep >= 359.999) {
    const outerMid = timerProgressToCartesian(outerRadius, startAngle + 180);
    const innerMid = timerProgressToCartesian(innerRadius, startAngle + 180);

    return [
      `M ${outerStart.x} ${outerStart.y}`,
      `A ${outerRadius} ${outerRadius} 0 1 0 ${outerMid.x} ${outerMid.y}`,
      `A ${outerRadius} ${outerRadius} 0 1 0 ${outerStart.x} ${outerStart.y}`,
      `L ${innerStart.x} ${innerStart.y}`,
      `A ${innerRadius} ${innerRadius} 0 1 1 ${innerMid.x} ${innerMid.y}`,
      `A ${innerRadius} ${innerRadius} 0 1 1 ${innerStart.x} ${innerStart.y}`,
      'Z',
    ].join(' ');
  }

  const outerEnd = timerProgressToCartesian(outerRadius, endAngle);
  const innerEnd = timerProgressToCartesian(innerRadius, endAngle);
  const largeArcFlag = sweep > 180 ? 1 : 0;

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 0 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 1 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
};

const formatClockTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

const getTimerColorsForTimer = (timer?: Timer | null) => {
  if (!timer)
    return {
      stroke: HEX_COLORS.indigo,
      bg: HEX_COLORS.indigo,
      text: COLORS.indigo.text,
    };
  if (timer.type === TIMER_TYPES.WORK)
    return {
      stroke: HEX_COLORS.indigo,
      bg: HEX_COLORS.indigo,
      text: COLORS.indigo.text,
    };
  else if (timer.type === TIMER_TYPES.LONG_BREAK)
    return {
      stroke: HEX_COLORS.purple,
      bg: HEX_COLORS.purple,
      text: COLORS.purple.text,
    };
  else
    return {
      stroke: HEX_COLORS.green,
      bg: HEX_COLORS.green,
      text: COLORS.green.text,
    };
};

function SessionProgressRing({
  colors,
  isDisconnected,
  preferences,
  radius,
  sessionPosition,
  sessionTotal,
  setSessionPosition,
  timer,
}: SessionProgressRingProps) {
  const activePosition = clamp(Math.trunc(sessionPosition), 1, sessionTotal);
  const baseDuration = Math.max(
    1,
    timer.originalDuration ?? preferences?.workTimerDuration ?? timer.duration
  );
  const extensionBaseDuration = timer.extensionBaseDuration ?? baseDuration;
  const extensionElapsedDuration = clamp(
    timer.duration - timer.remainingTime,
    0,
    timer.duration
  );
  const displayedActiveDuration = timer.isExtension
    ? extensionBaseDuration + timer.duration
    : timer.duration;
  const displayedElapsedDuration = timer.isExtension
    ? extensionBaseDuration + extensionElapsedDuration
    : timer.duration - timer.remainingTime;
  const activeSegmentWeight = Math.max(
    1,
    displayedActiveDuration / baseDuration
  );
  const segmentWeights = Array.from({ length: sessionTotal }).map((_, index) =>
    index + 1 === activePosition ? activeSegmentWeight : 1
  );
  const totalSegmentWeight = segmentWeights.reduce(
    (total, weight) => total + weight,
    0
  );
  let nextSegmentStartAngle = 0;
  const segments = segmentWeights.map((weight, index) => {
    const rawAngle = (weight / totalSegmentWeight) * 360;
    const preferredGapAngle =
      sessionTotal > 1 ? clamp(rawAngle * 0.12, 6, 12) : 0;
    const gapAngle =
      sessionTotal > 1 ? Math.min(preferredGapAngle, rawAngle * 0.8) : 0;
    const startAngle = nextSegmentStartAngle + gapAngle / 2;
    const sweep = Math.max(0, rawAngle - gapAngle);
    const boundaryAngle = nextSegmentStartAngle + rawAngle;
    nextSegmentStartAngle = boundaryAngle;

    return {
      position: index + 1,
      weight,
      startAngle,
      endAngle: startAngle + sweep,
      sweep,
      boundaryAngle,
    };
  });
  const isBreakTimer = timer.type === TIMER_TYPES.BREAK;
  const elapsedFraction =
    displayedActiveDuration > 0
      ? clamp(displayedElapsedDuration / displayedActiveDuration, 0, 1)
      : 0;
  const activeSegment = segments[activePosition - 1];
  const markerAngle = isBreakTimer
    ? 360 * elapsedFraction
    : activeSegment
      ? activeSegment.startAngle + activeSegment.sweep * elapsedFraction
      : 0;
  const marker = timerProgressToCartesian(radius, markerAngle);
  const now = Date.now();
  const workDuration = preferences?.workTimerDuration ?? timer.duration;
  const breakDuration = preferences?.breakTimerDuration ?? 0;
  const showEtas =
    preferences?.sessionShowEta === true &&
    timer.status !== TIMER_STATUSES.COMPLETED;

  const getEtaForPosition = (position: number) => {
    if (position < activePosition) return null;

    const sessionsAhead = position - activePosition;
    if (timer.type === TIMER_TYPES.BREAK) {
      return (
        now +
        timer.remainingTime +
        workDuration +
        sessionsAhead * (breakDuration + workDuration)
      );
    }

    if (timer.type === TIMER_TYPES.WORK) {
      return (
        now +
        timer.remainingTime +
        sessionsAhead * (breakDuration + workDuration)
      );
    }

    return null;
  };

  const handleSegmentClick = (position: number) => {
    if (isDisconnected || timer.isExtension || position === activePosition) {
      return;
    }

    setSessionPosition(position);
  };

  const handleSegmentKeyDown = (
    event: KeyboardEvent<SVGPathElement>,
    position: number
  ) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    handleSegmentClick(position);
  };

  return (
    <>
      <svg
        className="absolute top-4 left-0 h-full w-full overflow-visible"
        data-testid="session-progress-ring"
        viewBox={RING_DISPLAY_VIEW_BOX}
      >
        {segments.map(segment => {
          const position = segment.position;
          const segmentStart = segment.startAngle;
          const segmentEnd = segment.endAngle;
          const segmentSweep = segment.sweep;
          const isPast = position < activePosition;
          const isActive = position === activePosition;
          const isClickable =
            !isDisconnected && !timer.isExtension && !isActive;
          const breakProgressAngle = 360 * elapsedFraction;
          const coloredStart = isBreakTimer
            ? Math.max(segmentStart, breakProgressAngle)
            : isActive
              ? segmentStart + segmentSweep * elapsedFraction
              : segmentStart;
          const coloredSweep = segmentEnd - coloredStart;
          const shouldColor = isBreakTimer
            ? coloredStart < segmentEnd
            : !isPast && coloredSweep > 0;
          const eta = getEtaForPosition(position);
          const etaPoint = timerProgressToCartesian(
            radius + SESSION_RING_LABEL_OFFSET,
            segment.endAngle
          );
          const intentionEmoji = timer.sessionIntentionEmojis?.[position];
          const intentionPoint = timerProgressToCartesian(
            radius,
            segmentStart + segmentSweep / 2
          );
          const horizontalDistance = etaPoint.x - RING_CENTER;
          const isSideEta = Math.abs(horizontalDistance) > radius * 0.58;
          const textAnchor = !isSideEta
            ? 'middle'
            : horizontalDistance < 0
              ? 'end'
              : 'start';

          return (
            <g key={position}>
              <path
                d={describeArcPath(radius, segmentStart, segmentEnd)}
                data-session-position={position}
                data-testid="session-progress-segment-track"
                fill="none"
                stroke={colors.bg}
                strokeLinecap="round"
                strokeOpacity="0.18"
                strokeWidth={SESSION_RING_STROKE_WIDTH}
              />
              {shouldColor && (
                <path
                  d={describeArcPath(radius, coloredStart, segmentEnd)}
                  fill="none"
                  stroke={colors.stroke}
                  strokeLinecap="round"
                  strokeOpacity={isActive ? 1 : 0.76}
                  strokeWidth={SESSION_RING_STROKE_WIDTH}
                  className="transition-all duration-500 ease-out"
                  data-testid="session-progress-segment-fill"
                />
              )}
              {showEtas && eta && (
                <text
                  className="tabular-nums"
                  data-session-position={position}
                  data-testid="session-progress-eta"
                  fill="rgb(203 213 225)"
                  fontSize="11.5"
                  fontWeight="600"
                  letterSpacing="0.15"
                  paintOrder="stroke"
                  stroke="rgb(15 23 42)"
                  strokeLinejoin="round"
                  strokeWidth="3"
                  dominantBaseline="middle"
                  textAnchor={textAnchor}
                  x={etaPoint.x}
                  y={etaPoint.y}
                >
                  {formatClockTime(eta)}
                </text>
              )}
              {isPast && intentionEmoji && (
                <text
                  className="session-intention-icon"
                  data-testid="session-progress-intention-icon"
                  dominantBaseline="middle"
                  fontSize="18"
                  textAnchor="middle"
                  x={intentionPoint.x}
                  y={intentionPoint.y}
                >
                  {intentionEmoji}
                </text>
              )}
              <path
                aria-current={isActive ? 'true' : undefined}
                aria-disabled={isClickable ? undefined : 'true'}
                aria-label={`Go to Pomi ${position} of ${sessionTotal}`}
                className={clsx(
                  'outline-none focus-visible:ring-2 focus-visible:ring-slate-200/70',
                  isClickable && 'cursor-pointer'
                )}
                d={describeAnnularSegmentPath(
                  radius,
                  SESSION_RING_HIT_WIDTH,
                  segmentStart,
                  segmentEnd
                )}
                data-active={isActive ? 'true' : 'false'}
                data-segment-weight={Number(
                  segment.weight.toFixed(3)
                ).toString()}
                data-session-position={position}
                data-testid="session-progress-segment"
                fill="transparent"
                onClick={() => handleSegmentClick(position)}
                onKeyDown={event => handleSegmentKeyDown(event, position)}
                pointerEvents="all"
                role="button"
                tabIndex={isClickable ? 0 : undefined}
              />
            </g>
          );
        })}
        <circle
          cx={marker.x}
          cy={marker.y}
          data-session-position={activePosition}
          data-testid="session-progress-marker"
          fill="rgb(15 23 42)"
          r="5"
          stroke={colors.stroke}
          strokeWidth="3"
          className="transition-all duration-500 ease-out"
        />
      </svg>
    </>
  );
}

export function TimeRemainingCircle({
  showSessionIndicator,
  sessionPosition,
  sessionTotal,
  isExpanded = true,
}: TimeRemainingCircleProps) {
  const { t } = useI18n();
  const timer = useTimerStore.use.timer();
  const toggleTimer = useTimerStore.use.toggleTimer();
  const skipTimer = useTimerStore.use.skipTimer();
  const setSessionPosition = useTimerStore.use.setSessionPosition();
  const connectionStatus = useTimerStore.use.connectionStatus();
  const extensionState = useTimerStore.use.extensionState();
  const preferences = usePreferencesStore.use.preferences();
  const setAdvancedSkipStartPending =
    useUiStore.use.setAdvancedSkipStartPending();
  const advancedSkipStartPending = useUiStore.use.advancedSkipStartPending();
  const setAdvancedSkipModalOpen = useUiStore.use.setAdvancedSkipModalOpen();
  const setTimerExtensionModalOpen =
    useUiStore.use.setTimerExtensionModalOpen();
  const [playIconVisible, setPlayIconVisible] = useState(false);
  const [showActionButtons, setShowActionButtons] = useState(
    timer?.status === TIMER_STATUSES.RUNNING
  );

  const isDisconnected =
    !connectionStatus.isConnected || connectionStatus.isReconnecting;

  const timerNotStarted =
    !!timer &&
    timer.status === TIMER_STATUSES.PAUSED &&
    timer.remainingTime === timer.duration;
  const hasPausedExtensionOpportunity =
    !!extensionState &&
    timer?.status === TIMER_STATUSES.PAUSED &&
    (timer.type === TIMER_TYPES.BREAK || timer.type === TIMER_TYPES.LONG_BREAK);

  const showPreStartSkip =
    isExpanded &&
    timerNotStarted &&
    !advancedSkipStartPending &&
    (!!preferences?.advancedSkip ||
      (!!preferences?.intentionExtension &&
        !!preferences?.intentionRequireSelection));

  const showPausedExtensionControls =
    isExpanded && hasPausedExtensionOpportunity;
  const showMinimizedExtensionControls =
    !isExpanded && hasPausedExtensionOpportunity;
  const showTimerActionButtons =
    showActionButtons || showMinimizedExtensionControls;
  const usesSharedExpandedGeometry = isExpanded;

  const handlePreStartSkip = () => {
    if (isDisconnected || !timer) return;
    setAdvancedSkipStartPending(false);
    setAdvancedSkipModalOpen(false);
    skipTimer('none');
  };

  const handleOpenTimerExtension = () => {
    if (isDisconnected || !extensionState) return;
    setTimerExtensionModalOpen(true);
  };

  const desktopControlsPositionClass = usesSharedExpandedGeometry
    ? 'top-[calc(50%+59px)]'
    : DESKTOP_TIMER_CONTROLS_POSITION_CLASS;
  const actionButtonPositionClass = showActionButtons
    ? isDesktop || usesSharedExpandedGeometry
      ? desktopControlsPositionClass
      : MOBILE_RUNNING_CONTROLS_POSITION_CLASS
    : isDesktop || usesSharedExpandedGeometry
      ? desktopControlsPositionClass
      : MOBILE_PENDING_CONTROLS_POSITION_CLASS;
  const preStartControlsPositionClass =
    isDesktop || usesSharedExpandedGeometry
      ? desktopControlsPositionClass
      : showPausedExtensionControls && showPreStartSkip
        ? MOBILE_EXTENSION_PRE_START_POSITION_CLASS
        : MOBILE_PRE_START_SKIP_POSITION_CLASS;

  useEffect(() => {
    if (!timer?.status) return;

    setShowActionButtons(timer.status === TIMER_STATUSES.RUNNING);
  }, [timer?.status]);

  const handleTimerClick = () => {
    if (isDisconnected) return;
    if (timer?.status !== TIMER_STATUSES.RUNNING) {
      setAdvancedSkipStartPending(true);
    }
    toggleTimer();
    setPlayIconVisible(true);

    const timeout = setTimeout(() => {
      setPlayIconVisible(false);
    }, 2000);

    return () => clearTimeout(timeout);
  };

  const calculateProgress = () => {
    if (!timer) return 0;

    const totalDuration = timer.duration;
    const progress = (timer.remainingTime / totalDuration) * 100;
    return progress;
  };

  const radius = usesSharedExpandedGeometry ? 136 : 130;
  const circumference = 2 * Math.PI * radius;
  const progress = calculateProgress();
  const dashOffset = circumference - (progress / 100) * circumference;
  const colors = getTimerColorsForTimer(timer);
  const ringColors =
    timer?.status === TIMER_STATUSES.PAUSED
      ? {
          ...colors,
          stroke: '#64748b',
          bg: '#475569',
        }
      : colors;
  const showSegmentedSessionRing =
    !!timer &&
    !!showSessionIndicator &&
    isExpanded &&
    !!sessionPosition &&
    !!sessionTotal &&
    timer.type === TIMER_TYPES.WORK;
  const sessionRingRadius = radius;
  const plainRingViewBox = isExpanded ? RING_DISPLAY_VIEW_BOX : undefined;
  const pauseIndicatorPositionClass = usesSharedExpandedGeometry
    ? 'mb-[92px]'
    : !isDesktop && showPausedExtensionControls
      ? 'mb-[118px]'
      : isDesktop
        ? 'mb-[92px]'
        : 'mb-[84px]';

  return (
    // <div className="relative flex items-center justify-center w-full h-80">
    <div
      data-testid="time-remaining-circle"
      data-timer-status={timer?.status ?? 'none'}
      aria-busy={!timer}
      className={clsx(
        'relative flex items-center justify-center w-full',
        isExpanded ? 'h-[288px]' : 'h-80'
      )}
    >
      <div
        data-testid="timer-circle-content"
        data-expanded-scale={isExpanded ? (isDesktop ? '0.85' : '0.95') : '1'}
        className={clsx(
          'absolute inset-0 flex items-center justify-center',
          isExpanded && (isDesktop ? 'scale-[0.85]' : 'scale-[0.95]')
        )}
      >
        {showSegmentedSessionRing ? (
          <SessionProgressRing
            colors={ringColors}
            isDisconnected={isDisconnected}
            preferences={preferences}
            radius={sessionRingRadius}
            sessionPosition={sessionPosition}
            sessionTotal={sessionTotal}
            setSessionPosition={setSessionPosition}
            timer={timer}
          />
        ) : (
          <svg
            className={clsx(
              'absolute left-0 h-full w-full -rotate-90',
              isExpanded ? 'top-4' : 'top-0'
            )}
            viewBox={plainRingViewBox}
          >
            <circle
              data-testid="timer-progress-track"
              cx={plainRingViewBox ? RING_CENTER : '50%'}
              cy={plainRingViewBox ? RING_CENTER : '50%'}
              r={radius}
              stroke={ringColors.bg}
              strokeOpacity="0.2"
              strokeWidth="8"
              fill="none"
              className={clsx(!timer && 'animate-pulse')}
            />
            {timer && (
              <circle
                cx={plainRingViewBox ? RING_CENTER : '50%'}
                cy={plainRingViewBox ? RING_CENTER : '50%'}
                r={radius}
                stroke={ringColors.stroke}
                strokeWidth="8"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                className="transition-[stroke-dashoffset] duration-500 ease-out"
              />
            )}
          </svg>
        )}

        {timer &&
          (!showSessionIndicator ||
            timer?.status !== TIMER_STATUSES.RUNNING) && (
            <div
              className={clsx(
                'absolute flex flex-col transition-opacity duration-500 ease-out pointer-events-none',
                pauseIndicatorPositionClass,
                playIconVisible || timer?.status !== TIMER_STATUSES.RUNNING
                  ? 'opacity-100'
                  : 'opacity-0'
              )}
            >
              <div>
                {timer?.status === TIMER_STATUSES.RUNNING ? (
                  <IconButton
                    label={t('timer.start')}
                    variant="secondary"
                    size={isDesktop || usesSharedExpandedGeometry ? 'sm' : 'md'}
                  >
                    <FaPlay />
                  </IconButton>
                ) : (
                  <IconButton
                    label={t('timer.pause')}
                    variant="secondary"
                    size={isDesktop || usesSharedExpandedGeometry ? 'sm' : 'md'}
                  >
                    <FaPause />
                  </IconButton>
                )}
              </div>
            </div>
          )}

        <div
          onClick={timer ? handleTimerClick : undefined}
          className={clsx(
            'absolute z-10 flex flex-col items-center justify-center',
            isExpanded && 'translate-y-4',
            !timer || isDisconnected ? 'cursor-not-allowed' : 'cursor-pointer'
          )}
        >
          {timer ? (
            <div className="relative">
              <h1
                className={`${isExpanded ? 'text-[63px] leading-none' : 'text-6xl'} font-mono font-bold ${colors.text} ${
                  !isDisconnected ? 'hover:scale-105' : ''
                } transition-all select-none`}
              >
                {formatTime(timer.remainingTime)}
              </h1>
            </div>
          ) : (
            <div
              data-testid="timer-data-skeleton"
              className="flex flex-col items-center gap-3"
              aria-hidden="true"
            >
              <div className="h-14 w-48 animate-pulse rounded-lg bg-slate-800/80" />
              <div className="h-3 w-24 animate-pulse rounded bg-slate-800/55" />
            </div>
          )}
        </div>

        <div
          data-testid="timer-action-controls"
          className={clsx(
            'absolute transition-all duration-500 ease-out z-0',
            actionButtonPositionClass,
            showTimerActionButtons
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 -translate-y-5 pointer-events-none'
          )}
        >
          {showTimerActionButtons && (
            <TimerActionButtons
              isDisconnected={isDisconnected}
              hideSkipButton={showPreStartSkip}
            />
          )}
        </div>

        {showPausedExtensionControls && !showActionButtons && (
          <div
            className={clsx(
              'absolute z-10 flex justify-center',
              preStartControlsPositionClass
            )}
          >
            <div className="flex items-center space-x-3">
              <IconButton
                onClick={handleOpenTimerExtension}
                label={t('timer.openExtensionOptions')}
                variant="secondary"
                disabled={isDisconnected}
              >
                <span
                  aria-hidden="true"
                  className="inline-flex h-4 w-4 items-center justify-center text-base leading-none"
                >
                  {extensionState?.intentionEmoji ||
                  extensionState?.subIntentionEmoji ? (
                    <IntentionEmojiPair
                      parentEmoji={extensionState?.intentionEmoji}
                      subEmoji={extensionState?.subIntentionEmoji}
                      size="sm"
                    />
                  ) : (
                    '⏱️'
                  )}
                </span>
                <KeyboardShortcut text="D" showModIcon={false} />
              </IconButton>
              {showPreStartSkip && (
                <IconButton
                  onClick={handlePreStartSkip}
                  label={t('timer.skipTo', {
                    target: t(
                      timer?.type === TIMER_TYPES.WORK
                        ? 'common.break'
                        : 'common.work'
                    ),
                  })}
                  variant="secondary"
                  disabled={isDisconnected}
                >
                  <FaForward />
                  <KeyboardShortcut text="S" showModIcon={false} />
                </IconButton>
              )}
            </div>
          </div>
        )}

        {showPreStartSkip &&
          !showActionButtons &&
          !showPausedExtensionControls && (
            <div
              className={clsx(
                'absolute z-10 flex justify-center',
                preStartControlsPositionClass
              )}
            >
              <IconButton
                onClick={handlePreStartSkip}
                label={t('timer.skipTo', {
                  target: t(
                    timer?.type === TIMER_TYPES.WORK
                      ? 'common.break'
                      : 'common.work'
                  ),
                })}
                variant="secondary"
                disabled={isDisconnected}
              >
                <FaForward />
                <KeyboardShortcut text="S" showModIcon={false} />
              </IconButton>
            </div>
          )}
      </div>
    </div>
  );
}
