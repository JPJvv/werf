import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithLocale } from '../test-utils';
import { InstallPrompt } from './InstallPrompt';

type PromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function fireBeforeInstall(): void {
  const event = new Event('beforeinstallprompt') as PromptEvent;
  event.prompt = vi.fn(() => Promise.resolve());
  event.userChoice = Promise.resolve({ outcome: 'accepted' as const });
  window.dispatchEvent(event);
}

describe('InstallPrompt (FR-007)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders nothing on first paint', () => {
    const { container } = renderWithLocale(<InstallPrompt />);
    expect(container.firstChild).toBeNull();
  });

  it('offers Install once the browser signals install-worthiness', () => {
    renderWithLocale(<InstallPrompt />);
    act(() => {
      fireBeforeInstall();
    });
    expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy();
  });

  it('lets the farmer dismiss without nagging', () => {
    renderWithLocale(<InstallPrompt />);
    act(() => {
      fireBeforeInstall();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
  });
});
