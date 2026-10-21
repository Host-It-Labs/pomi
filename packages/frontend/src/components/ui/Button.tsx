import clsx from 'clsx';
import { type ButtonHTMLAttributes } from 'react';
import { useI18n } from '../../i18n';
import { Spinner } from './Spinner.tsx';

type ButtonVariant =
  'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'link';

type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  loadingText?: string;
}

export function Button({
  variant,
  size,
  isLoading,
  loadingText,
  className,
  children,
  type,
  disabled,
  ...props
}: ButtonProps) {
  const { t } = useI18n();
  const resolvedVariant = variant ?? 'primary';
  const resolvedSize = size ?? 'md';
  const showLoading = Boolean(isLoading);
  const resolvedType = type ?? 'button';

  const sizeClasses = {
    xs: 'px-2 py-1 text-xs rounded-lg',
    sm: 'px-3 py-1.5 text-sm rounded-[10px]',
    md: 'px-4 py-2 text-sm rounded-[11px]',
    lg: 'px-5 py-3 text-base rounded-xl',
  };

  const variantClasses = {
    primary: 'bg-indigo-500 font-semibold text-on-accent hover:bg-indigo-400',
    secondary:
      'bg-white/[0.06] text-slate-200 hover:bg-white/[0.1] hover:text-ink',
    ghost: 'bg-transparent text-slate-300 hover:bg-white/[0.06] hover:text-ink',
    danger: 'bg-red-500/15 text-red-300 hover:bg-red-500/25',
    outline:
      'border border-white/[0.1] text-slate-200 hover:bg-white/[0.05] hover:border-white/[0.16]',
    link: 'bg-transparent text-indigo-300 hover:text-indigo-200',
  };

  return (
    <button
      {...props}
      type={resolvedType}
      disabled={disabled || showLoading}
      className={clsx(
        'relative inline-flex cursor-pointer items-center justify-center font-medium transition-[background-color,color,border-color,transform] duration-150 active:scale-[0.98]',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        sizeClasses[resolvedSize],
        variantClasses[resolvedVariant],
        className
      )}
    >
      {showLoading ? (
        <span className="inline-flex items-center gap-2">
          <Spinner size="sm" />
          <span>{loadingText || t('common.loading')}</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}
