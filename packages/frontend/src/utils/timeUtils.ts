import {
  MILLISECONDS_PER_MINUTE,
  MILLISECONDS_PER_SECOND,
} from '../constants/time';

export const formatTime = (ms: number) => {
  const minutes = Math.floor(ms / MILLISECONDS_PER_MINUTE);
  const seconds = Math.floor(
    (ms % MILLISECONDS_PER_MINUTE) / MILLISECONDS_PER_SECOND
  );
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export const formatTimeWithUnit = (ms: number) => {
  const minutes = Math.floor(ms / MILLISECONDS_PER_MINUTE);
  const seconds = Math.floor(
    (ms % MILLISECONDS_PER_MINUTE) / MILLISECONDS_PER_SECOND
  );
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 99) {
    return `${days}d`;
  }
  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else {
    return `${minutes}m ${seconds}s`;
  }
};
