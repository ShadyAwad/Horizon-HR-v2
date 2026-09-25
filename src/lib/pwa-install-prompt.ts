import { useSyncExternalStore } from 'react';

export type DeferredInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type InstallPromptSnapshot = {
  installPrompt: DeferredInstallPromptEvent | null;
  isStandalone: boolean;
};

const listeners = new Set<() => void>();
let initialized = false;
let snapshot: InstallPromptSnapshot = { installPrompt: null, isStandalone: false };

function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function publish(next: InstallPromptSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function ensureInstallPromptListener() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  snapshot = { ...snapshot, isStandalone: isStandaloneMode() };

  const displayMode = window.matchMedia('(display-mode: standalone)');
  window.addEventListener('beforeinstallprompt', (event) => {
    // Suppress Chrome's automatic prompt so Stanza can present its own explicit
    // install action. The stored event is consumed only from that user gesture.
    event.preventDefault();
    publish({ ...snapshot, installPrompt: event as DeferredInstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => {
    publish({ installPrompt: null, isStandalone: true });
  });
  displayMode.addEventListener('change', () => {
    publish({ ...snapshot, isStandalone: isStandaloneMode() });
  });
}

function subscribe(listener: () => void) {
  ensureInstallPromptListener();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot(): InstallPromptSnapshot {
  return { installPrompt: null, isStandalone: false };
}

export function useDeferredPwaInstallPrompt() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    ...state,
    requestDeferredInstall,
    clearDeferredInstallPrompt,
  };
}

export async function requestDeferredInstall() {
  const deferred = snapshot.installPrompt;
  if (!deferred) return null;

  // A browser defers each install event for one prompt attempt. Clear it before
  // prompting so two surfaces cannot race to invoke the native dialog.
  publish({ ...snapshot, installPrompt: null });
  await deferred.prompt();
  return deferred.userChoice;
}

export function clearDeferredInstallPrompt() {
  if (snapshot.installPrompt) publish({ ...snapshot, installPrompt: null });
}
