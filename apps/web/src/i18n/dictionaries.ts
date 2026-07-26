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
  // The farms this business runs (FR-004). In Settings because adding a farm is a once-a-decade
  // act, and the home grid's fixed tile set is muscle memory it has no claim on.
  'settings.farms.title': 'Farms',
  'settings.farms.current': 'You are here',
  'settings.farms.add': 'Add a farm',
  'settings.farms.notOwner': 'Only the owner of the business can add a farm.',
  // States the situation, never blames the network, and says what to do — a farm is a tenancy
  // root, so it genuinely cannot be created on a phone with no signal.
  'settings.farms.needsSignal':
    'Adding a farm needs a connection, because the farm has to be set up on the server too. Everything else in the app keeps working without one.',
  'settings.farms.failed': 'The farm could not be added just now. Try again.',
  'shell.farm': 'Farm',
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
  // "will retry" would be a lie here: the server refused these and will refuse them again until
  // something about them changes. Everything else the farmer captured has already gone.
  'sync.blocked': 'not sent — needs your attention',
  // The way OUT of that sentence. Saying something of a farmer's is stuck, with nowhere to look,
  // hands them a worry instead of a task.
  'sync.blocked.see': 'See what',
  'notSent.title': 'What needs your attention',
  'notSent.intro':
    'Nothing here is lost — all of it is saved on this phone. The server would not take these as they stand. Fix what it names and they go up on their own; there is nothing to press.',
  'notSent.empty': 'Everything has gone up. Nothing needs you.',
  'notSent.back': 'Back to home',
  'notSent.kind.landUnit': 'A camp or block',
  'notSent.kind.mob': 'A group',
  'notSent.kind.animal': 'An animal',
  'notSent.kind.identifier': 'Tag number',
  'notSent.kind.weight': 'A weight for',
  'notSent.kind.lifecycle': 'A record for',
  'notSent.kind.move': 'A move for',
  'notSent.kind.health': 'A treatment for',
  'notSent.kind.theft': 'A stock-theft report',
  'notSent.kind.rainfall': 'A rainfall reading',
  // Each answers the next question before it is asked. The tag case is separated out because it is
  // far and away the commonest refusal and it has an answer the generic line cannot give.
  'notSent.why.tagTaken':
    'That number is already on another animal. Read it off the animal again, then record it with the right number — this one stays here until you do.',
  'notSent.why.conflict':
    'Something in this one is already recorded against something else. Record it again with the part that clashes changed.',
  'notSent.why.validation':
    'The server would not accept this one as it stands. Record it again, checking the numbers and dates.',
  'notSent.why.notFound':
    'This one points at something the farm does not have — a camp or an animal that was never recorded, or was recorded on another phone. Once that exists, this goes up on its own.',
  'notSent.why.tenancy':
    'This one points at something on a different farm. It cannot go up as it stands. Please tell us about it.',
  'notSent.why.unknown':
    'The server would not take this one and did not say why in a way we can explain. It is safe on this phone. Please tell us about it.',
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
  // The Health tile's attention badge (FR-017/131). Deliberately NOT "N due": a due/overdue count
  // needs a vaccination programme schedule that does not exist yet, and a tile carrying a number
  // the app cannot compute is worse than a tile carrying none.
  'tile.withholding': 'withholding',
  'module.comingSoon': 'This part of the farm arrives in a later phase.',
  'module.notFound.title': 'Not found',
  'module.notFound.body': 'There is nothing here.',
  'home.back': 'Back to home',
  // Land module (FR-150). Every sentence exists twice, once per TERM — a camp and a block are the
  // same row wearing different words, and "Add a camp" is a sentence in Afrikaans too, so it is
  // translated as a sentence rather than assembled from a noun and a verb. `term.camp`/`term.block`
  // above carry the collective label; these carry the sentences.
  'land.add.camp': 'Add a camp',
  'land.add.block': 'Add a block',
  'land.new.camp': 'Add a camp',
  'land.new.block': 'Add a block',
  'land.code.camp': 'Camp name or number',
  'land.code.block': 'Block name or number',
  'land.save.camp': 'Save camp',
  'land.save.block': 'Save block',
  'land.saved.camp': 'saved — your work is saved',
  'land.saved.block': 'saved — your work is saved',
  'land.another.camp': 'Add another camp',
  'land.another.block': 'Add another block',
  'land.empty.camp': 'No camps yet. Add your first one — it saves with no signal.',
  'land.empty.block': 'No blocks yet. Add your first one — it saves with no signal.',
  // What happened, why, and what to do — never "Validation error", and it answers the next
  // question ("so what do I call this one?") before it is asked.
  'land.taken.camp': 'This farm already has a camp with that name. Give this one a different one.',
  'land.taken.block':
    'This farm already has a block with that name. Give this one a different one.',
  'land.name': 'Description (optional)',
  'land.hectares': 'Hectares (optional)',
  'land.hectaresUnit': 'ha',
  // Live head standing in a camp (FR-705). The word a farmer uses for both a cow and a
  // sheep — this counts groups as well as individual animals.
  'land.headUnit': 'head',
  'land.capacity': 'Grazing capacity (LSU, optional)',
  'land.done': 'Done',
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
  'animals.theft': 'Stock theft',
  'animals.tag': 'Tag animals',
  'animals.untagged': 'without a number',
  'animals.health': 'Treat or vaccinate',
  // Health (FR-130/131/132/133) — compliance-gated. The clear date is shown IN THE CRUSH, because
  // "when can I sell this animal?" answered three weeks later is answered too late.
  'health.title': 'Treat or vaccinate',
  'health.what': 'What are you recording?',
  'health.kind.treatment': 'Treatment',
  'health.kind.vaccination': 'Vaccination',
  'health.kind.dip': 'Dip',
  'health.which': 'Which animals?',
  'health.administeredOn': 'When was it given?',
  'health.product': 'Which product',
  'health.chooseProduct': 'Choose one',
  'health.programme': 'Which programme (optional)',
  'health.reason': 'Why (optional)',
  'health.by': 'Who gave it (optional)',
  'health.save': 'Record it',
  'health.saved': 'recorded — your work is saved',
  'health.back': 'Back to animals',
  'health.clearFrom': 'These animals may be sold for slaughter from',
  'health.noWithdrawal': 'This product has no meat withholding period.',
  'health.noAnimals': 'No animals to treat yet.',
  // Not an error the farmer caused. Says what is true and what will fix it.
  'health.noProducts':
    'The product register has not reached this phone yet. Open the app once where there is signal, and it will be here for the crush.',
  'animals.birth': 'Record a birth',
  'animals.wean': 'Weaning session',
  'animals.new.bought': 'I bought this animal',
  'animals.new.seller': 'Bought from',
  'animals.new.paid': 'Price paid (R)',
  // Birth (FR-104). Two records from one action: the calf's herd row and the calving, filed
  // against the dam — "which cows calved, and how hard" is the question asked in September.
  'birth.title': 'Record a birth',
  'birth.dam': 'Which cow calved?',
  'birth.chooseDam': 'Choose one',
  'birth.ease': 'How hard was it?',
  'birth.easeHint': '1 is unassisted. 5 is a caesarean.',
  'birth.calfSex': 'The calf is',
  // Shown only for a multiple birth, numbering each calf's block. Numbering one of one is noise.
  'birth.calf': 'Calf',
  'birth.multiples': 'How many born',
  'birth.weight': 'Birth weight (kg, optional)',
  'birth.save': 'Record the birth',
  'birth.saved': 'calved — your work is saved',
  'birth.back': 'Back to animals',
  'birth.noDams': 'No females in the herd to record a birth against yet.',
  // Weaning (FR-111). The crush path again — weaning IS a crush day.
  'wean.title': 'Weaning session',
  'wean.of': 'of',
  'wean.kg': 'Weaning weight (kg)',
  'wean.saved': 'Weaned',
  'wean.done.count': 'weaned',
  'wean.empty': 'Nothing to wean — no animals with a recorded mother are still unweaned.',
  'animals.move': 'Move animals',
  // Moving (FR-103) and the first real batch action (FR-112). A farmer opens a gate and a camp
  // empties — selection is the primary interaction, and a single-animal move is a group of one.
  'move.title.camp': 'Move animals',
  'move.title.block': 'Move animals',
  'move.from.camp': 'Which camp are they in now?',
  'move.from.block': 'Which block are they in now?',
  'move.to.camp': 'Move to which camp',
  'move.to.block': 'Move to which block',
  'move.toGroup': 'Move into which group',
  'move.anywhere': 'Anywhere',
  'move.unplaced': 'Not placed',
  'move.unchanged': 'Leave as it is',
  'move.which': 'Which animals?',
  'move.selectAll': 'Select all shown',
  'move.save': 'Move them',
  'move.saved': 'moved — your work is saved',
  'move.back': 'Back to animals',
  'move.empty': 'No animals to move yet.',
  // Nowhere to move them TO. Say what to do next rather than showing an empty picker.
  'move.nowhere.camp': 'There are no camps yet, so there is nowhere to move animals to.',
  'move.nowhere.block': 'There are no blocks yet, so there is nowhere to move animals to.',
  'animals.addGroup': 'Record a group',
  'animals.groups': 'Groups',
  'animals.classes': 'by class',
  // Mobs / flocks (FR-102) — the group-only model. "Flock A: 300 head" is a complete record with
  // no individual animals behind it, and for most smallholders it is the whole answer.
  'mob.title': 'Record a group',
  'mob.name': 'What do you call this group?',
  'mob.head': 'How many head',
  'mob.where.camp': 'Which camp (optional)',
  'mob.where.block': 'Which block (optional)',
  'mob.nowhere': 'Not said',
  'mob.save': 'Save group',
  'mob.saved': 'saved — your work is saved',
  'mob.back': 'Back to animals',
  'mob.noHerds': 'This farm keeps no animals, so there is no group to record.',
  'mob.headUnit': 'head',
  // Tagging (FR-109). The crush path, same shape as the weigh session. An animal is called by its
  // tag, never by an id, so this is what makes every other screen able to name one.
  'tag.title': 'Tag animals',
  'tag.of': 'of',
  'tag.type': 'What kind',
  'tag.number': 'Number',
  'tag.save': 'Save & next',
  'tag.saved': 'saved',
  'tag.skip': 'Skip this one',
  'tag.back': 'Back to animals',
  'tag.empty': 'Every animal already has a number.',
  'tag.done.count': 'tagged',
  'tag.done.link': 'Done',
  // Caught before it is saved: in a crush the cause is nearly always a misread digit, so the
  // instruction is to look again — not a refusal with no way forward.
  'tag.taken': 'That number is already on another animal. Read it again, or use a different one.',
  'identifier.visual_tag': 'Ear tag',
  'identifier.eid': 'Electronic tag',
  'identifier.brand': 'Brand',
  'identifier.tattoo': 'Tattoo',
  'identifier.national_id': 'National ID',
  'identifier.other': 'Other',
  // Recording a loss (FR-105). A death is an event, not an edit; the animal is retained forever
  // and just excluded from live counts. Sale/cull/missing follow the same shape (later slices).
  'loss.title': 'Record a loss',
  'loss.pick': 'Which animal?',
  'loss.outcome': 'What happened?',
  'loss.died': 'Died',
  'loss.sold': 'Sold',
  // FR-131. Says no AND says when — a refusal with no way forward is what makes someone stop
  // recording treatments at all.
  'loss.withheld':
    'This animal was treated and cannot be sold for slaughter yet. It may be sold from',
  'loss.missing': 'Missing',
  'loss.causeMissing': 'What did you find? (optional)',
  'loss.lastSeenDay': 'When was it last seen?',
  // Says WHY the app is about to use the GPS, before it asks — a phone that silently reaches for
  // location is a phone a farmer stops trusting.
  'loss.gpsExplain':
    'Recording this takes a GPS point of where you are standing. It works with no signal, and it is what makes the record useful to the Stock Theft Unit.',
  'loss.locating': 'Getting the GPS point…',
  'loss.saveMissing': 'Report it missing',
  'loss.savedSuffixMissing': 'recorded — marked missing',
  // Each failure needs different advice, so they are not collapsed into one message.
  'loss.gps.denied':
    'This phone is not allowing the app to use its location. Turn location on for this app, then try again.',
  'loss.gps.unavailable':
    'The phone could not get a GPS point. Step into the open, away from a shed or trees, and try again.',
  'loss.gps.timeout': 'The GPS is still searching. Wait a few seconds in the open and try again.',
  'loss.gps.unsupported': 'This phone cannot give a GPS point, so this record cannot be anchored.',
  'loss.cause': 'Cause',
  'loss.counterparty': 'Buyer',
  'loss.price': 'Price (R)',
  'loss.save': 'Record death',
  'loss.saveSale': 'Record sale',
  'loss.savedSuffix': 'recorded — marked dead',
  'loss.savedSuffixSold': 'recorded — marked sold',
  'loss.empty': 'No live animals to record a loss against.',
  'loss.back': 'Back to animals',
  // Stock theft (FR-603, Stock Theft Act 57 of 1959). ZA copy names the SAPS Stock Theft Unit
  // explicitly — the neutral column names in the schema (ADR-0006) exist so the DATA travels to
  // another jurisdiction, not so a South African farmer reads "the police service" in their own app.
  'theft.title': 'Stock theft',
  'theft.intro':
    'The incidents you have filed. Each one can produce a pack of the facts — identification, ownership, where and when — for the Stock Theft Unit.',
  'theft.report': 'Report stock theft',
  'theft.empty': 'No incidents filed.',
  'theft.back': 'Back to animals',
  'theft.headTaken': 'head taken',
  'theft.discovered': 'Found',
  'theft.lastSeen': 'last seen',
  'theft.noPoint': 'No GPS point on this one.',
  'theft.pack': 'Get the evidence pack',
  'theft.packWorking': 'Putting the pack together…',
  // Not an error and not worded as one: the incident IS saved. What has not happened is the part
  // that genuinely needs a signal, and this says which part and what will fix it.
  'theft.packNotYetSent':
    'Saved on this phone. The pack is put together on the server, so this incident has to be sent first — that happens on its own next time you have signal.',
  'theft.packOffline':
    'The pack could not be fetched — there is no connection right now. The incident is safe. Try again where you have signal.',
  'theft.packRefused':
    'The pack could not be put together for this incident. Check that it has been sent, then try again.',
  // The capture screen.
  'theft.report.title': 'Report stock theft',
  'theft.report.intro':
    'Record what you found, where, and when. It saves on this phone straight away, with or without signal.',
  'theft.discoveredDay': 'When did you find it?',
  'theft.lastSeenDay': 'When were they last seen?',
  'theft.headCount': 'How many are gone?',
  'theft.headCountHint': 'The number, whether or not they carry tags.',
  'theft.camp': 'Which camp?',
  'theft.campNone': 'Not sure',
  'theft.whichAnimals': 'Which animals? (optional)',
  'theft.whichAnimalsHint': 'Tick any you can identify. Their tags and brand go into the pack.',
  'theft.taken': 'Taken',
  'theft.observations': 'What did you find?',
  // ⛔ The line that keeps a name out of the record, in the farmer's interest and not only ours.
  // legal-compliance.md § 3.2: naming a neighbour is a defamation exposure for THEM and a POPIA
  // s26 problem for us. Said as advice, because that is what it is.
  'theft.noSuspects':
    'Facts only — cut fence, tracks, a gate left open. Do not name anyone you suspect: that is for the police to establish, and putting a name in this record can be used against you.',
  'theft.caseNumber': 'SAPS case number (if you have one)',
  'theft.station': 'SAPS station (if you have reported it)',
  'theft.gpsExplain':
    'Saving takes a GPS point of where you are standing. It works with no signal, and it is what makes this record useful to the Stock Theft Unit.',
  'theft.locating': 'Getting the GPS point…',
  'theft.save': 'File this incident',
  'theft.saveWithoutPoint': 'File it without a GPS point',
  'theft.gpsRetryHint':
    'The point is most of what makes this record evidence. Step into the open and try again, or file it without one — the incident is worth more filed than not.',
  'theft.gpsTryAgain': 'Try the GPS again',
  'theft.gps.denied':
    'This phone is not allowing the app to use its location. Turn location on for this app, then try again.',
  'theft.gps.unavailable':
    'The phone could not get a GPS point. Step into the open, away from a shed or trees, and try again.',
  'theft.gps.timeout': 'The GPS is still searching. Wait a few seconds in the open and try again.',
  'theft.gps.unsupported': 'This phone cannot give a GPS point.',
  'theft.backToIncidents': 'Back to incidents',
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
  // Age/sex classes (FR-705). Tokens, not words, all the way from the domain — so Afrikaans can
  // say "koeie" without the English "cow" being baked into the rule that decides the class.
  'class.female': 'cows/ewes',
  'class.male': 'bulls/rams',
  'class.castrate': 'steers/wethers',
  'class.weaner': 'weaners',
  'class.young': 'calves/lambs',
  // Named honestly rather than folded into another class: an animal with no recorded birth date
  // cannot be classified, and quietly counting it as a cow would invent the number being checked.
  'class.unknown': 'no age recorded',
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
  'rain.season': 'this season',
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
  'settings.farms.title': 'Plase',
  'settings.farms.current': 'Jy is hier',
  'settings.farms.add': 'Voeg ’n plaas by',
  'settings.farms.notOwner': 'Net die eienaar van die besigheid kan ’n plaas byvoeg.',
  'settings.farms.needsSignal':
    'Om ’n plaas by te voeg het ’n verbinding nodig, want die plaas moet ook op die bediener opgestel word. Alles anders in die app werk steeds daarsonder.',
  'settings.farms.failed': 'Die plaas kon nie nou bygevoeg word nie. Probeer weer.',
  'shell.farm': 'Plaas',
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
  'sync.blocked': 'nie gestuur nie — benodig jou aandag',
  'sync.blocked.see': 'Wys my',
  'notSent.title': 'Wat jou aandag benodig',
  'notSent.intro':
    'Niks hier is verlore nie — dit is alles op hierdie foon gestoor. Die bediener wou dit nie so vat nie. Maak reg wat dit noem, dan gaan hulle vanself op; daar is niks om te druk nie.',
  'notSent.empty': 'Alles is opgestuur. Niks benodig jou nie.',
  'notSent.back': 'Terug na tuis',
  'notSent.kind.landUnit': '’n Kamp of blok',
  'notSent.kind.mob': '’n Groep',
  'notSent.kind.animal': '’n Dier',
  'notSent.kind.identifier': 'Nommer',
  'notSent.kind.weight': '’n Gewig vir',
  'notSent.kind.lifecycle': '’n Rekord vir',
  'notSent.kind.move': '’n Skuif vir',
  'notSent.kind.health': '’n Behandeling vir',
  'notSent.kind.theft': '’n Veediefstalverslag',
  'notSent.kind.rainfall': '’n Reënvallesing',
  'notSent.why.tagTaken':
    'Daardie nommer is reeds op ’n ander dier. Lees dit weer van die dier af en teken dit met die regte nommer aan — hierdie een bly hier tot jy dit doen.',
  'notSent.why.conflict':
    'Iets in hierdie een is reeds teen iets anders aangeteken. Teken dit weer aan met die deel wat bots verander.',
  'notSent.why.validation':
    'Die bediener wou hierdie een nie so vat nie. Teken dit weer aan en kyk na die getalle en datums.',
  'notSent.why.notFound':
    'Hierdie een wys na iets wat die plaas nie het nie — ’n kamp of ’n dier wat nooit aangeteken is nie, of op ’n ander foon aangeteken is. Sodra dit bestaan, gaan hierdie een vanself op.',
  'notSent.why.tenancy':
    'Hierdie een wys na iets op ’n ander plaas. Dit kan nie so opgaan nie. Laat weet ons asseblief daarvan.',
  'notSent.why.unknown':
    'Die bediener wou hierdie een nie vat nie en het nie op ’n manier gesê hoekom wat ons kan verduidelik nie. Dit is veilig op hierdie foon. Laat weet ons asseblief daarvan.',
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
  'tile.withholding': 'weerhou',
  'module.comingSoon': 'Hierdie deel van die plaas kom in ’n latere fase.',
  'module.notFound.title': 'Nie gevind nie',
  'module.notFound.body': 'Daar is niks hier nie.',
  'home.back': 'Terug na tuis',
  'land.add.camp': 'Voeg ’n kamp by',
  'land.add.block': 'Voeg ’n blok by',
  'land.new.camp': 'Voeg ’n kamp by',
  'land.new.block': 'Voeg ’n blok by',
  'land.code.camp': 'Kampnaam of -nommer',
  'land.code.block': 'Bloknaam of -nommer',
  'land.save.camp': 'Stoor kamp',
  'land.save.block': 'Stoor blok',
  'land.saved.camp': 'gestoor — jou werk is gestoor',
  'land.saved.block': 'gestoor — jou werk is gestoor',
  'land.another.camp': 'Voeg nog ’n kamp by',
  'land.another.block': 'Voeg nog ’n blok by',
  'land.empty.camp': 'Nog geen kampe nie. Voeg jou eerste een by — dit stoor sonder sein.',
  'land.empty.block': 'Nog geen blokke nie. Voeg jou eerste een by — dit stoor sonder sein.',
  'land.taken.camp':
    'Hierdie plaas het reeds ’n kamp met daardie naam. Gee hierdie een ’n ander naam.',
  'land.taken.block':
    'Hierdie plaas het reeds ’n blok met daardie naam. Gee hierdie een ’n ander naam.',
  'land.name': 'Beskrywing (opsioneel)',
  'land.hectares': 'Hektaar (opsioneel)',
  'land.hectaresUnit': 'ha',
  'land.headUnit': 'stuks',
  'land.capacity': 'Weidingskapasiteit (GVE, opsioneel)',
  'land.done': 'Klaar',
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
  'animals.theft': 'Veediefstal',
  'animals.tag': 'Merk diere',
  'animals.untagged': 'sonder ’n nommer',
  'animals.health': 'Behandel of ent',
  'health.title': 'Behandel of ent',
  'health.what': 'Wat teken jy aan?',
  'health.kind.treatment': 'Behandeling',
  'health.kind.vaccination': 'Inenting',
  'health.kind.dip': 'Dip',
  'health.which': 'Watter diere?',
  'health.administeredOn': 'Wanneer is dit gegee?',
  'health.product': 'Watter produk',
  'health.chooseProduct': 'Kies een',
  'health.programme': 'Watter program (opsioneel)',
  'health.reason': 'Waarom (opsioneel)',
  'health.by': 'Wie het dit gegee (opsioneel)',
  'health.save': 'Teken dit aan',
  'health.saved': 'aangeteken — jou werk is gestoor',
  'health.back': 'Terug na diere',
  'health.clearFrom': 'Hierdie diere mag vir slag verkoop word vanaf',
  'health.noWithdrawal': 'Hierdie produk het geen vleis-onttrekkingstydperk nie.',
  'health.noAnimals': 'Nog geen diere om te behandel nie.',
  'health.noProducts':
    'Die produkregister het nog nie hierdie foon bereik nie. Maak die app een keer oop waar daar sein is, en dit sal hier wees vir die kraal.',
  'animals.birth': 'Teken ’n geboorte aan',
  'animals.wean': 'Speensessie',
  'animals.new.bought': 'Ek het hierdie dier gekoop',
  'animals.new.seller': 'Gekoop van',
  'animals.new.paid': 'Prys betaal (R)',
  'birth.title': 'Teken ’n geboorte aan',
  'birth.dam': 'Watter koei het gekalf?',
  'birth.chooseDam': 'Kies een',
  'birth.ease': 'Hoe swaar was dit?',
  'birth.easeHint': '1 is sonder hulp. 5 is ’n keisersnee.',
  'birth.calfSex': 'Die kalf is',
  'birth.calf': 'Kalf',
  'birth.multiples': 'Hoeveel gebore',
  'birth.weight': 'Geboortegewig (kg, opsioneel)',
  'birth.save': 'Teken die geboorte aan',
  'birth.saved': 'het gekalf — jou werk is gestoor',
  'birth.back': 'Terug na diere',
  'birth.noDams': 'Nog geen wyfies in die trop om ’n geboorte teen aan te teken nie.',
  'wean.title': 'Speensessie',
  'wean.of': 'van',
  'wean.kg': 'Speengewig (kg)',
  'wean.saved': 'Gespeen',
  'wean.done.count': 'gespeen',
  'wean.empty':
    'Niks om te speen nie — geen diere met ’n aangetekende moeder is nog ongespeen nie.',
  'animals.move': 'Skuif diere',
  'move.title.camp': 'Skuif diere',
  'move.title.block': 'Skuif diere',
  'move.from.camp': 'In watter kamp is hulle nou?',
  'move.from.block': 'In watter blok is hulle nou?',
  'move.to.camp': 'Skuif na watter kamp',
  'move.to.block': 'Skuif na watter blok',
  'move.toGroup': 'Skuif in watter groep',
  'move.anywhere': 'Enige plek',
  'move.unplaced': 'Nie geplaas nie',
  'move.unchanged': 'Los soos dit is',
  'move.which': 'Watter diere?',
  'move.selectAll': 'Kies almal wat wys',
  'move.save': 'Skuif hulle',
  'move.saved': 'geskuif — jou werk is gestoor',
  'move.back': 'Terug na diere',
  'move.empty': 'Nog geen diere om te skuif nie.',
  'move.nowhere.camp': 'Daar is nog geen kampe nie, so daar is nêrens om diere heen te skuif nie.',
  'move.nowhere.block':
    'Daar is nog geen blokke nie, so daar is nêrens om diere heen te skuif nie.',
  'animals.addGroup': 'Teken ’n groep aan',
  'animals.groups': 'Groepe',
  'animals.classes': 'volgens klas',
  'mob.title': 'Teken ’n groep aan',
  'mob.name': 'Wat noem jy hierdie groep?',
  'mob.head': 'Hoeveel stuks',
  'mob.where.camp': 'Watter kamp (opsioneel)',
  'mob.where.block': 'Watter blok (opsioneel)',
  'mob.nowhere': 'Nie gesê nie',
  'mob.save': 'Stoor groep',
  'mob.saved': 'gestoor — jou werk is gestoor',
  'mob.back': 'Terug na diere',
  'mob.noHerds': 'Hierdie plaas hou geen diere aan nie, so daar is geen groep om aan te teken nie.',
  'mob.headUnit': 'stuks',
  'tag.title': 'Merk diere',
  'tag.of': 'van',
  'tag.type': 'Watter soort',
  'tag.number': 'Nommer',
  'tag.save': 'Stoor & volgende',
  'tag.saved': 'gestoor',
  'tag.skip': 'Slaan hierdie een oor',
  'tag.back': 'Terug na diere',
  'tag.empty': 'Elke dier het reeds ’n nommer.',
  'tag.done.count': 'gemerk',
  'tag.done.link': 'Klaar',
  'tag.taken': 'Daardie nommer is reeds op ’n ander dier. Lees dit weer, of gebruik ’n ander een.',
  'identifier.visual_tag': 'Oormerk',
  'identifier.eid': 'Elektroniese merk',
  'identifier.brand': 'Brandmerk',
  'identifier.tattoo': 'Tatoeëermerk',
  'identifier.national_id': 'Nasionale ID',
  'identifier.other': 'Ander',
  'loss.title': 'Teken ’n verlies aan',
  'loss.pick': 'Watter dier?',
  'loss.outcome': 'Wat het gebeur?',
  'loss.died': 'Gevrek',
  'loss.sold': 'Verkoop',
  'loss.withheld':
    'Hierdie dier is behandel en kan nog nie vir slag verkoop word nie. Dit mag verkoop word vanaf',
  'loss.missing': 'Vermis',
  'loss.causeMissing': 'Wat het jy gekry? (opsioneel)',
  'loss.lastSeenDay': 'Wanneer laas gesien?',
  'loss.gpsExplain':
    'Om dit aan te teken neem ’n GPS-punt van waar jy staan. Dit werk sonder sein, en dit is wat die rekord bruikbaar maak vir die Veediefstal-eenheid.',
  'loss.locating': 'Kry tans die GPS-punt…',
  'loss.saveMissing': 'Rapporteer as vermis',
  'loss.savedSuffixMissing': 'aangeteken — as vermis gemerk',
  'loss.gps.denied':
    'Hierdie foon laat nie die app toe om sy ligging te gebruik nie. Skakel ligging vir hierdie app aan en probeer weer.',
  'loss.gps.unavailable':
    'Die foon kon nie ’n GPS-punt kry nie. Staan in die oopte, weg van ’n skuur of bome, en probeer weer.',
  'loss.gps.timeout': 'Die GPS soek nog. Wag ’n paar sekondes in die oopte en probeer weer.',
  'loss.gps.unsupported':
    'Hierdie foon kan nie ’n GPS-punt gee nie, so hierdie rekord kan nie geanker word nie.',
  'loss.cause': 'Oorsaak',
  'loss.counterparty': 'Koper',
  'loss.price': 'Prys (R)',
  'loss.save': 'Teken vrektes aan',
  'loss.saveSale': 'Teken verkoop aan',
  'loss.savedSuffix': 'aangeteken — as dood gemerk',
  'loss.savedSuffixSold': 'aangeteken — as verkoop gemerk',
  'loss.empty': 'Geen lewende diere om ’n verlies teen aan te teken nie.',
  'loss.back': 'Terug na diere',
  'theft.title': 'Veediefstal',
  'theft.intro':
    'Die voorvalle wat jy aangemeld het. Elkeen kan ’n pak feite lewer — identifikasie, eienaarskap, waar en wanneer — vir die Veediefstal-eenheid.',
  'theft.report': 'Meld veediefstal aan',
  'theft.empty': 'Geen voorvalle aangemeld nie.',
  'theft.back': 'Terug na diere',
  'theft.headTaken': 'gevat',
  'theft.discovered': 'Gekry',
  'theft.lastSeen': 'laas gesien',
  'theft.noPoint': 'Geen GPS-punt by hierdie een nie.',
  'theft.pack': 'Kry die bewysstukpak',
  'theft.packWorking': 'Stel die pak saam…',
  'theft.packNotYetSent':
    'Op hierdie foon gestoor. Die pak word op die bediener saamgestel, so hierdie voorval moet eers gestuur word — dit gebeur vanself sodra jy weer sein het.',
  'theft.packOffline':
    'Die pak kon nie gehaal word nie — daar is nou geen verbinding nie. Die voorval is veilig. Probeer weer waar jy sein het.',
  'theft.packRefused':
    'Die pak kon nie vir hierdie voorval saamgestel word nie. Kyk of dit gestuur is en probeer weer.',
  'theft.report.title': 'Meld veediefstal aan',
  'theft.report.intro':
    'Teken aan wat jy gekry het, waar en wanneer. Dit stoor dadelik op hierdie foon, met of sonder sein.',
  'theft.discoveredDay': 'Wanneer het jy dit gekry?',
  'theft.lastSeenDay': 'Wanneer laas gesien?',
  'theft.headCount': 'Hoeveel is weg?',
  'theft.headCountHint': 'Die getal, of hulle nou merke dra of nie.',
  'theft.camp': 'Watter kamp?',
  'theft.campNone': 'Nie seker nie',
  'theft.whichAnimals': 'Watter diere? (opsioneel)',
  'theft.whichAnimalsHint':
    'Merk enige wat jy kan uitken. Hul nommers en brandmerk gaan in die pak in.',
  'theft.taken': 'Gevat',
  'theft.observations': 'Wat het jy gekry?',
  'theft.noSuspects':
    'Net feite — ’n geknipte draad, spore, ’n hek wat oopgelaat is. Moenie iemand se naam neerskryf wat jy verdink nie: dit is vir die polisie om vas te stel, en ’n naam in hierdie rekord kan teen jou gebruik word.',
  'theft.caseNumber': 'SAPD-saaknommer (as jy een het)',
  'theft.station': 'SAPD-kantoor (as jy dit aangemeld het)',
  'theft.gpsExplain':
    'Stoor neem ’n GPS-punt van waar jy staan. Dit werk sonder sein, en dit is wat hierdie rekord bruikbaar maak vir die Veediefstal-eenheid.',
  'theft.locating': 'Kry tans die GPS-punt…',
  'theft.save': 'Meld hierdie voorval aan',
  'theft.saveWithoutPoint': 'Meld dit aan sonder ’n GPS-punt',
  'theft.gpsRetryHint':
    'Die punt is die grootste deel van wat hierdie rekord bewys maak. Staan in die oopte en probeer weer, of meld dit aan sonder een — die voorval is meer werd aangemeld as nie.',
  'theft.gpsTryAgain': 'Probeer die GPS weer',
  'theft.gps.denied':
    'Hierdie foon laat nie die app toe om sy ligging te gebruik nie. Skakel ligging vir hierdie app aan en probeer weer.',
  'theft.gps.unavailable':
    'Die foon kon nie ’n GPS-punt kry nie. Staan in die oopte, weg van ’n skuur of bome, en probeer weer.',
  'theft.gps.timeout': 'Die GPS soek nog. Wag ’n paar sekondes in die oopte en probeer weer.',
  'theft.gps.unsupported': 'Hierdie foon kan nie ’n GPS-punt gee nie.',
  'theft.backToIncidents': 'Terug na voorvalle',
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
  'class.female': 'koeie/ooie',
  'class.male': 'bulle/ramme',
  'class.castrate': 'osse/hamels',
  'class.weaner': 'speenkalwers',
  'class.young': 'kalwers/lammers',
  'class.unknown': 'geen ouderdom aangeteken',
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
  'rain.season': 'hierdie seisoen',
  'rain.back': 'Terug na tuis',
};

export const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
  'en-ZA': en,
  'af-ZA': af,
};
