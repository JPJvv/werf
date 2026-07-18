import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocaleProvider, useTranslation } from './LocaleProvider';

const wrapper = ({ children }: { children: ReactNode }) => (
  <LocaleProvider>{children}</LocaleProvider>
);

describe('useTranslation (FR-008)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('lang');
  });

  it('defaults to English', () => {
    const { result } = renderHook(() => useTranslation(), { wrapper });
    expect(result.current.locale).toBe('en-ZA');
    expect(result.current.t('nav.settings')).toBe('Settings');
  });

  it('switches to Afrikaans, translates, and updates the document language', () => {
    const { result } = renderHook(() => useTranslation(), { wrapper });
    act(() => result.current.setLocale('af-ZA'));
    expect(result.current.t('nav.settings')).toBe('Instellings');
    expect(document.documentElement.getAttribute('lang')).toBe('af-ZA');
  });

  it('persists the choice under the shared locale key', () => {
    const { result } = renderHook(() => useTranslation(), { wrapper });
    act(() => result.current.setLocale('af-ZA'));
    expect(window.localStorage.getItem('werf-locale')).toBe('af-ZA');
  });
});
