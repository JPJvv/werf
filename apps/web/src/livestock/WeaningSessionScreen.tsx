/**
 * The weaning session (FR-111) — the crush path again, because weaning IS a crush day: a race of
 * calves comes off their mothers and each one is weighed as it goes through. Same shape as the
 * weigh session for exactly that reason: one animal on screen, one large field, one ochre action,
 * a Skip, and a thumb that never leaves the button.
 *
 * The session walks the animals that have a recorded dam and have not been weaned yet — which is
 * the set a farmer is actually working through. An animal with no dam on file is not offered here;
 * it is not a mistake, it is a bought-in animal that was never a calf on this farm.
 *
 * Offline-first: `save` commits locally and instantly with no network in the path (NFR-007).
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { uuidv7 } from '@werf/core';
import { calendarDaysBetween } from '@werf/domain';
import { useTranslation } from '../i18n/LocaleProvider';
import { useAuth } from '../auth/AuthProvider';
import { farmDay } from '../farmTime';
import { useEffectiveAnimals, useEffectiveAnimalsSettled } from './herd';
import { useLifecycleEvents, useRecordWeaning } from './LocalLifecycle';
import { useHydratedLifecycleEvents, useHydratedLifecycleEventsSettled } from './HydratedLivestock';
import { useAnimalLabels } from './LocalIdentifiers';
import type { StoredAnimal } from './LocalHerd';
import { speciesLabel, sexLabel } from './AnimalsScreen';

export function WeaningSessionScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const live = useEffectiveAnimals().filter((a) => a.status === 'alive');
  const events = useLifecycleEvents();
  const hydratedEvents = useHydratedLifecycleEvents();
  const labels = useAnimalLabels();
  const record = useRecordWeaning();
  // Both called unconditionally, one per line — `useX() && useY()` inline would short-circuit and
  // skip calling useY() whenever useX() is false, breaking the Rules of Hooks (TagSessionScreen.tsx
  // has the same discipline for the same reason).
  const animalsSettled = useEffectiveAnimalsSettled();
  const hydratedEventsSettled = useHydratedLifecycleEventsSettled();
  const readyToOpen = animalsSettled && hydratedEventsSettled;

  // ⭐ Merged with hydrated lifecycle events (phase-checklists.md 3e) — without this, a weaning
  // another device already sent, once replicated down, was invisible here, so the queue offered an
  // animal a co-worker had already weaned and let this device record it a second time.
  const alreadyWeaned = useMemo(() => {
    const local = events.filter((e) => e.type === 'weaning').map((e) => e.animalId);
    const hydrated = hydratedEvents.filter((e) => e.type === 'weaning').map((e) => e.animalId);
    return new Set([...local, ...hydrated]);
  }, [events, hydratedEvents]);

  // Fixed once every store it is built from has hydrated, like the tagging session: a queue that
  // shrank under the farmer's thumb after each save would make working down a race impossible to
  // follow. Captured on the first render `readyToOpen` is true, not at mount — see
  // TagSessionScreen.tsx's identical fix for why a mount-time snapshot froze on an empty herd on
  // every cold start once the capture stores began hydrating asynchronously (phase-checklists.md 3c).
  const [queue, setQueue] = useState<readonly StoredAnimal[] | null>(null);
  useEffect(() => {
    if (readyToOpen && queue === null) {
      setQueue(live.filter((a) => a.damId !== null && !alreadyWeaned.has(a.id)));
    }
    // Deliberately NOT depending on `live`/`alreadyWeaned`: this must run exactly once, the first
    // time `readyToOpen` becomes true, and never again — see the comment above.
  }, [readyToOpen]);

  const [index, setIndex] = useState(0);
  const [kg, setKg] = useState('');
  const [savedCount, setSavedCount] = useState(0);
  const [lastSaved, setLastSaved] = useState<number | null>(null);

  if (!activeFarm) return null;

  if (queue === null) {
    return (
      <section className="mx-auto w-full max-w-3xl p-4">
        <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('wean.title')}</h1>
        <p className="mb-6 text-body text-soil-700">{t('wean.loading')}</p>
      </section>
    );
  }

  const animal = queue[index];
  const value = Number(kg);
  const canSave = Number.isFinite(value) && value > 0;

  /**
   * Age at weaning, in days, when the date of birth is known. Derived rather than asked: a farmer
   * in a race is not going to work out that a calf is 207 days old, and the app already knows —
   * for a calf born here, exactly, because a birth capture records the real day rather than an
   * estimate. Omitted entirely when there is no DOB, since a guessed age is worse than no age in a
   * growth comparison.
   */
  const ageDays = (dob: string | null, on: Date): number | undefined => {
    if (dob === null) return undefined;
    const days = calendarDaysBetween(dob, farmDay(on));
    return days >= 0 ? days : undefined;
  };

  const advance = () => {
    setKg('');
    setIndex((i) => i + 1);
  };

  const save = () => {
    if (!animal || !canSave) return;
    const occurredAt = new Date();
    const age = ageDays(animal.dob, occurredAt);

    record({
      id: uuidv7(),
      farmId: activeFarm.id,
      animalId: animal.id,
      occurredAt,
      currentStatus: 'alive',
      weightKg: value,
      ...(age === undefined ? {} : { ageDays: age }),
    });

    setLastSaved(value);
    setSavedCount((n) => n + 1);
    advance();
  };

  const skip = () => {
    setLastSaved(null);
    advance();
  };

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('wean.title')}</h1>

      {lastSaved !== null && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {t('wean.saved')} <span className="font-data tabular-nums">{lastSaved}</span>{' '}
          {t('weigh.kgUnit')}
        </p>
      )}

      {queue.length === 0 ? (
        <p className="mb-6 text-body text-soil-700">{t('wean.empty')}</p>
      ) : animal ? (
        <>
          <p className="mb-1 font-data text-data-lg tabular-nums text-soil-700">
            {`${index + 1} ${t('wean.of')} ${queue.length}`}
          </p>
          <p className="mb-4 text-body text-soil-900">
            {labels.has(animal.id) && (
              <>
                <span className="font-data text-data-lg tabular-nums">{labels.get(animal.id)}</span>
                {' · '}
              </>
            )}
            {speciesLabel(t, animal.species)}
            {' · '}
            {sexLabel(t, animal.sex)}
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="mb-6 flex flex-col">
              <label htmlFor="wean-kg" className="mb-1 text-label uppercase text-soil-700">
                {t('wean.kg')}
              </label>
              <input
                id="wean-kg"
                name="wean-kg"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={kg}
                onChange={(e) => setKg(e.target.value)}
                className="min-h-touch-primary rounded border border-soil-200 bg-sand-100 px-3 font-data text-data-lg tabular-nums text-soil-900"
              />
            </div>

            <button
              type="submit"
              disabled={!canSave}
              className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
            >
              {t('weigh.save')}
            </button>
          </form>

          <button
            type="button"
            onClick={skip}
            className="mt-4 min-h-touch-min w-full rounded border border-soil-200 px-4 font-ui text-body text-soil-900"
          >
            {t('weigh.skip')}
          </button>
        </>
      ) : (
        <>
          <p className="mb-6 text-body text-soil-900">
            <span className="font-data text-data-lg tabular-nums">{savedCount}</span>{' '}
            {t('wean.done.count')}
          </p>
          <Link to="/animals" className="inline-block text-body text-dam-700">
            {t('weigh.done.link')}
          </Link>
        </>
      )}

      <Link to="/animals" className="mt-6 block text-body text-dam-700">
        {t('weigh.back')}
      </Link>
    </section>
  );
}
