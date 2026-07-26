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

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { uuidv7, type schemas } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { useAuth } from '../auth/AuthProvider';
import { farmToday } from '../farmTime';
import { useEffectiveMobs } from './herd';
import { useRecordTally } from './LocalTallies';

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

const INCREASES: readonly schemas.TallyReason[] = ['birth', 'purchase'];

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

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState<schemas.TallyReason | null>(null);
  const [count, setCount] = useState('');
  const [day, setDay] = useState(farmToday);
  const [counterparty, setCounterparty] = useState('');
  const [priceRands, setPriceRands] = useState('');
  const [lastSaved, setLastSaved] = useState<{ name: string; head: number } | null>(null);

  if (!activeFarm) return null;

  // Only groups managed BY a head count can be tallied. One that is a bag of individually-recorded
  // animals gets its number by counting those, and a second count of the same sheep would compete
  // with it — so those are not offered here rather than being offered and refused.
  const counted = mobs.filter((m) => m.headCount !== null);
  const selected = counted.find((m) => m.id === selectedId) ?? null;
  const currentHead = selected?.headCount ?? null;

  const typed = parseCount(count);
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

  const canSave =
    selected !== null &&
    reason !== null &&
    typed !== null &&
    !tooMany &&
    !changesNothing &&
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

    recordTally({
      id: uuidv7(),
      farmId: activeFarm.id,
      mobId: selected.id,
      // Midday on the farm's day, exactly as the missing report does it: the farmer gave a DAY, and
      // midday cannot slide either side of it when the instant is read back in any zone.
      occurredAt: new Date(`${day}T12:00:00.000Z`),
      reason,
      count: typed,
      currentHead,
      ...(buyer === undefined ? {} : { counterparty: buyer }),
      ...(price === undefined ? {} : { priceCents: price }),
    });

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
