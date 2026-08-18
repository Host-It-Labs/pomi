import { isMac } from './osUtils';

export const getModifierKeyLabel = () => {
  return isMac ? '⌘' : 'Ctrl';
};

export const getShortcutLabel = (keys: string[]) => {
  return [getModifierKeyLabel(), ...keys].join(' + ');
};

export const shouldIgnoreModalLocalShortcut = (event: KeyboardEvent) => {
  return event.repeat || event.altKey || event.shiftKey;
};
