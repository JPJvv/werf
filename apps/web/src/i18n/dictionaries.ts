/**
 * Translations (FR-008). English and Afrikaans in v1. Locale is per USER, not per farm or
 * per browser (the schema stores it on the user row); this module is the client dictionary
 * and switch. Jurisdiction is a separate axis entirely — a farm's law is ZA regardless of
 * which language its owner reads the app in.
 *
 * Dictionaries are static objects, loaded synchronously: an offline-first app cannot fetch a
 * language pack in a signal dead zone. English is the source of truth for the key set; the
 * Afrikaans map is typed to require exactly the same keys, so a missing translation fails the
 * build, never ships as a blank string.
 */

export const LOCALES = ['en-ZA', 'af-ZA'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en-ZA';

/** Human-readable, in-language names for the language picker. */
export const LOCALE_NAMES: Record<Locale, string> = {
  'en-ZA': 'English',
  'af-ZA': 'Afrikaans',
};

const en = {
  'nav.settings': 'Settings',
  'settings.appearance.title': 'Appearance',
  'settings.appearance.theme': 'Theme',
  'settings.appearance.light': 'Light',
  'settings.appearance.light.hint': 'Best in the sun. The default.',
  'settings.appearance.dark': 'Dark',
  'settings.appearance.dark.hint': 'Easier on the eyes at night.',
  'settings.appearance.system': 'Match my phone',
  'settings.appearance.system.hint': 'Follow your phone’s day/night setting.',
  'settings.language.title': 'Language',
  'settings.language.legend': 'Language',
  // Sync-status strip. Never the word "sync" to a farmer — "saved" and "sent". The offline
  // line is the most important string in the product: a farmer unsure their entry survived
  // keeps a paper backup, and then the app is extra work. See .claude/rules/frontend.md.
  'sync.status.label': 'Save status',
  'sync.synced': 'Saved and sent',
  'sync.offline': 'Offline — your work is saved',
  'sync.syncing': 'Sending…',
  'sync.error': 'Not sent — will retry',
  'sync.toSend': 'to send',
  'module.comingSoon': 'This part of the farm arrives in a later phase.',
  'module.notFound.title': 'Not found',
  'module.notFound.body': 'There is nothing here.',
  'home.back': 'Back to home',
} as const;

export type TranslationKey = keyof typeof en;

const af: Record<TranslationKey, string> = {
  'nav.settings': 'Instellings',
  'settings.appearance.title': 'Voorkoms',
  'settings.appearance.theme': 'Tema',
  'settings.appearance.light': 'Lig',
  'settings.appearance.light.hint': 'Beste in die son. Die verstek.',
  'settings.appearance.dark': 'Donker',
  'settings.appearance.dark.hint': 'Sagter vir die oë snags.',
  'settings.appearance.system': 'Pas by my foon',
  'settings.appearance.system.hint': 'Volg jou foon se dag/nag-instelling.',
  'settings.language.title': 'Taal',
  'settings.language.legend': 'Taal',
  'sync.status.label': 'Stoorstatus',
  'sync.synced': 'Gestoor en gestuur',
  'sync.offline': 'Aflyn — jou werk is gestoor',
  'sync.syncing': 'Stuur tans…',
  'sync.error': 'Nie gestuur nie — sal weer probeer',
  'sync.toSend': 'om te stuur',
  'module.comingSoon': 'Hierdie deel van die plaas kom in ’n latere fase.',
  'module.notFound.title': 'Nie gevind nie',
  'module.notFound.body': 'Daar is niks hier nie.',
  'home.back': 'Terug na tuis',
};

export const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
  'en-ZA': en,
  'af-ZA': af,
};
