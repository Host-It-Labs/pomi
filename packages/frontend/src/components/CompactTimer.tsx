import { type ReactNode } from 'react';
import {
  FaPause,
  FaPlay,
  FaRegClock,
  FaFlagCheckered,
  FaHistory,
} from 'react-icons/fa';
import { TIMER_STATUSES, TIMER_TYPES } from '@pomi/shared/src/constants';
import { useTimerStore } from '../stores/timerStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useUiStore } from '../stores/uiStore';
import { useI18n } from '../i18n';
import { formatTime } from '../utils/timeUtils';
import {
  getSessionTimeline,
  getSessionSegments,
} from '../utils/sessionTimeline';
import { TimerActionButtons } from './TimerActionButtons';
import { IconButton } from './ui/IconButton';
import { KeyboardShortcut } from './ui/KeyboardShortcut';

const clockTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

export function CompactTimerDisplay({
  showPreviousExtension,
  intentionEmojis,
}: {
  showPreviousExtension?: boolean;
  intentionEmojis?: ReactNode;
}) {
  const { t } = useI18n();
  const timer = useTimerStore.use.timer();
  const preferences = usePreferencesStore.use.preferences();
  const connection = useTimerStore.use.connectionStatus();
  const toggleTimer = useTimerStore.use.toggleTimer();
  const setPosition = useTimerStore.use.setSessionPosition();
  const timeline = getSessionTimeline(
    timer ?? null,
    preferences ?? null,
    Date.now()
  );
  const disabled = !connection.isConnected || connection.isReconnecting;
  const segments = getSessionSegments(timer ?? null, preferences ?? null);
  const showEtas = preferences?.sessionShowEta === true;
  const extensionState = useTimerStore.use.extensionState();
  const setExtensionOpen = useUiStore.use.setTimerExtensionModalOpen();
  return (
    <div className="compact-timer-display" data-testid="compact-timer-display">
      <div className="compact-session">
        {preferences?.sessionsExtension && (
          <div
            className="session-ring"
            role="group"
            aria-label={t('workspace.sessionDetails')}
          >
            <svg viewBox="0 0 44 44">
              {segments.map((segment, index) => {
                const length = (113.1 * segment.sweep) / 360;
                const filled = segment.progress;
                const label = `${t('common.work')} ${index + 1}/${timeline.total}`;
                const select = () => {
                  if (!disabled && timer && !timer.isExtension)
                    setPosition(index + 1);
                };
                return (
                  <g
                    key={index}
                    transform={`translate(44 0) scale(-1 1) rotate(${segment.start - 90} 22 22)`}
                  >
                    <circle
                      className="session-segment"
                      role="button"
                      aria-label={label}
                      aria-pressed={timeline.position === index + 1}
                      aria-disabled={disabled || !timer || timer.isExtension}
                      tabIndex={
                        disabled || !timer || timer.isExtension ? -1 : 0
                      }
                      onClick={select}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          select();
                        }
                      }}
                      cx="22"
                      cy="22"
                      r="18"
                      fill="none"
                      stroke="var(--stone-border)"
                      strokeWidth="7"
                      strokeDasharray={`${Math.max(0, length - 3)} 113.1`}
                    >
                      <title>
                        {label}
                        {showEtas && timeline.ends[index] !== null
                          ? ` · ${clockTime(timeline.ends[index]!)}`
                          : ''}
                      </title>
                    </circle>
                    <circle
                      pointerEvents="none"
                      cx="22"
                      cy="22"
                      r="18"
                      fill="none"
                      stroke="var(--stone-accent)"
                      strokeWidth="4"
                      strokeDasharray={`${Math.max(0, length - 3) * filled} 113.1`}
                    />
                  </g>
                );
              })}
            </svg>
            <span className="pointer-events-none">
              {timeline.position}
              <small>/{timeline.total}</small>
            </span>
          </div>
        )}
        {showEtas && timeline.timerEnd !== null && (
          <div className="compact-etas" data-testid="compact-etas">
            <span
              title={t('workspace.timerEnd')}
              aria-label={`${t('workspace.timerEnd')} ${clockTime(timeline.timerEnd)}`}
            >
              <FaRegClock aria-hidden="true" />
              {clockTime(timeline.timerEnd)}
            </span>
            {timeline.sessionEnd !== null && (
              <span
                title={t('workspace.sessionEnd')}
                aria-label={`${t('workspace.sessionEnd')} ${clockTime(timeline.sessionEnd)}`}
              >
                <FaFlagCheckered aria-hidden="true" />
                {clockTime(timeline.sessionEnd)}
              </span>
            )}
          </div>
        )}
        {showPreviousExtension && (
          <span
            title={t(
              extensionState
                ? 'timer.openExtensionOptions'
                : 'workspace.noPreviousTimer'
            )}
          >
            <IconButton
              size="sm"
              variant="secondary"
              label={t(
                extensionState
                  ? 'timer.openExtensionOptions'
                  : 'workspace.noPreviousTimer'
              )}
              disabled={disabled || !extensionState}
              onClick={() => setExtensionOpen(true)}
            >
              <FaHistory aria-hidden="true" />
              <KeyboardShortcut text="D" />
            </IconButton>
          </span>
        )}
      </div>
      <div className="compact-time">
        <span className="compact-timer-type">
          {t(
            timer?.type === TIMER_TYPES.LONG_BREAK
              ? 'common.longBreak'
              : timer?.type === TIMER_TYPES.BREAK
                ? 'common.break'
                : 'common.work'
          )}
        </span>
        <div className="compact-countdown-anchor">
          <button
            type="button"
            className="compact-countdown"
            onClick={toggleTimer}
            disabled={disabled}
            aria-label={
              timer?.status === TIMER_STATUSES.RUNNING
                ? t('timer.pause')
                : t('timer.start')
            }
          >
            {formatTime(
              timer?.remainingTime ?? preferences?.workTimerDuration ?? 0
            )}
          </button>
          {intentionEmojis}
        </div>
      </div>
    </div>
  );
}

export function CompactTimer() {
  const { t } = useI18n();
  const timer = useTimerStore.use.timer();
  const toggleTimer = useTimerStore.use.toggleTimer();
  const connection = useTimerStore.use.connectionStatus();
  return (
    <div className="compact-timer" data-testid="compact-timer">
      <CompactTimerDisplay showPreviousExtension />
      <div className="compact-timer-actions">
        <IconButton
          size="sm"
          label={
            timer?.status === TIMER_STATUSES.RUNNING
              ? t('timer.pause')
              : t('timer.start')
          }
          onClick={toggleTimer}
          disabled={!connection.isConnected || connection.isReconnecting}
        >
          <span className="timer-playback-icon" key={timer?.status}>
            {timer?.status === TIMER_STATUSES.RUNNING ? (
              <FaPause />
            ) : (
              <FaPlay />
            )}
          </span>
        </IconButton>
        <span className="timer-action-separator" aria-hidden="true" />
        <TimerActionButtons
          size="sm"
          isDisconnected={!connection.isConnected || connection.isReconnecting}
        />
      </div>
    </div>
  );
}
