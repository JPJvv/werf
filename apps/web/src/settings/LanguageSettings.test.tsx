import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderWithLocale } from '../test-utils';
import { LanguageSettings } from './LanguageSettings';

describe('LanguageSettings (FR-008)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('lang');
  });

  it('offers English and Afrikaans, each named in its own language', () => {
    renderWithLocale(<LanguageSettings />);
    expect(screen.getByRole('radio', { name: 'English' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Afrikaans' })).toBeTruthy();
  });

  it('switching to Afrikaans re-translates the screen live', () => {
    renderWithLocale(<LanguageSettings />);
    expect(screen.getByRole('heading', { name: 'Language' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Afrikaans' }));
    expect(screen.getByRole('heading', { name: 'Taal' })).toBeTruthy();
  });
});
