import { forwardRef, InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  variant?: 'default' | 'centered';
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ variant = 'default', className = '', ...props }, ref) => {
    const baseStyles =
      'w-full rounded-[10px] border border-white/[0.08] bg-canvas px-3 py-2 text-ink placeholder:text-slate-500 transition-[border-color,box-shadow] focus:border-indigo-400/60 focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:outline-none';
    const centeredStyles = variant === 'centered' ? 'text-center' : '';
    const combinedStyles =
      `${baseStyles} ${centeredStyles} ${className}`.trim();

    return <input ref={ref} className={combinedStyles} {...props} />;
  }
);

Input.displayName = 'Input';
