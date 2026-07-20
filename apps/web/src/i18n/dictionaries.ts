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
  // PWA install. Offered after the browser signals the app is install-worthy (never on
  // first paint, FR-007) and dismissible — a farmer decides, we don't nag.
  'install.title': 'Install Werf on this phone',
  'install.body': 'Open it from your home screen, and it works offline.',
  'install.action': 'Install',
  'install.dismiss': 'Not now',
  // Sign-in and onboarding. Errors say what happened and what to do next — never
  // "Validation error", never an apology, never blaming the network.
  'auth.signIn.title': 'Sign in',
  'auth.signIn.email': 'Email address',
  'auth.signIn.password': 'Password',
  'auth.signIn.submit': 'Sign in',
  'auth.signIn.working': 'Signing in…',
  'auth.signIn.noAccount': 'Setting up a new farm business?',
  'auth.signIn.register': 'Register',
  'auth.signIn.failed': 'That email address and password do not match. Check both and try again.',
  'auth.signIn.offline':
    'Could not reach the server. Signing in needs a connection — your saved work is safe in the meantime.',
  'auth.signIn.problem': 'Something went wrong signing you in. Try again.',
  // The second factor. "Passkey" and "TOTP" are our words, not a farmer's.
  'auth.secondFactor.title': 'One more step',
  'auth.secondFactor.body': 'Enter the 6-digit code from your authenticator app.',
  'auth.secondFactor.code': 'Code',
  'auth.secondFactor.submit': 'Continue',
  'auth.secondFactor.useRecovery': 'Use a recovery code instead',
  'auth.secondFactor.useCode': 'Use my authenticator app instead',
  'auth.secondFactor.recoveryBody':
    'Enter one of the recovery codes you printed and put in the safe.',
  'auth.secondFactor.recoveryLabel': 'Recovery code',
  'auth.secondFactor.failed':
    'That code was not right. Codes change every 30 seconds — try the current one.',
  'auth.secondFactor.expired': 'That took too long. Sign in again to get a new code prompt.',
  // Registration / onboarding (FR-001, FR-002).
  'onboarding.title': 'Set up your farm business',
  'onboarding.business.legend': 'Your business',
  'onboarding.business.name': 'Business name',
  'onboarding.business.registration': 'Registration number (optional)',
  'onboarding.farm.legend': 'Your first farm',
  'onboarding.farm.name': 'Farm name',
  'onboarding.farm.province': 'Province',
  'onboarding.farm.district': 'District (optional)',
  'onboarding.owner.legend': 'You',
  'onboarding.owner.name': 'Your full name',
  'onboarding.enterprises.legend': 'What do you farm?',
  'onboarding.enterprises.hint':
    'Choose everything that applies. You can add or remove these later.',
  'onboarding.submit': 'Create my farm',
  'onboarding.working': 'Setting things up…',
  'onboarding.haveAccount': 'Already registered?',
  'onboarding.emailTaken': 'That email address already has an account. Sign in instead.',
  'onboarding.needEnterprise': 'Choose at least one — the app adapts to what you farm.',
  'onboarding.passwordTooShort': 'Use at least 12 characters. Length matters more than symbols.',
  // Mandatory second-factor enrolment (FR-014).
  'security.enrol.title': 'Protect this account',
  'security.enrol.body':
    'You own this business, so this account needs a second step at sign-in. It works with no signal.',
  'security.enrol.step1': 'Open your authenticator app and add a new account.',
  'security.enrol.step2': 'Enter the 6-digit code it shows, to prove it arrived.',
  'security.enrol.openApp': 'Open my authenticator app',
  'security.enrol.secret': 'Or type this in by hand',
  'security.enrol.confirm': 'Confirm',
  'security.enrol.failed': 'Could not set this up just now. Try again.',
  'security.recovery.title': 'Write these down',
  'security.recovery.body':
    'Ten codes, each usable once, for the day the phone is gone. Print them and put them in the safe.',
  'security.recovery.warning': 'This is the only time these are shown. We cannot show them again.',
  'security.recovery.done': 'I have saved them',
  // Shown when the account already had recovery codes from an earlier factor. Never
  // implies the old page is dead — it is not, and that is the entire message.
  'security.recovery.keptTitle': 'Your recovery codes still work',
  'security.recovery.keptBody':
    'You already have ten recovery codes from when you set up your first sign-in method. They have not changed. The page you printed is still the one to keep.',
  'security.recovery.keptWarning':
    'If you cannot find them, sign in and set up a new sign-in method to get a fresh set.',
  'security.recovery.keptDone': 'Continue',
  'security.signOut': 'Sign out',
  // Guided first run (FR-010).
  'firstRun.title': 'Get started',
  'firstRun.body': 'Three things worth doing first. Each takes a minute.',
  'firstRun.land.animals': 'Add your first camp',
  'firstRun.land.crops': 'Add your first block',
  'firstRun.stock.animals': 'Record your first animal',
  'firstRun.stock.crops': 'Record your first planting',
  'firstRun.people': 'Add your first employee',
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
  'install.title': 'Installeer Werf op hierdie foon',
  'install.body': 'Maak dit oop van jou tuisskerm af, en dit werk aflyn.',
  'install.action': 'Installeer',
  'install.dismiss': 'Nie nou nie',
  'auth.signIn.title': 'Meld aan',
  'auth.signIn.email': 'E-posadres',
  'auth.signIn.password': 'Wagwoord',
  'auth.signIn.submit': 'Meld aan',
  'auth.signIn.working': 'Meld tans aan…',
  'auth.signIn.noAccount': 'Stel jy ’n nuwe boerdery op?',
  'auth.signIn.register': 'Registreer',
  'auth.signIn.failed':
    'Daardie e-posadres en wagwoord pas nie bymekaar nie. Kyk na albei en probeer weer.',
  'auth.signIn.offline':
    'Kon nie die bediener bereik nie. Aanmelding het ’n verbinding nodig — jou gestoorde werk is intussen veilig.',
  'auth.signIn.problem': 'Iets het verkeerd geloop met die aanmelding. Probeer weer.',
  'auth.secondFactor.title': 'Nog een stap',
  'auth.secondFactor.body': 'Voer die 6-syfer-kode uit jou verifikasieprogram in.',
  'auth.secondFactor.code': 'Kode',
  'auth.secondFactor.submit': 'Gaan voort',
  'auth.secondFactor.useRecovery': 'Gebruik eerder ’n herstelkode',
  'auth.secondFactor.useCode': 'Gebruik eerder my verifikasieprogram',
  'auth.secondFactor.recoveryBody':
    'Voer een van die herstelkodes in wat jy gedruk en in die kluis gesit het.',
  'auth.secondFactor.recoveryLabel': 'Herstelkode',
  'auth.secondFactor.failed':
    'Daardie kode was nie reg nie. Kodes verander elke 30 sekondes — probeer die huidige een.',
  'auth.secondFactor.expired': 'Dit het te lank geneem. Meld weer aan vir ’n nuwe kode-versoek.',
  'onboarding.title': 'Stel jou boerdery op',
  'onboarding.business.legend': 'Jou besigheid',
  'onboarding.business.name': 'Besigheidsnaam',
  'onboarding.business.registration': 'Registrasienommer (opsioneel)',
  'onboarding.farm.legend': 'Jou eerste plaas',
  'onboarding.farm.name': 'Plaasnaam',
  'onboarding.farm.province': 'Provinsie',
  'onboarding.farm.district': 'Distrik (opsioneel)',
  'onboarding.owner.legend': 'Jy',
  'onboarding.owner.name': 'Jou volle naam',
  'onboarding.enterprises.legend': 'Wat boer jy?',
  'onboarding.enterprises.hint':
    'Kies alles wat van toepassing is. Jy kan dit later byvoeg of verwyder.',
  'onboarding.submit': 'Skep my plaas',
  'onboarding.working': 'Stel tans op…',
  'onboarding.haveAccount': 'Reeds geregistreer?',
  'onboarding.emailTaken': 'Daardie e-posadres het reeds ’n rekening. Meld eerder aan.',
  'onboarding.needEnterprise': 'Kies ten minste een — die app pas aan by wat jy boer.',
  'onboarding.passwordTooShort': 'Gebruik ten minste 12 karakters. Lengte tel meer as simbole.',
  'security.enrol.title': 'Beskerm hierdie rekening',
  'security.enrol.body':
    'Jy besit hierdie besigheid, so hierdie rekening het ’n tweede stap by aanmelding nodig. Dit werk sonder sein.',
  'security.enrol.step1': 'Maak jou verifikasieprogram oop en voeg ’n nuwe rekening by.',
  'security.enrol.step2': 'Voer die 6-syfer-kode in wat dit wys, om te bewys dit het aangekom.',
  'security.enrol.openApp': 'Maak my verifikasieprogram oop',
  'security.enrol.secret': 'Of tik dit met die hand in',
  'security.enrol.confirm': 'Bevestig',
  'security.enrol.failed': 'Kon dit nie nou opstel nie. Probeer weer.',
  'security.recovery.title': 'Skryf hierdie neer',
  'security.recovery.body':
    'Tien kodes, elkeen een keer bruikbaar, vir die dag wanneer die foon weg is. Druk hulle en sit hulle in die kluis.',
  'security.recovery.warning':
    'Dit is die enigste keer wat hierdie gewys word. Ons kan hulle nie weer wys nie.',
  'security.recovery.done': 'Ek het hulle gestoor',
  'security.recovery.keptTitle': 'Jou herstelkodes werk steeds',
  'security.recovery.keptBody':
    'Jy het reeds tien herstelkodes van toe jy jou eerste aanmeldmetode opgestel het. Hulle het nie verander nie. Die bladsy wat jy gedruk het, is steeds die een om te hou.',
  'security.recovery.keptWarning':
    'As jy hulle nie kan kry nie, meld aan en stel ’n nuwe aanmeldmetode op vir ’n vars stel.',
  'security.recovery.keptDone': 'Gaan voort',
  'security.signOut': 'Meld af',
  'firstRun.title': 'Kom ons begin',
  'firstRun.body': 'Drie dinge om eerste te doen. Elkeen vat ’n minuut.',
  'firstRun.land.animals': 'Voeg jou eerste kamp by',
  'firstRun.land.crops': 'Voeg jou eerste blok by',
  'firstRun.stock.animals': 'Teken jou eerste dier aan',
  'firstRun.stock.crops': 'Teken jou eerste aanplanting aan',
  'firstRun.people': 'Voeg jou eerste werknemer by',
  'module.comingSoon': 'Hierdie deel van die plaas kom in ’n latere fase.',
  'module.notFound.title': 'Nie gevind nie',
  'module.notFound.body': 'Daar is niks hier nie.',
  'home.back': 'Terug na tuis',
};

export const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
  'en-ZA': en,
  'af-ZA': af,
};
