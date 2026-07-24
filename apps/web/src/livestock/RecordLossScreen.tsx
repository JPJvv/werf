/**
 * Record a loss (FR-105/106) — a death or a sale. Either way the animal leaves the live herd: a
 * lifecycle event is captured here and folded onto the herd by the projection, which moves the
 * animal through the domain state machine (→ 'dead' or 'sold') and drops it from live head. The
 * animal is RETAINED forever — it still shows in the list, marked — because a farmer's records and
 * the audit/financial trail keep the tombstone; it is only excluded from "how many do I have".
 *
 * Offline-first like every capture: `save` commits locally and instantly with no network in the
 * path (NFR-007). Pick the animal, say what happened, record it. A cull and a missing report follow
 * the same shape and land as later slices.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { uuidv7 } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import { useAuth } from '../auth/AuthProvider';
import { useEffectiveAnimals } from './herd';
import { useRecordDeath, useRecordSale } from './LocalLifecycle';
import { speciesLabel, sexLabel } from './AnimalsScreen';

type Outcome = 'died' | 'sold';

interface SavedSummary {
  readonly species: string;
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

export function RecordLossScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const recordDeath = useRecordDeath();
  const recordSale = useRecordSale();
  const live = useEffectiveAnimals().filter((a) => a.status === 'alive');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [cause, setCause] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [priceRands, setPriceRands] = useState('');
  const [lastSaved, setLastSaved] = useState<SavedSummary | null>(null);

  if (!activeFarm) return null;

  const selected = live.find((a) => a.id === selectedId) ?? null;

  const reset = () => {
    setSelectedId(null);
    setOutcome(null);
    setCause('');
    setCounterparty('');
    setPriceRands('');
  };

  const pick = (id: string) => {
    setLastSaved(null);
    setSelectedId(id);
    setOutcome(null);
  };

  const save = () => {
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
    } else {
      return;
    }
    setLastSaved({ species: speciesLabel(t, selected.species), outcome });
    reset();
  };

  const savedSuffix = (o: Outcome): string =>
    t(o === 'died' ? 'loss.savedSuffix' : 'loss.savedSuffixSold');

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('loss.title')}</h1>

      {lastSaved && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {lastSaved.species} {savedSuffix(lastSaved.outcome)}
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
                    <span>{speciesLabel(t, animal.species)}</span>
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
                save();
              }}
            >
              <fieldset className="mb-4 border-0 p-0">
                <legend className="mb-1 text-label uppercase text-soil-700">
                  {t('loss.outcome')}
                </legend>
                <div className="flex gap-2">
                  {(['died', 'sold'] as const).map((o) => (
                    <button
                      key={o}
                      type="button"
                      aria-pressed={outcome === o}
                      onClick={() => setOutcome(o)}
                      className={`min-h-touch-min flex-1 rounded border px-4 font-ui text-body ${
                        outcome === o
                          ? 'border-soil-900 bg-sand-100 text-soil-900'
                          : 'border-soil-200 bg-sand-50 text-soil-900'
                      }`}
                    >
                      {t(o === 'died' ? 'loss.died' : 'loss.sold')}
                    </button>
                  ))}
                </div>
              </fieldset>

              {outcome === 'died' && (
                <div className="mb-6 flex flex-col">
                  <label htmlFor="cause" className="mb-1 text-label uppercase text-soil-700">
                    {t('loss.cause')}
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
                  disabled={
                    outcome === 'died'
                      ? cause.trim().length === 0
                      : counterparty.trim().length === 0 || !priceIsValid(priceRands)
                  }
                >
                  {t(outcome === 'died' ? 'loss.save' : 'loss.saveSale')}
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
