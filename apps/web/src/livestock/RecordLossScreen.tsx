/**
 * Record a loss (FR-105/106/605) — a death, a sale, or a missing report. Either way the animal
 * leaves the live herd: a lifecycle event is captured here and folded onto the herd by the
 * projection, which moves the animal through the domain state machine (→ 'dead', 'sold' or
 * 'missing') and drops it from live head. The animal is RETAINED forever — it still shows in the
 * list, marked — because a farmer's records and the audit/financial trail keep the tombstone; it is
 * only excluded from "how many do I have".
 *
 * MISSING is a private farm record first. The screen asks when the animal was last seen and tries
 * to add the farmer's current GPS point because both can be useful later. Location is optional: a
 * denied or unavailable fix must never prevent the farmer from recording what happened.
 *
 * Offline-first like every capture: `save` commits locally and instantly with no network in the
 * path (NFR-007).
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { parseRandsToCents, uuidv7 } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { useAuth } from '../auth/AuthProvider';
import { farmToday } from '../farmTime';
import { useEffectiveAnimals } from './herd';
import { useAnimals } from './LocalHerd';
import { useMoves } from './LocalMoves';
import { useRecordDeath, useRecordMissing, useRecordSale } from './LocalLifecycle';
import { useAnimalLabels } from './LocalIdentifiers';
import { currentPoint, type FixFailure } from '../geo/geolocation';
import { useHealthEvents } from './LocalHealth';
import { useVetProducts } from './LocalVetProducts';
import { meatWithdrawalFor, type WithholdDose } from './withdrawal';
import {
  useHydratedAnimals,
  useHydratedMoves,
  useHydratedHealthEvents,
  mergeById,
  mergeByIdPreferHydrated,
} from './HydratedLivestock';
import { speciesLabel, sexLabel } from './AnimalsScreen';

/**
 * `slaughtered` is its own outcome and not a `cause` someone types into `died`, so the log can
 * distinguish an intentional slaughter from a death without interpreting farmer-written notes.
 */
type Outcome = 'died' | 'slaughtered' | 'sold' | 'missing';

/** The stored `cause` for a slaughter. Locale-independent on purpose — see `save`. */
const SLAUGHTER_CAUSE = 'slaughtered';

interface SavedSummary {
  readonly what: string;
  readonly outcome: Outcome;
}

function priceIsValid(rands: string): boolean {
  return parseRandsToCents(rands) !== null;
}

/** The sale weight is optional; blank is fine, but a typed weight must be a positive number. */
function weightIsValid(kg: string): boolean {
  return kg.trim() === '' || weightIsUsable(kg);
}

function weightIsUsable(kg: string): boolean {
  const n = Number(kg);
  return kg.trim() !== '' && Number.isFinite(n) && n > 0;
}

/** Today ON THE FARM, for the last-seen day field's default and maximum. */
function today(): string {
  return farmToday();
}

