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
  // Shown only when the account could not be told (no signal). Not an error: the app IS in the
  // chosen language. It says what is true, and answers the next question before it is asked.
  'settings.language.deviceOnly':
    'This phone is in the language you chose. Your account will catch up next time you have signal.',
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
  // ── Terminology (i18n/terminology.ts) ────────────────────────────────────────────────
  // The word this farm uses for a concept. The TERM is chosen by what the farm farms; the WORD
  // for it lives here, once, so a tile and the first-run guide can never disagree — and so the
  // labels are translatable at all, which they were not while tiles.ts held English strings.
  // Collective/label form: this is what a tile carries.
  'term.camp': 'Camps',
  'term.block': 'Blocks',
  'term.herd': 'Herd',
  'term.flock': 'Flock',
  'term.livestock': 'Livestock',
  // Home-grid tiles that carry no terminology decision — the same word on every farm, but a
  // word in the farmer's LANGUAGE, which is the other half of the Phase 1 vocabulary fork.
  'tile.health': 'Health',
  'tile.sprays': 'Sprays',
  'tile.harvest': 'Harvest',
  'tile.labour': 'Labour',
  'tile.money': 'Money',
  'tile.compliance': 'Compliance',
  'module.comingSoon': 'This part of the farm arrives in a later phase.',
  'module.notFound.title': 'Not found',
  'module.notFound.body': 'There is nothing here.',
  'home.back': 'Back to home',
  // Animals module (FR-101, FR-705). Captured offline; "head" is the count word a farmer uses.
  'animals.title': 'Animals',
  'animals.head': 'head',
  'animals.allHerds': 'All herds',
  'animals.herdFilter': 'Show herd',
  'animals.empty': 'No animals recorded yet. Record your first one — it saves with no signal.',
  'animals.add': 'Record an animal',
  'animals.new.title': 'Record an animal',
  // FR-113: an animal (and every event on it) is filed under the herd it belongs to.
  'animals.new.herd': 'Herd',
  'animals.new.species': 'Species',
  'animals.new.sex': 'Sex',
  'animals.new.breed': 'Breed (optional)',
  'animals.new.save': 'Save animal',
  'animals.new.saved': 'Saved — your work is saved',
  'animals.new.another': 'Record another',
  'animals.new.done': 'Done',
  'animals.weigh': 'Weigh session',
  'animals.loss': 'Record a loss',
  // Recording a loss (FR-105). A death is an event, not an edit; the animal is retained forever
  // and just excluded from live counts. Sale/cull/missing follow the same shape (later slices).
  'loss.title': 'Record a loss',
  'loss.pick': 'Which animal?',
  'loss.outcome': 'What happened?',
  'loss.died': 'Died',
  'loss.sold': 'Sold',
  'loss.cause': 'Cause',
  'loss.counterparty': 'Buyer',
  'loss.price': 'Price (R)',
  'loss.save': 'Record death',
  'loss.saveSale': 'Record sale',
  'loss.savedSuffix': 'recorded — marked dead',
  'loss.savedSuffixSold': 'recorded — marked sold',
  'loss.empty': 'No live animals to record a loss against.',
  'loss.back': 'Back to animals',
  // Animal status, in the farmer's words. Shown as a marker on a retained (non-live) animal.
  'status.alive': 'Alive',
  'status.missing': 'Missing',
  'status.culled': 'Culled',
  'status.sold': 'Sold',
  'status.dead': 'Dead',
  // Weigh session (FR-140/141/142). Crush-optimised: one animal, one number, Save & next.
  'weigh.title': 'Weigh session',
  'weigh.of': 'of',
  'weigh.last': 'Last weight',
  'weigh.kg': 'Weight (kg)',
  'weigh.kgUnit': 'kg',
  'weigh.perDay': 'kg/day',
  'weigh.save': 'Save & next',
  'weigh.saved': 'Saved',
  'weigh.skip': 'Skip this one',
  'weigh.back': 'Back to animals',
  'weigh.empty': 'No animals to weigh yet. Record one first — it saves with no signal.',
  'weigh.emptyAction': 'Record an animal',
  'weigh.done.count': 'weighed',
  'weigh.done.link': 'Done',
  // Species and sex, in the farmer's words rather than the enum's.
  'species.cattle': 'Cattle',
  'species.sheep': 'Sheep',
  'species.goat': 'Goats',
  'species.pig': 'Pigs',
  'species.poultry': 'Poultry',
  'species.game': 'Game',
  'sex.male': 'Male',
  'sex.female': 'Female',
  'sex.castrated': 'Castrated',
  'sex.unknown': 'Unknown',
  // Rainfall (FR-213). A farm fact, not a livestock one — grazing and cropping both read it, so
  // the copy says "the farm", never "the herd". The DAY is asked for because the reading is
  // usually yesterday's: a gauge read on Sunday is captured on Monday.
  'rain.record': 'Record rainfall',
  'rain.title': 'Rainfall',
  'rain.mm': 'How much (mm)',
  'rain.mmUnit': 'mm',
  'rain.day': 'When was the gauge read?',
  'rain.gauge': 'Which gauge (optional)',
  'rain.save': 'Save reading',
  'rain.saved': 'saved — your work is saved',
  'rain.back': 'Back to home',
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
  'settings.language.deviceOnly':
    'Hierdie foon is in die taal wat jy gekies het. Jou rekening sal bykom sodra jy weer sein het.',
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
  'term.camp': 'Kampe',
  'term.block': 'Blokke',
  // Afrikaans uses one word for both a herd and a flock — which is exactly why the token, not
  // the English word, is what the lookup returns.
  'term.herd': 'Trop',
  'term.flock': 'Trop',
  'term.livestock': 'Vee',
  'tile.health': 'Gesondheid',
  'tile.sprays': 'Bespuiting',
  'tile.harvest': 'Oes',
  'tile.labour': 'Arbeid',
  'tile.money': 'Geld',
  'tile.compliance': 'Nakoming',
  'module.comingSoon': 'Hierdie deel van die plaas kom in ’n latere fase.',
  'module.notFound.title': 'Nie gevind nie',
  'module.notFound.body': 'Daar is niks hier nie.',
  'home.back': 'Terug na tuis',
  'animals.title': 'Diere',
  'animals.head': 'stuks',
  'animals.allHerds': 'Alle troppe',
  'animals.herdFilter': 'Wys trop',
  'animals.empty':
    'Nog geen diere aangeteken nie. Teken jou eerste een aan — dit stoor sonder sein.',
  'animals.add': 'Teken ’n dier aan',
  'animals.new.title': 'Teken ’n dier aan',
  'animals.new.herd': 'Trop',
  'animals.new.species': 'Spesie',
  'animals.new.sex': 'Geslag',
  'animals.new.breed': 'Ras (opsioneel)',
  'animals.new.save': 'Stoor dier',
  'animals.new.saved': 'Gestoor — jou werk is gestoor',
  'animals.new.another': 'Teken nog een aan',
  'animals.new.done': 'Klaar',
  'animals.weigh': 'Weegsessie',
  'animals.loss': 'Teken ’n verlies aan',
  'loss.title': 'Teken ’n verlies aan',
  'loss.pick': 'Watter dier?',
  'loss.outcome': 'Wat het gebeur?',
  'loss.died': 'Gevrek',
  'loss.sold': 'Verkoop',
  'loss.cause': 'Oorsaak',
  'loss.counterparty': 'Koper',
  'loss.price': 'Prys (R)',
  'loss.save': 'Teken vrektes aan',
  'loss.saveSale': 'Teken verkoop aan',
  'loss.savedSuffix': 'aangeteken — as dood gemerk',
  'loss.savedSuffixSold': 'aangeteken — as verkoop gemerk',
  'loss.empty': 'Geen lewende diere om ’n verlies teen aan te teken nie.',
  'loss.back': 'Terug na diere',
  'status.alive': 'Lewend',
  'status.missing': 'Vermis',
  'status.culled': 'Uitgeskot',
  'status.sold': 'Verkoop',
  'status.dead': 'Dood',
  'weigh.title': 'Weegsessie',
  'weigh.of': 'van',
  'weigh.last': 'Laaste gewig',
  'weigh.kg': 'Gewig (kg)',
  'weigh.kgUnit': 'kg',
  'weigh.perDay': 'kg/dag',
  'weigh.save': 'Stoor & volgende',
  'weigh.saved': 'Gestoor',
  'weigh.skip': 'Slaan hierdie een oor',
  'weigh.back': 'Terug na diere',
  'weigh.empty': 'Nog geen diere om te weeg nie. Teken eers een aan — dit stoor sonder sein.',
  'weigh.emptyAction': 'Teken ’n dier aan',
  'weigh.done.count': 'geweeg',
  'weigh.done.link': 'Klaar',
  'species.cattle': 'Beeste',
  'species.sheep': 'Skape',
  'species.goat': 'Bokke',
  'species.pig': 'Varke',
  'species.poultry': 'Pluimvee',
  'species.game': 'Wild',
  'sex.male': 'Manlik',
  'sex.female': 'Vroulik',
  'sex.castrated': 'Gekastreer',
  'sex.unknown': 'Onbekend',
  'rain.record': 'Teken reënval aan',
  'rain.title': 'Reënval',
  'rain.mm': 'Hoeveel (mm)',
  'rain.mmUnit': 'mm',
  'rain.day': 'Wanneer is die meter gelees?',
  'rain.gauge': 'Watter meter (opsioneel)',
  'rain.save': 'Stoor lesing',
  'rain.saved': 'gestoor — jou werk is gestoor',
  'rain.back': 'Terug na tuis',
};

export const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
  'en-ZA': en,
  'af-ZA': af,
};
