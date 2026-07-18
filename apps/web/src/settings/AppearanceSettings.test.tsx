import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY } from '@werf/ui';
import { renderWithLocale } from '../test-utils';
import { AppearanceSettings } from './AppearanceSettings';

describe('AppearanceSettings (FR-016)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('offers Light, Dark and "Match my phone" — never the word "system"', () => {
    renderWithLocale(<AppearanceSettings />);
    expect(screen.getByRole('radio', { name: /light/i })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /dark/i })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /match my phone/i })).toBeTruthy();
    expect(screen.queryByText(/system/i)).toBeNull();
  });

  it('applies and persists the chosen theme immediately', () => {
    renderWithLocale(<AppearanceSettings />);
    fireEvent.click(screen.getByRole('radio', { name: /dark/i }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });
});
