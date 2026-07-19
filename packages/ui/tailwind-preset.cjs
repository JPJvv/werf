/**
 * Werf Tailwind preset. Maps Tailwind utilities to the design tokens in theme.css as
 * CSS custom-property references, so `bg-sand-100` resolves to `var(--sand-100)` and
 * automatically re-themes under [data-theme]. Core utilities only — no arbitrary values.
 *
 * Plain CommonJS on purpose: it is required by tailwind.config, which runs under Node
 * before any build step exists.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [],
  theme: {
    // Replace, don't extend, the colour palette — the earth palette is the whole system.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      soil: {
        900: 'var(--soil-900)',
        700: 'var(--soil-700)',
        500: 'var(--soil-500)',
        300: 'var(--soil-300)',
        200: 'var(--soil-200)',
        100: 'var(--soil-100)',
      },
      sand: {
        50: 'var(--sand-50)',
        100: 'var(--sand-100)',
      },
      ochre: {
        500: 'var(--ochre-500)',
        600: 'var(--ochre-600)',
        100: 'var(--ochre-100)',
      },
      // The ink for text sitting ON an ochre action. `text-soil-900` is the PAGE ink and
      // inverts with the theme; the ochre beneath it does not, so the two drift apart in
      // dark mode. Use `text-on-action` on a filled action, never `text-soil-900`.
      'on-action': 'var(--on-action)',
      rooigrond: {
        600: 'var(--rooigrond-600)',
        100: 'var(--rooigrond-100)',
      },
      klei: {
        700: 'var(--klei-700)',
        100: 'var(--klei-100)',
      },
      aloe: {
        700: 'var(--aloe-700)',
        100: 'var(--aloe-100)',
      },
      dam: {
        700: 'var(--dam-700)',
        100: 'var(--dam-100)',
      },
    },
    borderRadius: {
      none: '0',
      DEFAULT: 'var(--radius)',
      full: '9999px',
    },
    fontFamily: {
      ui: 'var(--font-ui)',
      data: 'var(--font-data)',
    },
    fontSize: {
      display: ['var(--t-display)', { lineHeight: '38px', fontWeight: '600' }],
      h1: ['var(--t-h1)', { lineHeight: '30px', fontWeight: '600' }],
      h2: ['var(--t-h2)', { lineHeight: '26px', fontWeight: '600' }],
      body: ['var(--t-body)', { lineHeight: '24px' }],
      label: ['var(--t-label)', { lineHeight: '18px', fontWeight: '600', letterSpacing: '0.04em' }],
      tile: ['var(--t-tile)', { lineHeight: '22px', fontWeight: '600' }],
      'data-lg': ['var(--t-data-lg)', { lineHeight: '32px', fontWeight: '500' }],
      data: ['var(--t-data)', { lineHeight: '24px' }],
    },
    extend: {
      spacing: {
        1: 'var(--s-1)',
        2: 'var(--s-2)',
        3: 'var(--s-3)',
        4: 'var(--s-4)',
        5: 'var(--s-5)',
        6: 'var(--s-6)',
        7: 'var(--s-7)',
        8: 'var(--s-8)',
        10: 'var(--s-10)',
        12: 'var(--s-12)',
        'touch-min': 'var(--touch-min)',
        'touch-primary': 'var(--touch-primary)',
        'tile-min': 'var(--tile-min)',
      },
      minHeight: {
        'touch-min': 'var(--touch-min)',
        'touch-primary': 'var(--touch-primary)',
        'tile-min': 'var(--tile-min)',
      },
      minWidth: {
        'touch-min': 'var(--touch-min)',
      },
      transitionTimingFunction: {
        werf: 'var(--ease)',
      },
      transitionDuration: {
        fast: 'var(--dur-fast)',
        base: 'var(--dur-base)',
      },
    },
  },
  plugins: [],
};
