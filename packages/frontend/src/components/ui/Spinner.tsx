import clsx from 'clsx';

type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg';

interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
}

export function Spinner({ size, className }: SpinnerProps) {
  const resolvedSize = size ?? 'md';
  const sizeClasses = {
    xs: 'h-3 w-3 border-2',
    sm: 'h-4 w-4 border-2',
    md: 'h-6 w-6 border-[3px]',
    lg: 'h-8 w-8 border-[3px]',
  };

  return (
    <span
      className={clsx(
        'inline-block animate-spin rounded-full border-transparent border-t-current border-r-current',
        sizeClasses[resolvedSize],
        className
      )}
      aria-hidden="true"
    />
  );
}
