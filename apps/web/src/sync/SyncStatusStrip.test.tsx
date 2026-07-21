import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithLocale } from '../test-utils';
import { SyncStatusStrip } from './SyncStatusStrip';

describe('SyncStatusStrip (FR-009)', () => {
  it('says work is saved and sent while online', () => {
    renderWithLocale(<SyncStatusStrip />);
    expect(screen.getByText('Saved and sent')).toBeTruthy();
  });

  it('shows the critical offline reassurance and never the word "sync"', () => {
    renderWithLocale(<SyncStatusStrip />);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText('Offline — your work is saved')).toBeTruthy();
    expect(screen.queryByText(/sync/i)).toBeNull();
  });

  it('is a polite live region so it announces without interrupting', () => {
    renderWithLocale(<SyncStatusStrip />);
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
