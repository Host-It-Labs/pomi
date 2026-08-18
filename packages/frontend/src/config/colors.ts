import { ACCENT_HEX_COLORS } from '@pomi/shared/src/constants';

export type AccentColorType = 'indigo' | 'green' | 'purple' | 'default';

interface ColorSet {
  bg: string;
  text: string;
  secondaryText: string;
  accent: string;
  hover: string;
  border: string;
}

export const COLORS: Record<AccentColorType, ColorSet> = {
  indigo: {
    bg: 'bg-indigo-600/20',
    text: 'text-indigo-500',
    secondaryText: 'text-indigo-400',
    accent: 'accent-indigo-500',
    hover: 'hover:bg-indigo-600/30',
    border: 'border-indigo-500/25',
  },
  green: {
    bg: 'bg-green-600/20',
    text: 'text-green-400',
    secondaryText: 'text-green-400',
    accent: 'accent-green-500',
    hover: 'hover:bg-green-600/30',
    border: 'border-green-500/25',
  },
  purple: {
    bg: 'bg-purple-600/20',
    text: 'text-purple-400',
    secondaryText: 'text-purple-400',
    accent: 'accent-purple-500',
    hover: 'hover:bg-purple-600/30',
    border: 'border-purple-500/25',
  },
  default: {
    bg: 'bg-slate-700/30',
    text: 'text-slate-200',
    secondaryText: 'text-slate-300',
    accent: 'accent-slate-500',
    hover: 'hover:bg-slate-700/40',
    border: 'border-slate-600/30',
  },
};

export const APP_COLORS = {
  background: 'bg-slate-950',
  text: {
    primary: 'text-white',
    secondary: 'text-slate-400',
  },
  button: {
    primary: 'bg-indigo-600 hover:bg-indigo-700',
    secondary: 'bg-slate-700 hover:bg-slate-600',
  },
  loader: {
    primary: 'border-indigo-500',
  },
};

export const HEX_COLORS: Record<AccentColorType, string> = {
  ...ACCENT_HEX_COLORS,
  default: '#111827',
};
