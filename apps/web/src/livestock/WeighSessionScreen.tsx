/**
 * The weigh session (FR-142, FR-140, FR-141) — the crush path. Built for the reference user with
 * gloves and four seconds: ONE animal on screen at a time, one large weight field, one ochre
 * primary action, and a commit that lands LOCALLY and instantly (no network anywhere in `save`,
 * .claude/rules/frontend.md, NFR-007). The rhythm is "type, Save & next, type, Save & next" down
 * the race — every save advances to the next animal in the herd, so a thumb never leaves the button.
 *
 * A prior weight for the animal, if there is one, is shown as context, and the growth since it
 * (FR-141 average daily gain) is stated after the save — a real negative is a real drought signal,
 * not an error. The method here is the crush scale; a tape/visual estimate belongs to a later slice.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { uuidv7 } from '@werf/core';
import { averageDailyGain } from '@werf/domain';
import { useTranslation } from '../i18n/LocaleProvider';
import { useAuth } from '../auth/AuthProvider';
import { useEffectiveAnimals } from './herd';
import { useAnimalWeights, useRecordWeight, type StoredWeight } from './LocalWeights';
import { useHydratedWeights, mergeById } from './HydratedLivestock';
import { useAnimalLabels } from './LocalIdentifiers';
import { speciesLabel, sexLabel } from './AnimalsScreen';

/** The most recent reading by when it was taken. ISO strings sort chronologically at one offset. */
function latestReading(readings: readonly StoredWeight[]): StoredWeight | undefined {
  return readings.reduce<StoredWeight | undefined>(
    (best, w) => (!best || w.occurredAt > best.occurredAt ? w : best),
    undefined,
  );
}

interface SavedSummary {
  readonly kg: number;
  /** kg/day since the previous reading, if there was one. Undefined when this was the first weigh. */
  readonly adg?: number;
}

export function WeighSessionScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  // A weigh session is for animals still in the herd — a lost animal is not in the crush.
  const animals = useEffectiveAnimals().filter((a) => a.status === 'alive');
  const record = useRecordWeight();
  const labels = useAnimalLabels();

  const [index, setIndex] = useState(0);
  const [kg, setKg] = useState('');
  const [savedCount, setSavedCount] = useState(0);
  const [lastSaved, setLastSaved] = useState<SavedSummary | null>(null);
  const [saving, setSaving] = useState(false);

  const animal = animals[index];
  // Read every render for the animal in front of us; at save time this is its readings so far.
  //
  // ⭐ Merged with hydrated weights (phase-checklists.md 3e) — without this, a reading another
  // device took was invisible here, so the "prior weight" context and the ADG shown after save
  // could both silently ignore the animal's most recent real weigh.
  const localReadings = useAnimalWeights(animal?.id ?? '');
  const hydratedWeights = useHydratedWeights();
  const priorReadings = useMemo(() => {
    const hydratedForAnimal = hydratedWeights.filter((w) => w.animalId === animal?.id);
    return mergeById(localReadings, hydratedForAnimal);
  }, [localReadings, hydratedWeights, animal?.id]);
  const prior = useMemo(() => latestReading(priorReadings), [priorReadings]);

  if (!activeFarm) return null;

  const value = Number(kg);
  const canSave = Number.isFinite(value) && value > 0;

  const advance = () => {
    setKg('');
    setIndex((i) => i + 1);
  };

  const save = async () => {
    if (!animal || !canSave || saving) return;
    setSaving(true);
    const now = new Date();

    // Growth since the most recent prior reading for this animal (FR-141), if any. A same-instant
    // pair has no elapsed time to divide by and throws — never let that crash a capture.
    let adg: number | undefined;
    if (prior) {
      try {
        adg = averageDailyGain(
          { kg: prior.kg, occurredAt: new Date(prior.occurredAt) },
          { kg: value, occurredAt: now },
        );
      } catch {
        adg = undefined;
      }
    }

    // Not "saved" until the local write is durable (P1.1) — never before, never gated on the
    // network, which never appears in this path.
    await record({
      id: uuidv7(),
      farmId: activeFarm.id,
      animalId: animal.id,
      occurredAt: now,
      kg: value,
      method: 'scale',
    });

    setLastSaved(adg === undefined ? { kg: value } : { kg: value, adg });
    setSavedCount((n) => n + 1);
    setSaving(false);
    advance();
  };

  const skip = () => {
    setLastSaved(null);
    advance();
  };

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('weigh.title')}</h1>

      {lastSaved && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {t('weigh.saved')} <span className="font-data tabular-nums">{lastSaved.kg}</span>{' '}
          {t('weigh.kgUnit')}
          {lastSaved.adg !== undefined && (
            <>
              {' · '}
              <span className="font-data tabular-nums">
                {lastSaved.adg >= 0 ? '+' : ''}
                {lastSaved.adg.toFixed(2)}
              </span>{' '}
              {t('weigh.perDay')}
            </>
          )}
        </p>
      )}

      {animals.length === 0 ? (
        <>
          <p className="mb-6 text-body text-soil-700">{t('weigh.empty')}</p>
          <Link
            to="/animals/new"
            className="flex min-h-touch-primary items-center justify-center rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action no-underline"
          >
            {t('weigh.emptyAction')}
          </Link>
        </>
      ) : animal ? (
        <>
          <p className="mb-1 font-data text-data-lg tabular-nums text-soil-700">
            {`${index + 1} ${t('weigh.of')} ${animals.length}`}
          </p>
          {/* The number first, and large: it is what the farmer reads off the ear to confirm the
              right animal is in the crush. Species and sex are the confirmation, not the identity. */}
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
            {animal.breed ? ` · ${animal.breed}` : ''}
          </p>

          {prior && (
            <p className="mb-4 text-body text-soil-700">
              {t('weigh.last')}{' '}
              <span className="font-data tabular-nums text-soil-900">{prior.kg}</span>{' '}
              {t('weigh.kgUnit')}
            </p>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="mb-6 flex flex-col">
              <label htmlFor="kg" className="mb-1 text-label uppercase text-soil-700">
                {t('weigh.kg')}
              </label>
              <input
                id="kg"
                name="kg"
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
              disabled={!canSave || saving}
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
            {t('weigh.done.count')}
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
