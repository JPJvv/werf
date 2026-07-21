import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY } from '@werf/ui';
import { useAppearance } from './useAppearance';

describe('useAppearance (FR-016)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to light and does not follow the OS unless asked', () => {
    const { result } = renderHook(() => useAppearance());
    expect(result.current.appearance).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('persists the choice and reflects the resolved theme on <html>', () => {
    const { result } = renderHook(() => useAppearance());
    act(() => result.current.setAppearance('dark'));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('reads a previously stored choice on mount — same key as the pre-paint bootstrap', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const { result } = renderHook(() => useAppearance());
    expect(result.current.appearance).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('stores "system" but resolves it to light when the OS does not prefer dark', () => {
    const { result } = renderHook(() => useAppearance());
    act(() => result.current.setAppearance('system'));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
