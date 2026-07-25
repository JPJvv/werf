/**
 * Record a loss (FR-105/106/605) — a death, a sale, or a missing report. Either way the animal
 * leaves the live herd: a lifecycle event is captured here and folded onto the herd by the
 * projection, which moves the animal through the domain state machine (→ 'dead', 'sold' or
 * 'missing') and drops it from live head. The animal is RETAINED forever — it still shows in the
 * list, marked — because a farmer's records and the audit/financial trail keep the tombstone; it is
 * only excluded from "how many do I have".
 *
 * ⭐ MISSING is not just a third radio button. It is the stock-theft path (legal-compliance.md
 * § 3.2), and the thing that makes the record worth anything to the SAPS Stock Theft Unit is the
 * GPS point and the day it was LAST SEEN — which is days before the farmer is standing here. So this
 * screen asks for the day rather than assuming today, and it takes a real fix rather than saving
 * without one. Geolocation works with no signal (GPS is a receiver, not a connection), so requiring
 * it costs an offline farmer nothing; when it genuinely fails, the reason is named, because
 * "permission denied" and "no signal" need different actions from the person holding the phone.
 *
 * Offline-first like every capture: `save` commits locally and instantly with no network in the
 * path (NFR-007).
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { uuidv7 } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { useAuth } from '../auth/AuthProvider';
import { farmToday } from '../farmTime';
import { useEffectiveAnimals } from './herd';
import { useRecordDeath, useRecordMissing, useRecordSale } from './LocalLifecycle';
import { useAnimalLabels } from './LocalIdentifiers';
import { currentPoint, type FixFailure } from './geolocation';
import { speciesLabel, sexLabel } from './AnimalsScreen';

type Outcome = 'died' | 'sold' | 'missing';

interface SavedSummary {
  readonly what: string;
  readonly outcome: Outcome;
}

/** Rands as typed → integer cents (Money). Rounded at the I/O boundary, never carried as a float. */
function toCents(rands: string): number {
  return Math.round(Number(rands) * 100);
}

function priceIsValid(rands: string): boolean {
  const n = Number(rands);
  return rands.trim() !== '' && Number.isFinite(n) && n >= 0;
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
  const live = useEffectiveAnimals().filter((a) => a.status === 'alive');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [cause, setCause] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [priceRands, setPriceRands] = useState('');
  const [lastSeenDay, setLastSeenDay] = useState(today);
  const [locating, setLocating] = useState(false);
  const [fixFailed, setFixFailed] = useState<FixFailure | null>(null);
  const [lastSaved, setLastSaved] = useState<SavedSummary | null>(null);

  if (!activeFarm) return null;

  const selected = live.find((a) => a.id === selectedId) ?? null;

  const reset = () => {
    setSelectedId(null);
    setOutcome(null);
    setCause('');
    setCounterparty('');
    setPriceRands('');
    setLastSeenDay(today());
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

  const save = async () => {
    if (!selected) return;
    const base = {
      id: uuidv7(),
      farmId: activeFarm.id,
      animalId: selected.id,
      occurredAt: new Date(),
      currentStatus: 'alive' as const,
    };

    if (outcome === 'died') {
      if (cause.trim().length === 0) return;
      recordDeath({ ...base, cause: cause.trim() });
    } else if (outcome === 'sold') {
      if (counterparty.trim().length === 0 || !priceIsValid(priceRands)) return;
      recordSale({
        ...base,
        counterparty: counterparty.trim(),
        priceCents: toCents(priceRands),
      });
    } else if (outcome === 'missing') {
      // The fix is taken HERE, not on selection: a farmer who picks an animal and then walks to
      // where they last saw it should get the point from where they are standing when they record.
      setLocating(true);
      const fix = await currentPoint();
      setLocating(false);
      if (!fix.ok) {
        setFixFailed(fix.reason);
        return;
      }
      recordMissing({
        ...base,
        // The day the farmer gave, not today: a missing report is filed after the fact, and a
        // theft dated to the day it was noticed is a theft dated wrong.
        occurredAt: new Date(`${lastSeenDay}T12:00:00.000Z`),
        lastSeenGeojson: fix.geojson,
        ...(cause.trim().length === 0 ? {} : { cause: cause.trim() }),
      });
    } else {
      return;
    }

    setLastSaved({ what: nameOf(selected), outcome });
    reset();
  };

  const savedSuffix = (o: Outcome): TranslationKey =>
    o === 'died'
      ? 'loss.savedSuffix'
      : o === 'sold'
        ? 'loss.savedSuffixSold'
        : 'loss.savedSuffixMissing';

  const canSave =
    outcome === 'died'
      ? cause.trim().length > 0
      : outcome === 'sold'
        ? counterparty.trim().length > 0 && priceIsValid(priceRands)
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
                  {(['died', 'sold', 'missing'] as const).map((o) => (
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
                    <p className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
                      {t(`loss.gps.${fixFailed}` as TranslationKey)}
                    </p>
                  )}
                </>
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
                  <div className="mb-6 flex flex-col">
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
                </>
              )}

              {outcome !== null && (
                <button
                  type="submit"
                  className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
                  disabled={!canSave}
                >
                  {locating
                    ? t('loss.locating')
                    : t(
                        outcome === 'died'
                          ? 'loss.save'
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
