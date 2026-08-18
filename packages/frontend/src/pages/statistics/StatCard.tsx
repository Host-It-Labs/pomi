import { FaArrowDown, FaArrowUp } from 'react-icons/fa';
import {
  MILLISECONDS_PER_MINUTE,
  MILLISECONDS_PER_SECOND,
} from '../../constants/time';

import { MetricMode } from '../../stores/statisticsStore';

function formatTimeCompact(ms: number): string {
  const minutes = Math.floor(ms / MILLISECONDS_PER_MINUTE);
  const seconds = Math.floor(
    (ms % MILLISECONDS_PER_MINUTE) / MILLISECONDS_PER_SECOND
  );
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function ChangeIndicator({ change }: { change: number | null }) {
  if (change === null) {
    return null;
  }

  if (change > 0) {
    return (
      <span className="text-green-500 inline-flex items-center text-xs">
        <FaArrowUp size={9} className="mr-0.5" />
        {Math.abs(change)}%
      </span>
    );
  }
  if (change < 0) {
    return (
      <span className="text-red-500 inline-flex items-center text-xs">
        <FaArrowDown size={9} className="mr-0.5" />
        {Math.abs(change)}%
      </span>
    );
  }
  return <span className="text-slate-600 text-xs">&mdash;</span>;
}

export const StatCard = ({
  title,
  count,
  duration,
  change,
  durationChange,
  metricMode,
}: {
  title: string;
  count: number;
  duration: number;
  change: number | null;
  durationChange: number | null;
  metricMode: MetricMode;
}) => {
  const isHours = metricMode === 'hours';
  const displayedChange = isHours ? durationChange : change;
  return (
    <div className="flex-1 text-center px-1">
      <p className="text-xs text-slate-500 uppercase tracking-wider">{title}</p>
      <p className="text-xl font-bold text-slate-100 leading-tight">
        {isHours ? formatTimeCompact(duration) : count}
      </p>
      <ChangeIndicator change={displayedChange} />
    </div>
  );
};
