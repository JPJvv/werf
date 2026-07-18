import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useInstallPrompt } from './useInstallPrompt';

type PromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function fireBeforeInstall(): PromptEvent {
  const event = new Event('beforeinstallprompt') as PromptEvent;
  event.prompt = vi.fn(() => Promise.resolve());
  event.userChoice = Promise.resolve({ outcome: 'accepted' as const });
  window.dispatchEvent(event);
  return event;
}

describe('useInstallPrompt (FR-007)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('offers nothing until the browser signals install-worthiness (never on first paint)', () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.canInstall).toBe(false);
  });

  it('can install once the browser fires beforeinstallprompt', () => {
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      fireBeforeInstall();
    });
    expect(result.current.canInstall).toBe(true);
  });

  it('triggers the native prompt on request and consumes the one-shot event', async () => {
    const { result } = renderHook(() => useInstallPrompt());
    let event!: PromptEvent;
    act(() => {
      event = fireBeforeInstall();
    });
    await act(async () => {
      await result.current.promptInstall();
    });
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(result.current.canInstall).toBe(false);
  });

  it('remembers a dismissal so it does not nag', () => {
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      fireBeforeInstall();
    });
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.canInstall).toBe(false);
    expect(window.localStorage.getItem('werf-install-dismissed')).toBe('1');
  });
});
