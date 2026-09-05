import type { ReactNode } from 'react';

export const ToggleSwitch = ({
  id,
  checked,
  onChange,
  label,
  icon,
  labelAccessory,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  icon?: ReactNode;
  labelAccessory?: ReactNode;
  disabled?: boolean;
}) => (
  <div className="flex items-center justify-between w-full gap-3">
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {icon ? (
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-slate-800/80 text-slate-400">
          {icon}
        </span>
      ) : null}
      <label
        htmlFor={id}
        className={`min-w-0 text-sm font-medium ${disabled ? 'text-gray-500' : 'text-ink'}`}
      >
        {label}
      </label>
      {labelAccessory}
    </div>
    <div className="relative inline-block w-12 h-6 shrink-0">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={e => !disabled && onChange(e.target.checked)}
        disabled={disabled}
        className="opacity-0 w-0 h-0"
      />
      <span
        className={`absolute top-0 left-0 right-0 bottom-0 rounded-full transition-colors duration-200 ease-in border ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${
          checked
            ? 'bg-indigo-600/50 border-indigo-500/30'
            : 'bg-slate-700/50 border-slate-600/30'
        }`}
        onClick={() => !disabled && onChange(!checked)}
      >
        <span
          className={`absolute w-4 h-4 bg-white/90 rounded-full transition-transform duration-200 ease-in transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          } top-1 left-0`}
        ></span>
      </span>
    </div>
  </div>
);
