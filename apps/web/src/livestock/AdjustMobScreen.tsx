/**
 * Change a group's head count (FR-102) — the number a farmer looks at every day, and until this
 * screen existed could never correct.
 *
 * A mob is the group-only model: "Flock A: 300 head" with no individual animal rows behind it. Every
 * other way out of the herd — a death, a sale — is recorded against one animal, so a flock created at
 * 300 stayed at 300 through a lambing season, a drought and an abattoir run. A wrong number a farmer
 * cannot fix is worse than no number: it teaches them not to trust the tile.
 *
 * ⭐ The screen shows the arithmetic before it is committed — "300 → 297" — because the number is the
 * whole reason anyone is here. A capture that reports "saved" and leaves the farmer to navigate back
 * and check what it did to the count is the version that gets used once.
 *
 * ⭐ It asks WHEN, and does not assume today. Three ewes found dead this morning died some days ago,
 * and a tally dated to the day it was noticed dates the season's losses wrong — the same reason the
 * missing report asks for the last-seen day rather than stamping `now()`.
 *
 * Offline-first like every capture: save commits locally and instantly, with no network in the path
 * (NFR-007). The count on screen updates from the local projection, not from a server round trip.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { projectHeadCount } from '@werf/domain';
import { schemas, uuidv7 } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { useAuth } from '../auth/AuthProvider';
import { farmToday } from '../farmTime';
import { useEffectiveMobs } from './herd';
import { useRecordTally, useTallies } from './LocalTallies';
import { useMobs } from './LocalMobs';
import { useHealthEvents } from './LocalHealth';
import { useAnimals } from './LocalHerd';
import { useMoves } from './LocalMoves';
import { useVetProducts } from './LocalVetProducts';
import { meatWithdrawalForMob } from './withdrawal';

/**
 * The reasons, in the order a farmer meets them rather than alphabetically or grouped by sign.
 * Recount is last because it is the repair, not the routine.
 */
const REASONS = [
  'birth',
  'death',
  'sale',
  'purchase',
  'theft',
  'slaughter',
  'recount',
] as const satisfies readonly schemas.TallyReason[];

/**
 * Every reason must appear on the screen. `satisfies` above proves each entry IS a reason; it does
 * not prove the list is complete, so a reason added to the schema could silently never be offered —
 * a capture the product accepts and gives the farmer no way to make. This makes that a type error.
 */
type UnofferedReason = Exclude<schemas.TallyReason, (typeof REASONS)[number]>;
const _everyReasonIsOffered: UnofferedReason extends never ? true : never = true;
void _everyReasonIsOffered;

/**
 * Which reasons ADD head, taken from the schema rather than restated here.
 *
 * ⭐ This was a hand-written copy, and that is the defect this phase has already been bitten by
 * once: the dip `method` union offered a value the server refuses, and it never fired only because
 * no screen showed the field. A local copy of the sign rule is worse, because it disagrees SILENTLY
 * — the preview below would show one number while the domain computed another, and the save handler
 * would throw out of a submit with nothing catching it.
 */
const INCREASES: readonly schemas.TallyReason[] = schemas.TALLY_INCREASES;

/** Rands as typed → integer cents (Money). Rounded at the I/O boundary, never carried as a float. */
function toCents(rands: string): number {
  return Math.round(Number(rands) * 100);
}

function priceIsValid(rands: string): boolean {
  if (rands.trim() === '') return true; // the price is optional; blank is not an error
  const n = Number(rands);
  return Number.isFinite(n) && n >= 0;
}

