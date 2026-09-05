import { forwardRef, InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  variant?: 'default' | 'centered';
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ variant = 'default', className = '', ...props }, ref) => {
    const baseStyles =
      'w-full bg-slate-800/40 text-ink border border-slate-700/40 rounded px-3 py-2 focus:outline-none focus:border-indigo-500/50 transition-colors';
    const centeredStyles = variant === 'centered' ? 'text-center' : '';
    const combinedStyles =
      `${baseStyles} ${centeredStyles} ${className}`.trim();

    return <input ref={ref} className={combinedStyles} {...props} />;
  }
);

Input.displayName = 'Input';