export function RecordLossScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const recordDeath = useRecordDeath();
  const recordSale = useRecordSale();
  const recordMissing = useRecordMissing();
  const labels = useAnimalLabels();
  const healthEvents = useHealthEvents();
  const hydratedHealthEvents = useHydratedHealthEvents();
  const products = useVetProducts();
  const live = useEffectiveAnimals().filter((a) => a.status === 'alive');
  // The RAW herd row and the move log: the withdrawal guard reconstructs which mob this animal
  // was in on the day of each dose, and a projected animal carries only where it is NOW.
  //
  // ⭐ Merged with hydrated animals/moves/health (phase-checklists.md 3e). Without this, an animal
  // this device never itself captured — only heard about via down-sync — was invisible to `stored`,
  // so `selectedStored` came back `undefined` and the guard below silently skipped ENTIRELY (not
  // narrowly wrong — off) for exactly the animal a co-worker's phone knows the treatment history of.
  const hydratedAnimals = useHydratedAnimals();
  const stored = mergeById(useAnimals(), hydratedAnimals);
  // The raw hydrated-animal id set (STATUS.md §3, fail-closed) — see `withdrawal.ts`'s
  // `mobMembership` "OWNER DECISION" note.
  const hydratedAnimalIds = new Set(hydratedAnimals.map((a) => a.id));
  // `mergeByIdPreferHydrated`: a move's hydrated echo carries `fromMobId`/`fromLandUnitId`, which a
  // local capture never can — local-wins would shadow that enrichment once this device's own move
  // round-trips back with the same id (compliance-checker finding, phase-checklists.md 3e). See
  // `HydratedLivestock.tsx`'s `mergeByIdPreferHydrated` docstring.
  const moves = mergeByIdPreferHydrated(useMoves(), useHydratedMoves());

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [cause, setCause] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [priceRands, setPriceRands] = useState('');
  const [saleWeight, setSaleWeight] = useState('');
  const [lastSeenDay, setLastSeenDay] = useState(today);
  // ⭐ ASKED, never assumed — the same rule the health screen learned the hard way. A slaughter
  // on Monday written up on Thursday is a Monday fact, and FR-131 is judged on the day the meat
  // entered the food chain. Stamping it with the capture day lets an animal slaughtered inside a
  // withholding pass the guard, and leaves a durable record saying it was legal.
  const [disposalDay, setDisposalDay] = useState(today);
  const [locating, setLocating] = useState(false);
  const [fixFailed, setFixFailed] = useState<FixFailure | null>(null);
  const [lastSaved, setLastSaved] = useState<SavedSummary | null>(null);
  const [saving, setSaving] = useState(false);

  if (!activeFarm) return null;

  const selected = live.find((a) => a.id === selectedId) ?? null;

  // FR-131 reminder arithmetic uses the day the farmer gave, not today. It remains advisory.
  const selectedStored = selected === null ? undefined : stored.find((a) => a.id === selected.id);
  // Same reasoning as `moves` above: a hydrated dose carries `meatWithholdUntil`, a local capture
  // never can.
  const foldHealth = mergeByIdPreferHydrated<WithholdDose>(healthEvents, hydratedHealthEvents);
  const withdrawal =
    selectedStored === undefined
      ? null
      : meatWithdrawalFor(
          selectedStored,
          disposalDay,
          foldHealth,
          products,
          moves,
          hydratedAnimalIds,
        );
  // Show the same private interval reminder for both relevant log outcomes.
  const intoFoodChain = outcome === 'sold' || outcome === 'slaughtered';
  const withheld = intoFoodChain && withdrawal !== null && withdrawal.blocked;
  // A death is recorded and may still show the farmer's interval reminder.
  const deathWithinWithdrawal = outcome === 'died' && withdrawal !== null && withdrawal.blocked;

  const reset = () => {
    setSelectedId(null);
    setOutcome(null);
    setCause('');
    setCounterparty('');
    setPriceRands('');
    setSaleWeight('');
    setLastSeenDay(today());
    setDisposalDay(today());
    setFixFailed(null);
  };

  const pick = (id: string) => {
    setLastSaved(null);
    setSelectedId(id);
    setOutcome(null);
    setFixFailed(null);
  };

  /** What the animal is called, for the confirmation line: its number if it has one. */
  const nameOf = (animal: NonNullable<typeof selected>): string =>
    labels.get(animal.id) ?? speciesLabel(t, animal.species);

  const save = async (saveMissingWithoutGps = false) => {
    if (!selected || saving) return;
    setSaving(true);
    try {
      await saveOutcome(saveMissingWithoutGps);
    } finally {
      setSaving(false);
    }
  };

  const saveOutcome = async (saveMissingWithoutGps: boolean) => {
    if (!selected) return;
    const base = {
      id: uuidv7(),
      farmId: activeFarm.id,
      animalId: selected.id,
      // Midday on the farm's day, exactly as the tally and missing paths do it: the farmer gave a
      // DAY, and midday cannot slide either side of it when the instant is read back in any zone.
      occurredAt: new Date(`${disposalDay}T12:00:00.000Z`),
      currentStatus: 'alive' as const,
    };

    if (outcome === 'died') {
      if (cause.trim().length === 0) return;
      await recordDeath({ ...base, cause: cause.trim() });
    } else if (outcome === 'slaughtered') {
      // The cause is the act itself, so nothing is asked for: standing at a carcass with gloves on,
      // a required free-text box to type "slaughtered" is an obstacle and not a record.
      //
      // ⭐ A STABLE value, never `t('loss.slaughtered')`. That would write "Slaughtered" from an
      // English device and "Geslag" from an Afrikaans one into a register a residue traceback or an
      // export auditor reads — farmer-facing copy leaking into the data, which is the mirror of the
      // defect that put raw English in front of the farmer. The machine-readable fact is the flag.
      await recordDeath({ ...base, cause: SLAUGHTER_CAUSE, slaughtered: true });
    } else if (outcome === 'sold') {
      if (counterparty.trim().length === 0 || !priceIsValid(priceRands)) return;
      // The same backstop the slaughter branch carries, and for the same reason: `canSave` is what
      // the farmer sees, this is what the code guarantees. A sale is a route into the food chain
      // exactly as a slaughter is, and it had no second line.
      if (disposalDay === '') return;
      await recordSale({
        ...base,
        counterparty: counterparty.trim(),
        // Guarded above: this branch already returned if `!priceIsValid(priceRands)`.
        priceCents: parseRandsToCents(priceRands)!,
        // The liveweight the deal was struck on (FR-106). Optional, because plenty of sales are
        // per head off the veld with no scale in sight — but when there IS a scale, this is the
        // number the price per kilogram is argued over, and it is unrecoverable afterwards.
        ...(weightIsUsable(saleWeight) ? { weightKg: Number(saleWeight) } : {}),
      });
    } else if (outcome === 'missing') {
      // The fix is taken HERE, not on selection: a farmer who picks an animal and then walks to
      // where they last saw it should get the point from where they are standing when they record.
      let lastSeenGeojson: string | undefined;
      if (!saveMissingWithoutGps) {
        setLocating(true);
        const fix = await currentPoint();
        setLocating(false);
        if (!fix.ok) {
          setFixFailed(fix.reason);
          return;
        }
        lastSeenGeojson = fix.geojson;
      }
      await recordMissing({
        ...base,
        // The day the farmer gave, not today: a missing report is filed after the fact, and a
        // theft dated to the day it was noticed is a theft dated wrong.
        occurredAt: new Date(`${lastSeenDay}T12:00:00.000Z`),
        ...(lastSeenGeojson === undefined ? {} : { lastSeenGeojson }),
        ...(cause.trim().length === 0 ? {} : { cause: cause.trim() }),
      });
    } else {
      return;
    }

    // Not "saved" until the local write is durable (P1.1) — every branch above is awaited first.
    setLastSaved({ what: nameOf(selected), outcome });
    reset();
  };

  const savedSuffix = (o: Outcome): TranslationKey =>
    o === 'died'
      ? 'loss.savedSuffix'
      : o === 'slaughtered'
        ? 'loss.savedSuffixSlaughtered'
        : o === 'sold'
          ? 'loss.savedSuffixSold'
          : 'loss.savedSuffixMissing';

  const canSave =
    outcome === 'died'
      ? // The day is now asked for a death too, and it is clearable — so require it, exactly as the
        // slaughter branch does. Without this a cleared date reaches `save` as `new Date('T12:...')`
        // = Invalid Date, serialises to `occurredAt: null`, and the death is stranded in the outbox
        // (a 400 on `timestampSchema`) with no way forward — losing the very record that carries the
        // `withinWithdrawal` flag this input was added for.
        cause.trim().length > 0 && disposalDay !== ''
      : outcome === 'slaughtered'
        ? disposalDay !== ''
        : outcome === 'sold'
          ? // ⭐ `disposalDay !== ''` belongs here for BOTH reasons the slaughter branch has it, and
            // a sale is the route that had neither. (1) A cleared date reaches `save` as
            // `new Date('T12:...')` = Invalid Date and throws out of the click handler, losing the
            // sale with no message. (2) It is the day the withdrawal guard is judged against, so a
            // blank one used to disarm the guard entirely — see `latestClearAcross`, which now
            // refuses an unreadable day rather than treating it as "before every dose".
            counterparty.trim().length > 0 &&
            priceIsValid(priceRands) &&
            weightIsValid(saleWeight) &&
            disposalDay !== ''
          : outcome === 'missing'
            ? lastSeenDay !== '' && !locating
            : false;

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('loss.title')}</h1>

      {lastSaved && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {lastSaved.what} {t(savedSuffix(lastSaved.outcome))}
        </p>
      )}

      {live.length === 0 ? (
        <p className="text-body text-soil-700">{t('loss.empty')}</p>
      ) : (
        <>
          <p className="mb-2 text-label uppercase text-soil-700">{t('loss.pick')}</p>
          <ul className="mb-6 flex list-none flex-col gap-2 p-0">
            {live.map((animal) => {
              const isSelected = animal.id === selectedId;
              return (
                <li key={animal.id}>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => pick(animal.id)}
                    className={`flex min-h-touch-min w-full items-center justify-between rounded border p-3 text-left text-body ${
                      isSelected
                        ? 'border-soil-900 bg-sand-100 text-soil-900'
                        : 'border-soil-200 bg-sand-50 text-soil-900'
                    }`}
                  >
                    {/* The number is how a farmer picks the right animal out of a list. */}
                    <span>
                      {labels.has(animal.id) ? (
                        <span className="font-data tabular-nums">{labels.get(animal.id)}</span>
                      ) : (
                        speciesLabel(t, animal.species)
                      )}
                    </span>
                    <span className="text-soil-700">
                      {sexLabel(t, animal.sex)}
                      {animal.breed ? ` · ${animal.breed}` : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {selected && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <fieldset className="mb-4 border-0 p-0">
                <legend className="mb-1 text-label uppercase text-soil-700">
                  {t('loss.outcome')}
                </legend>
                <div className="flex gap-2">
                  {(['died', 'slaughtered', 'sold', 'missing'] as const).map((o) => (
                    <button
                      key={o}
                      type="button"
                      aria-pressed={outcome === o}
                      onClick={() => {
                        setOutcome(o);
                        setFixFailed(null);
                      }}
                      className={`min-h-touch-min flex-1 rounded border px-4 font-ui text-body ${
                        outcome === o
                          ? 'border-soil-900 bg-sand-100 text-soil-900'
                          : 'border-soil-200 bg-sand-50 text-soil-900'
                      }`}
                    >
                      {t(`loss.${o}` as TranslationKey)}
                    </button>
                  ))}
                </div>
              </fieldset>

              {(outcome === 'died' || outcome === 'missing') && (
                <div className="mb-6 flex flex-col">
                  <label htmlFor="cause" className="mb-1 text-label uppercase text-soil-700">
                    {t(outcome === 'died' ? 'loss.cause' : 'loss.causeMissing')}
                  </label>
                  <input
                    id="cause"
                    name="cause"
                    type="text"
                    autoComplete="off"
                    value={cause}
                    onChange={(e) => setCause(e.target.value)}
                    className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
                  />
                </div>
              )}

              {/* ⭐ Asked for a DEATH too, not only a sale or slaughter. A death is judged on the
                  day it happened — an animal that died inside a withholding, written up after the
                  clear date, is flagged only if the true day reaches the server. Stamping today
                  loses that fact silently, and there was no way in the product to record the real
                  day. The GROUP path (AdjustMobScreen) has always asked when; the individual path
                  did not. `missing` keeps its own last-seen day below. */}
              {(outcome === 'died' || intoFoodChain) && (
                <div className="mb-4 flex flex-col">
                  <label htmlFor="disposalDay" className="mb-1 text-label uppercase text-soil-700">
                    {t('loss.disposalDay')}
                  </label>
                  <input
                    id="disposalDay"
                    name="disposalDay"
                    type="date"
                    max={today()}
                    value={disposalDay}
                    onChange={(e) => setDisposalDay(e.target.value)}
                    className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
                  />
                </div>
              )}

              {outcome === 'missing' && (
                <>
                  {/* Asked, never assumed: a missing report is filed after the fact, and stock
                      theft dated to the day it was noticed is dated wrong. */}
                  <div className="mb-4 flex flex-col">
                    <label htmlFor="lastSeen" className="mb-1 text-label uppercase text-soil-700">
                      {t('loss.lastSeenDay')}
                    </label>
                    <input
                      id="lastSeen"
                      name="lastSeen"
                      type="date"
                      max={today()}
                      value={lastSeenDay}
                      onChange={(e) => setLastSeenDay(e.target.value)}
                      className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
                    />
                  </div>
                  <p className="mb-4 text-body text-soil-700">{t('loss.gpsExplain')}</p>
                  {fixFailed !== null && (
                    <div className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
                      <p>{t(`loss.gps.${fixFailed}` as TranslationKey)}</p>
                      <button
                        type="button"
                        className="mt-3 min-h-touch-min rounded border border-soil-900 px-3 font-ui"
                        disabled={saving}
                        onClick={() => void save(true)}
                      >
                        {t('loss.saveWithoutGps')}
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* Farmer-entered interval reminder, shown before save but never used as permission. */}
              {deathWithinWithdrawal && withdrawal?.clearFrom !== null && (
                <p
                  role="status"
                  className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900"
                >
                  {t('loss.deathWithinWithdrawal')}{' '}
                  <span className="font-data tabular-nums">{withdrawal!.clearFrom}</span>
                </p>
              )}

              {withheld && withdrawal?.clearFrom !== null && (
                <p
                  role="alert"
                  className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900"
                >
                  {t('loss.withheld')}{' '}
                  <span className="font-data tabular-nums">{withdrawal!.clearFrom}</span>
                </p>
              )}

              {/* If the day is malformed, explain why no interval date can be calculated. The
                  ordinary required-date validation—not the reminder—controls whether save works. */}
              {(withheld || deathWithinWithdrawal) && withdrawal?.clearFrom === null && (
                <p
                  role="alert"
                  className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900"
                >
                  {t('loss.needDay')}
                </p>
              )}

              {outcome === 'sold' && (
                <>
                  <div className="mb-4 flex flex-col">
                    <label
                      htmlFor="counterparty"
                      className="mb-1 text-label uppercase text-soil-700"
                    >
                      {t('loss.counterparty')}
                    </label>
                    <input
                      id="counterparty"
                      name="counterparty"
                      type="text"
                      autoComplete="off"
                      value={counterparty}
                      onChange={(e) => setCounterparty(e.target.value)}
                      className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
                    />
                  </div>
                  <div className="mb-4 flex flex-col">
                    <label htmlFor="price" className="mb-1 text-label uppercase text-soil-700">
                      {t('loss.price')}
                    </label>
                    <input
                      id="price"
                      name="price"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={priceRands}
                      onChange={(e) => setPriceRands(e.target.value)}
                      className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
                    />
                  </div>
                  {/* The liveweight the deal was struck on (FR-106) — optional, and the only one
                      of the three sale fields that is. It is unrecoverable after the truck leaves,
                      and without it a price says nothing about what the animal was worth. */}
                  <div className="mb-6 flex flex-col">
                    <label htmlFor="saleWeight" className="mb-1 text-label uppercase text-soil-700">
                      {t('loss.saleWeight')}
                    </label>
                    <input
                      id="saleWeight"
                      name="saleWeight"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={saleWeight}
                      onChange={(e) => setSaleWeight(e.target.value)}
                      className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
                    />
                  </div>
                </>
              )}

              {outcome !== null && (
                <button
                  type="submit"
                  className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
                  disabled={!canSave || saving}
                >
                  {locating
                    ? t('loss.locating')
                    : t(
                        outcome === 'died'
                          ? 'loss.save'
                          : outcome === 'slaughtered'
                            ? 'loss.saveSlaughter'
                            : outcome === 'sold'
                              ? 'loss.saveSale'
                              : 'loss.saveMissing',
                      )}
                </button>
              )}
            </form>
          )}
        </>
      )}

      <Link to="/animals" className="mt-6 inline-block text-body text-dam-700">
        {t('loss.back')}
      </Link>
    </section>
  );
}
