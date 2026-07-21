import { useCallback, useEffect, useState } from 'react';

/**
 * PWA install (FR-007). The browser fires `beforeinstallprompt` only after its own engagement
 * heuristics say the app is worth installing — never on first paint — so capturing it and
 * offering a custom, dismissible affordance is the "right moment". We stash the event and
 * trigger the native prompt on the user's tap; a dismissal is remembered so we do not nag.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'werf-install-dismissed';

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export interface UseInstallPrompt {
  /** True only when the browser offered install, the user hasn't dismissed, and it isn't installed. */
  canInstall: boolean;
  /** Trigger the native install prompt. No-op if nothing is deferred. */
  promptInstall: () => Promise<void>;
  /** Hide the affordance and remember the choice. */
  dismiss: () => void;
}

export function useInstallPrompt(): UseInstallPrompt {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(wasDismissed);
  const [installed, setInstalled] = useState<boolean>(false);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      // Keep the browser's default mini-infobar from showing; we present our own.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    // The event can only be used once; drop it whatever the outcome.
    setDeferred(null);
  }, [deferred]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Non-fatal: it just reappears next session.
    }
  }, []);

  return {
    canInstall: deferred !== null && !dismissed && !installed,
    promptInstall,
    dismiss,
  };
}
