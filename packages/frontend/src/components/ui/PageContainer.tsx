import clsx from 'clsx';
import { type ReactNode } from 'react';

type PageContainerSize = 'sm' | 'md' | 'lg';

interface PageContainerProps {
  children: ReactNode;
  size?: PageContainerSize;
  className?: string;
}

export function PageContainer({
  children,
  size,
  className,
}: PageContainerProps) {
  const resolvedSize = size ?? 'md';
  const sizeClasses = {
    sm: 'max-w-2xl',
    md: 'max-w-3xl',
    lg: 'max-w-5xl',
  };

  return (
    <div
      className={clsx(
        'mx-auto w-full px-4',
        sizeClasses[resolvedSize],
        className
      )}
    >
      {children}
    </div>
  );
}
