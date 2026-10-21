import clsx from 'clsx';
import { type ButtonHTMLAttributes } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: 'primary' | 'secondary' | 'success';
  size?: 'sm' | 'md' | 'lg';
}

export function IconButton({
  children,
  className,
  label,
  variant = 'primary',
  size = 'md',
  disabled,
  title,
  ...props
}: IconButtonProps) {
  const tooltipLabel = title ?? label;
  const sizeClasses = {
    sm: 'p-2 text-xs',
    md: 'p-3 text-sm',
    lg: 'p-4 text-base',
  };

  return (
    <button
      {...props}
      disabled={disabled}
      aria-label={label}
      title={tooltipLabel}
      className={clsx(
        'relative z-10 inline-flex cursor-pointer items-center justify-center transition-[background-color,color,transform] duration-150',
        'focus:outline-none focus-visible:ring-2 active:scale-95',
        variant === 'primary' ? 'rounded-full' : 'rounded-[10px]',
        sizeClasses[size],
        {
          'bg-indigo-500 text-on-accent hover:bg-indigo-400 focus-visible:ring-indigo-400/50':
            variant === 'primary' && !disabled,
          'bg-transparent text-slate-400 hover:bg-white/[0.07] hover:text-ink focus-visible:ring-slate-400/40':
            variant === 'secondary' && !disabled,
          'bg-emerald-500 text-slate-950 hover:bg-emerald-400 focus-visible:ring-emerald-400/50':
            variant === 'success' && !disabled,
          'cursor-not-allowed bg-transparent text-slate-500 opacity-40 active:scale-100':
            disabled,
        },
        className
      )}
    >
      {children}
    </button>
  );
}
