import clsx from 'clsx';

interface PulsingDotProps {
  className?: string;
}

export function PulsingDot({ className }: PulsingDotProps) {
  return (
    <span
      className={clsx(
        'relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-400',
        className
      )}
      aria-hidden="true"
    >
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
    </span>
  );
}
