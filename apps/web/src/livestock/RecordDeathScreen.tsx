/**
 * Record a loss (FR-105) — a death. A death is not an edit of the animal (the herd log is
 * append-only); it is a lifecycle event captured here and folded onto the herd by the projection,
 * which moves the animal to 'dead' through the domain state machine and drops it from the live
 * count. The animal is RETAINED forever — it still shows in the list, marked — because a farmer's
 * records and the audit trail keep the tombstone; it is only excluded from "how many do I have".
 *
 * Offline-first like every capture: `save` commits locally and instantly with no network in the
 * path (NFR-007). Pick the animal that died, give a cause, record it. Sale, cull and a missing
 * report follow the same shape and land as later slices.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { uuidv7 } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import { useAuth } from '../auth/AuthProvider';
import { useEffectiveAnimals } from './herd';
import { useRecordDeath } from './LocalLifecycle';
import { speciesLabel, sexLabel } from './AnimalsScreen';

export function RecordDeathScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const record = useRecordDeath();
  const live = useEffectiveAnimals().filter((a) => a.status === 'alive');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cause, setCause] = useState('');
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  if (!activeFarm) return null;

  const selected = live.find((a) => a.id === selectedId) ?? null;
  const canSave = selected !== null && cause.trim().length > 0;

  const pick = (id: string) => {
    setLastSaved(null);
    setSelectedId(id);
  };

  const save = () => {
    if (!selected || cause.trim().length === 0) return;
    record({
      id: uuidv7(),
      farmId: activeFarm.id,
      animalId: selected.id,
      occurredAt: new Date(),
      currentStatus: 'alive',
      cause: cause.trim(),
    });
    setLastSaved(speciesLabel(t, selected.species));
    setSelectedId(null);
    setCause('');
  };

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('loss.title')}</h1>

      {lastSaved && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {lastSaved} {t('loss.savedSuffix')}
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

              <button
                type="submit"
                disabled={!canSave}
                className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
              >
                {t('loss.save')}
              </button>
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
