/**
 * Design-token references for use from TypeScript (e.g. inline SVG, canvas). These are
 * `var(--token)` strings, not resolved colours — resolution happens in CSS under
 * [data-theme] so nothing here needs to know the current theme.
 *
 * The Tailwind preset lives in ./tailwind-preset.cjs and the CSS variables in ./theme.css.
 */

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** The user's persisted appearance preference. 'system' opts in to prefers-color-scheme. */
export const APPEARANCE_CHOICES = ['light', 'dark', 'system'] as const;
export type Appearance = (typeof APPEARANCE_CHOICES)[number];

/** localStorage key read by the inline bootstrap in index.html. Keep in sync with that script. */
export const THEME_STORAGE_KEY = 'werf-theme';

export const token = {
  color: {
    ink: 'var(--soil-900)',
    surface: 'var(--sand-50)',
    tile: 'var(--sand-100)',
    action: 'var(--ochre-500)',
    blocked: 'var(--rooigrond-600)',
    warning: 'var(--klei-700)',
    clear: 'var(--aloe-700)',
    pending: 'var(--dam-700)',
  },
  font: {
    ui: 'var(--font-ui)',
    data: 'var(--font-data)',
  },
} as const;
