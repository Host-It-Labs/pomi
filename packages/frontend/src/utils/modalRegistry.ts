import { useEffect, useRef } from 'react';
import { isMobile } from './osUtils';

type ModalEntry = {
  id: symbol;
  close: (() => void) | null;
  closeOnEscape: () => boolean;
};

const openModals: ModalEntry[] = [];
let listenersInstalled = false;
let mobileHistoryGuardActive = false;
let suppressNextPopState = false;

export function hasOpenModal() {
  return openModals.length > 0;
}

export function closeTopmostModal() {
  const top = openModals[openModals.length - 1];
  if (!top?.close) return false;
  top.close();
  return true;
}

function pushMobileHistoryGuard() {
  if (!isMobile || mobileHistoryGuardActive || typeof window === 'undefined') {
    return;
  }
  window.history.pushState({ pomiModalGuard: true }, '');
  mobileHistoryGuardActive = true;
}

function installListeners() {
  if (listenersInstalled || typeof window === 'undefined') return;
  listenersInstalled = true;

  window.addEventListener(
    'keydown',
    event => {
      if (event.key !== 'Escape') return;
      const top = openModals[openModals.length - 1];
      if (!top?.close || !top.closeOnEscape()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      top.close();
    },
    true
  );

  window.addEventListener(
    'popstate',
    event => {
      if (!isMobile) return;
      if (suppressNextPopState) {
        suppressNextPopState = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (openModals.length === 0) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      mobileHistoryGuardActive = false;
      closeTopmostModal();
      window.setTimeout(() => {
        if (openModals.length > 0) pushMobileHistoryGuard();
      }, 0);
    },
    true
  );
}

export function registerOpenModal(
  close?: () => void,
  closeOnEscape?: () => boolean
) {
  installListeners();
  const entry: ModalEntry = {
    id: Symbol('open-modal'),
    close: close ?? null,
    closeOnEscape: closeOnEscape ?? (() => false),
  };
  openModals.push(entry);
  pushMobileHistoryGuard();

  return () => {
    const index = openModals.findIndex(candidate => candidate.id === entry.id);
    if (index >= 0) openModals.splice(index, 1);
    if (
      isMobile &&
      openModals.length === 0 &&
      mobileHistoryGuardActive &&
      typeof window !== 'undefined'
    ) {
      suppressNextPopState = true;
      mobileHistoryGuardActive = false;
      window.history.back();
    }
  };
}

export function useOpenModalRegistration(
  isOpen: boolean,
  onClose?: () => void,
  closeOnEscape?: boolean
) {
  const onCloseRef = useRef(onClose);
  const closeOnEscapeRef = useRef(false);
  onCloseRef.current = onClose;
  closeOnEscapeRef.current = closeOnEscape === true;

  useEffect(() => {
    if (!isOpen) return undefined;
    return registerOpenModal(
      () => onCloseRef.current?.(),
      () => closeOnEscapeRef.current
    );
  }, [isOpen]);
}
