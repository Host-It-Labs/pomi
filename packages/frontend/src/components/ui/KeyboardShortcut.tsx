import { useEffect, useState } from 'react';
import { MdKeyboardCommandKey } from 'react-icons/md';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { isDesktop, isMac } from '../../utils/osUtils';

type ModifierSubscriber = (isPressed: boolean) => void;

const modifierSubscribers = new Set<ModifierSubscriber>();
let isModifierPressed = false;
let isModifierListenersAttached = false;

const notifyModifierSubscribers = () => {
  modifierSubscribers.forEach(subscriber => subscriber(isModifierPressed));
};

const setModifierPressed = (pressed: boolean) => {
  if (isModifierPressed === pressed) {
    return;
  }

  isModifierPressed = pressed;
  notifyModifierSubscribers();
};

const ensureModifierListeners = () => {
  if (isModifierListenersAttached || typeof window === 'undefined') {
    return;
  }

  isModifierListenersAttached = true;

  window.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey) {
      setModifierPressed(true);
    }
  });

  window.addEventListener('keyup', event => {
    if (!event.metaKey && !event.ctrlKey) {
      setModifierPressed(false);
    }
  });

  window.addEventListener('blur', () => {
    setModifierPressed(false);
  });
};

export function KeyboardShortcut({
  text,
  showModIcon = true,
  alwaysShow = false,
  position = 'centered',
}: {
  text: string;
  showModIcon?: boolean;
  alwaysShow?: boolean;
  position?: 'topRight' | 'centered' | 'indicator';
}) {
  const preferences = usePreferencesStore.use.preferences();
  const [isCommandPressed, setIsCommandPressed] = useState(isModifierPressed);

  useEffect(() => {
    ensureModifierListeners();

    const subscriber: ModifierSubscriber = pressed => {
      setIsCommandPressed(pressed);
    };

    modifierSubscribers.add(subscriber);
    setIsCommandPressed(isModifierPressed);

    return () => {
      modifierSubscribers.delete(subscriber);
    };
  }, []);

  if (!isDesktop) {
    return null;
  }

  if (!preferences?.keyboardShortcuts) {
    return null;
  }

  if (!alwaysShow && !isCommandPressed) {
    return null;
  }

  const positionClasses =
    position === 'topRight'
      ? 'absolute -top-1 -right-1 z-10'
      : position === 'centered'
        ? 'absolute -top-1.5'
        : 'absolute -top-1 -left-2';

  const isSingleChar = text.length === 1;

  return (
    <div
      className={`${positionClasses} pointer-events-none flex items-center justify-center whitespace-nowrap rounded-sm bg-gray-800 bg-opacity-70 p-0.5 text-[8px] text-gray-100`}
    >
      {showModIcon && !isCommandPressed && isMac && (
        <MdKeyboardCommandKey size={8} />
      )}
      {showModIcon && !isCommandPressed && !isMac && (
        <span className="mr-0.5">Ctrl+</span>
      )}
      <span className={isSingleChar ? 'text-[10px] px-0.5' : ''}>{text}</span>
    </div>
  );
}