/** The typed count as a whole number of animals, or null when it is not one yet. */
function parseCount(typed: string): number | null {
  if (typed.trim() === '') return null;
  const n = Number(typed);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function AdjustMobScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const recordTally = useRecordTally();
  // The PROJECTED mobs — each carrying the head standing in it after every adjustment the device
  // holds, which is the number the farmer is about to change.
  const mobs = useEffectiveMobs();
  const tallies = useTallies();
  // The RAW mobs: the fold below needs the mob's BASELINE, and a projected mob's `headCount` has
  // already had the whole log applied to it. Folding over that would count every tally twice.
  const storedMobs = useMobs();
  const healthEvents = useHealthEvents();
  const products = useVetProducts();
  // A counted mob can ALSO hold individually-registered animals, and a treatment given to one of
  // them stores `mob_id = NULL`. The raw herd and the move log are what let the guard see it — the
  // tally takes head out without naming which head.
  const herd = useAnimals();
  const moves = useMoves();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState<schemas.TallyReason | null>(null);
  const [count, setCount] = useState('');
  const [day, setDay] = useState(farmToday);
  const [counterparty, setCounterparty] = useState('');
  const [priceRands, setPriceRands] = useState('');
  const [lastSaved, setLastSaved] = useState<{ name: string; head: number } | null>(null);
  const [refused, setRefused] = useState<{ detail: string | null } | null>(null);

  if (!activeFarm) return null;

  // Only groups managed BY a head count can be tallied. One that is a bag of individually-recorded
  // animals gets its number by counting those, and a second count of the same sheep would compete
  // with it — so those are not offered here rather than being offered and refused.
  const counted = mobs.filter((m) => m.headCount !== null);
  const selected = counted.find((m) => m.id === selectedId) ?? null;

  const typed = parseCount(count);
  const captureId = useMemo(() => uuidv7(), [selectedId, day]);

  /**
   * ⭐ The count AS AT THE DAY BEING DESCRIBED, not today's.
   *
   * `useEffectiveMobs()` folds the WHOLE local log, and the day field lets a farmer back-date. So
   * validating against it judges a past capture against the present, and refuses a true fact:
   * record "sold the whole flock, 300 head, on the 20th", then remember five ewes died on the
   * 18th — today's count is 0, the projection is −5, and Save is disabled. The five dead ewes
   * cannot be recorded at all.
   *
   * Refusing at capture is worse than a 400, because a 400 at least leaves a queued record to
   * recover. The server was fixed for exactly this; the screen has to agree, or the capture never
   * reaches the server that would accept it.
   *
   * Cut on the same `(occurredAt, id)` total order the projection runs in — ties are ordinary here,
   * since every tally on a day shares one instant.
   */
  const currentHead = useMemo(() => {
    if (selected === null) return null;
    const at = `${day}T12:00:00.000Z`;
    const before = tallies.filter(
      (t) =>
        t.mobId === selected.id && (t.occurredAt < at || (t.occurredAt === at && t.id < captureId)),
    );
    const stored = storedMobs.find((m) => m.id === selected.id);
    const baseline =
      stored === undefined
        ? null
        : stored.initialHeadCount === undefined
          ? stored.headCount
          : stored.initialHeadCount;
    return projectHeadCount(baseline, before);
  }, [selected, storedMobs, tallies, day, captureId]);
  const isRecount = reason === 'recount';
  const trade = reason === 'sale' || reason === 'purchase';

  /** What the count becomes if this is saved. Null until there is enough to say. */
  const projected =
    currentHead === null || typed === null || reason === null
      ? null
      : isRecount
        ? typed
        : currentHead + (INCREASES.includes(reason) ? typed : -typed);

  // Caught here as well as in the domain, because a farmer standing in the camp can act on it: the
  // count on file is itself the thing that is wrong, and a recount is the honest repair.
  const tooMany = projected !== null && projected < 0;
  const changesNothing = !isRecount && typed === 0;

  // ⭐ FR-131 on the group path, AT CAPTURE. The server refuses this and that refusal is the
  // authoritative one — but it arrives on the next flush, which on this product is Friday. Dip the
  // flock Monday; Tuesday, no signal, tally forty to the abattoir; the screen says "saved, 260
  // head"; the truck loads. The 400 lands three days later and FR-009 correctly sets it aside
  // forever, by which time the only thing it can do is explain what already happened.
  //
  // The individual sale path has been guarded at capture since the health slice, for reasons its
  // own header states. This is the path where the exposure is worse: a flock run by head count is
  // the smallholder's, and the farm least likely to have a second system catching the mistake.
  const intoFoodChain = reason === 'sale' || reason === 'slaughter';
  const withdrawal =
    selected === null
      ? null
      : meatWithdrawalForMob(selected.id, day, healthEvents, products, herd, moves);
  const withheld = intoFoodChain && withdrawal !== null && withdrawal.blocked;

  const canSave =
    selected !== null &&
    reason !== null &&
    typed !== null &&
    !tooMany &&
    !changesNothing &&
    !withheld &&
    day !== '' &&
    priceIsValid(priceRands);

  const reset = () => {
    setReason(null);
    setCount('');
    setCounterparty('');
    setPriceRands('');
    setDay(farmToday());
  };

  const save = () => {
    if (!selected || reason === null || typed === null || !canSave) return;
    const price = priceRands.trim() === '' ? undefined : toCents(priceRands);
    const buyer = counterparty.trim() === '' ? undefined : counterparty.trim();

    // The domain is the authority on whether this capture is legal, and `canSave` above is a
    // preview of its answer rather than a second implementation of it. If the two ever disagree,
    // the farmer must see SOMETHING — not a blank screen from an exception thrown out of a click
    // handler with their capture lost.
    //
    // ⭐ What they see is the translated string, and the domain's own message goes underneath it.
    // Domain errors are raised in English by design (they are thrown from a package with no
    // locale), so preferring `error.message` put raw English in front of an Afrikaans farmer and
    // left the translated line as a fallback that fired only when the throw was not an Error.
    try {
      recordTally({
        // The id the as-at fold above cut on, so what was validated is what is written.
        id: captureId,
        farmId: activeFarm.id,
        mobId: selected.id,
        // Midday on the farm's day, exactly as the missing report does it: the farmer gave a DAY,
        // and midday cannot slide either side of it when the instant is read back in any zone.
        //
        // ⭐ Every tally on a day therefore shares one instant, which is why the projection orders
        // by `(occurredAt, id)` and not by the instant alone — see `projectHeadCount`.
        occurredAt: new Date(`${day}T12:00:00.000Z`),
        reason,
        count: typed,
        currentHead,
        ...(buyer === undefined ? {} : { counterparty: buyer }),
        ...(price === undefined ? {} : { priceCents: price }),
      });
    } catch (error) {
      setRefused({ detail: error instanceof Error ? error.message : null });
      return;
    }

    setRefused(null);
    setLastSaved({ name: selected.name, head: projected ?? 0 });
    reset();
  };

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('tally.title')}</h1>

      {lastSaved && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {lastSaved.name} {t('tally.saved')}{' '}
          <span className="font-data tabular-nums">{lastSaved.head}</span> {t('tally.headUnit')}
        </p>
      )}

      {/* ⭐ Says no AND says when, in the same panel — a refusal with no way forward is what makes
          someone stop recording dips at all. Warning FORM: tinted panel with a left rule, never the
          ochre action shape (NFR-411). */}
      {withheld && withdrawal?.clearFrom !== null && (
        <p
          role="alert"
          className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900"
        >
          {t('tally.withheld')}{' '}
          <span className="font-data tabular-nums">{withdrawal!.clearFrom}</span>
        </p>
      )}

      {refused && (
        <div
          role="alert"
          className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900"
        >
          <p>{t('tally.refused')}</p>
          {refused.detail !== null && <p className="mt-1 text-soil-700">{refused.detail}</p>}
        </div>
      )}

      {counted.length === 0 ? (
        <p className="text-body text-soil-700">{t('tally.empty')}</p>
      ) : (
        <>
          <p className="mb-2 text-label uppercase text-soil-700">{t('tally.pick')}</p>
          <ul className="mb-6 flex list-none flex-col gap-2 p-0">
            {counted.map((mob) => {
              const isSelected = mob.id === selectedId;
              return (
                <li key={mob.id}>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => {
                      setLastSaved(null);
                      setSelectedId(mob.id);
                      reset();
                    }}
                    className={`flex min-h-touch-min w-full items-center justify-between rounded border p-3 text-left text-body ${
                      isSelected
                        ? 'border-soil-900 bg-sand-100 text-soil-900'
                        : 'border-soil-200 bg-sand-50 text-soil-900'
                    }`}
                  >
                    <span>{mob.name}</span>
                    <span className="text-soil-700">
                      <span className="font-data tabular-nums">{mob.headCount}</span>{' '}
                      {t('tally.headUnit')}
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
                save();
              }}
            >
              <fieldset className="mb-4 border-0 p-0">
                <legend className="mb-1 text-label uppercase text-soil-700">
                  {t('tally.reason')}
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  {REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={reason === r}
                      onClick={() => {
                        setReason(r);
                        setCount('');
                      }}
                      className={`min-h-touch-min rounded border px-4 font-ui text-body ${
                        reason === r
                          ? 'border-soil-900 bg-sand-100 text-soil-900'
                          : 'border-soil-200 bg-sand-50 text-soil-900'
                      }`}
                    >
                      {t(`tally.reason.${r}` as TranslationKey)}
                    </button>
                  ))}
                </div>
              </fieldset>

              {reason !== null && (
                <>
                  <div className="mb-4 flex flex-col">
                    <label htmlFor="count" className="mb-1 text-label uppercase text-soil-700">
                      {t(isRecount ? 'tally.countRecount' : 'tally.count')}
                    </label>
                    <input
                      id="count"
                      name="count"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={count}
                      onChange={(e) => setCount(e.target.value)}
                      className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
                    />
                  </div>

                  {/* ⭐ The arithmetic, before it is committed. This is the instrument the screen
                      exists to be: the farmer came to change a number and can see the number. */}
                  {projected !== null && !tooMany && (
                    <p className="mb-4 text-body text-soil-900">
                      <span className="font-data tabular-nums">{currentHead}</span>
                      {' → '}
                      <span className="font-data tabular-nums font-semibold">{projected}</span>{' '}
                      {t('tally.headUnit')}
                    </p>
                  )}

                  {/* Warning FORM — tinted panel with a left rule, never the ochre action shape
                      (NFR-411) — and it answers "so what do I do?" rather than only refusing. */}
                  {tooMany && (
                    <p className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
                      {t('tally.tooMany')}{' '}
                      <span className="font-data tabular-nums">{currentHead}</span>{' '}
                      {t('tally.headUnit')}. {t('tally.tooManyFix')}
                    </p>
                  )}

                  {/* Recording the loss is not filing the report, and saying so here is cheaper
                      than a farmer discovering it when the Stock Theft Unit asks for the case. */}
                  {reason === 'theft' && (
                    <p className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
                      {t('tally.theftNote')}{' '}
                      <Link to="/animals/theft/new" className="text-dam-700 underline">
                        {t('tally.theftLink')}
                      </Link>
                    </p>
                  )}

                  <div className="mb-4 flex flex-col">
                    <label htmlFor="day" className="mb-1 text-label uppercase text-soil-700">
                      {t(isRecount ? 'tally.dayCounted' : 'tally.day')}
                    </label>
                    <input
                      id="day"
                      name="day"
                      type="date"
                      max={farmToday()}
                      value={day}
                      onChange={(e) => setDay(e.target.value)}
                      className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
                    />
                  </div>

                  {trade && (
                    <>
                      <div className="mb-4 flex flex-col">
                        <label
                          htmlFor="counterparty"
                          className="mb-1 text-label uppercase text-soil-700"
                        >
                          {t(reason === 'sale' ? 'tally.buyer' : 'tally.seller')}
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
                          {t('tally.price')}
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
                    </>
                  )}

                  <button
                    type="submit"
                    className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
                    disabled={!canSave}
                  >
                    {t('tally.save')}
                  </button>
                </>
              )}
            </form>
          )}
        </>
      )}

      <Link to="/animals" className="mt-6 inline-block text-body text-dam-700">
        {t('tally.back')}
      </Link>
    </section>
  );
}
