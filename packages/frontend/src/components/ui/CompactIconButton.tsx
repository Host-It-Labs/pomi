import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Button } from './Button';

type CompactIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  variant: 'primary' | 'secondary';
  children: ReactNode;
};

export function CompactIconButton({
  children,
  className,
  disabled,
  label,
  title,
  variant,
  ...props
}: CompactIconButtonProps) {
  const tooltipLabel = title ?? label;

  return (
    <Button
      {...props}
      type={props.type ?? 'button'}
      disabled={disabled}
      aria-label={label}
      title={tooltipLabel}
      size="xs"
      variant={variant}
      className={clsx('relative h-8 w-8 shrink-0 rounded-lg p-0', className)}
    >
      {children}
    </Button>
  );
}
