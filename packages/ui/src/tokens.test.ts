import { describe, expect, it } from 'vitest';
import { APPEARANCE_CHOICES, THEME_STORAGE_KEY, THEMES, token } from './index';

describe('design tokens', () => {
  it('exposes both themes', () => {
    expect(THEMES).toEqual(['light', 'dark']);
  });

  it('offers a "system" appearance so prefers-color-scheme is opt-in, not default', () => {
    expect(APPEARANCE_CHOICES).toContain('system');
    expect(APPEARANCE_CHOICES[0]).toBe('light');
  });

  it('references tokens as CSS variables, never resolved colours (no theme branching)', () => {
    expect(token.color.action).toBe('var(--ochre-500)');
    expect(token.color.ink).toBe('var(--soil-900)');
  });

  it('names the storage key the inline bootstrap depends on', () => {
    expect(THEME_STORAGE_KEY).toBe('werf-theme');
  });
});
