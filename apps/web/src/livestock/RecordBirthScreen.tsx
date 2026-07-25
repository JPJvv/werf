/**
 * Record a birth (FR-104) — the calving-season capture, and the one that creates an animal as a
 * side effect of recording something else.
 *
 * TWO records come out of one action, which is why this screen exists rather than a farmer being
 * asked to do it in two places: the CALF's herd row (it is a new animal, filed under the dam's herd
 * and inheriting her species) and the BIRTH event, filed against the DAM. The event goes on the
 * cow's timeline because the calf has no history yet and "which cows calved, and how hard" is the
 * question a farmer actually asks at the end of a season.
 *
 * Ease score is the field most likely to be skipped and most worth having: a 4 or a 5 on the same
 * cow two seasons running is a culling decision, and nobody reconstructs it from memory in
 * September. It is asked as five large buttons rather than a number field, because it is a judgement
 * with five answers, not a measurement.
 *
 * Offline-first: `save` commits both records locally and instantly with no network in the path. The
 * outbox sends the calf (an animal) before the birth event that names it, which is the same FK
 * ordering every capture obeys.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ANIMAL_SEXES, schemas, uuidv7, type AnimalSex } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import { useAuth } from '../auth/AuthProvider';
import { farmDay } from '../farmTime';
import { useEffectiveAnimals } from './herd';
import { useRecordAnimal } from './LocalHerd';
import { useRecordBirth } from './LocalLifecycle';
import { useAnimalLabels } from './LocalIdentifiers';
import { speciesLabel, sexLabel } from './AnimalsScreen';

const EASE_SCORES = [1, 2, 3, 4, 5] as const;
type EaseScore = (typeof EASE_SCORES)[number];

/** A positive weight, or null when the field is empty or nonsense. */
function optionalWeight(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function RecordBirthScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const recordAnimal = useRecordAnimal();
  const recordBirth = useRecordBirth();
  const labels = useAnimalLabels();

  // Only females can calve, and only live ones. Offering the whole herd would make the picker the
  // longest part of the job on a farm where the dams are a known subset.
  const dams = useEffectiveAnimals().filter((a) => a.status === 'alive' && a.sex === 'female');

  const [damId, setDamId] = useState('');
  const [easeScore, setEaseScore] = useState<EaseScore>(1);
  const [multiples, setMultiples] = useState(1);
  const [calfSex, setCalfSex] = useState<AnimalSex>('female');
  const [birthWeight, setBirthWeight] = useState('');
  const [justSaved, setJustSaved] = useState<string | null>(null);

  const dam = useMemo(() => dams.find((a) => a.id === damId), [dams, damId]);

  if (!activeFarm) return null;

  const weightText = birthWeight.trim();
  const weightIsBad = weightText !== '' && optionalWeight(weightText) === null;
  const blocked = dam === undefined || weightIsBad;

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (blocked || !dam) return;

    const occurredAt = new Date();
    const calfId = uuidv7();
    const weight = optionalWeight(birthWeight);

    // The calf, as a herd row. It inherits the dam's species and herd — a Bonsmara cow does not
    // calve a sheep, and a calf filed under a different enterprise from its mother is a reporting
    // error waiting to happen (FR-113).
    recordAnimal(
      schemas.newAnimalSchema.parse({
        id: calfId,
        farmId: activeFarm.id,
        enterpriseId: dam.enterpriseId,
        species: dam.species,
        sex: calfSex,
        damId: dam.id,
        // Born today on this farm — the one case where the date of birth is known exactly rather
        // than estimated, which is the whole reason a birth capture is worth more than a headcount.
        dob: farmDay(occurredAt),
        dobEstimated: false,
        // It is where its mother is.
        landUnitId: dam.landUnitId,
        mobId: dam.mobId,
      }),
    );

    // The calving, against the dam.
    recordBirth({
      id: uuidv7(),
      farmId: activeFarm.id,
      animalId: dam.id,
      occurredAt,
      currentStatus: 'alive',
      calfId,
      easeScore,
      multiples,
      ...(weight === null ? {} : { birthWeightKg: weight }),
    });

    setJustSaved(labels.get(dam.id) ?? speciesLabel(t, dam.species));
    setBirthWeight('');
    setDamId('');
    setEaseScore(1);
    setMultiples(1);
  };

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('birth.title')}</h1>

      {justSaved !== null && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {justSaved} {t('birth.saved')}
        </p>
      )}

      {dams.length === 0 ? (
        <p className="text-body text-soil-700">{t('birth.noDams')}</p>
      ) : (
        <form onSubmit={save}>
          <div className="mb-4 flex flex-col">
            <label htmlFor="dam" className="mb-1 text-label uppercase text-soil-700">
              {t('birth.dam')}
            </label>
            <select
              id="dam"
              name="dam"
              value={damId}
              onChange={(e) => {
                setJustSaved(null);
                setDamId(e.target.value);
              }}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
            >
              <option value="">{t('birth.chooseDam')}</option>
              {dams.map((a) => (
                <option key={a.id} value={a.id}>
                  {labels.get(a.id) ?? speciesLabel(t, a.species)}
                  {a.breed ? ` · ${a.breed}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Five large buttons, not a number field: calving ease is a judgement with five answers,
              and a 4 or a 5 twice on the same cow is a culling decision nobody reconstructs later. */}
          <fieldset className="mb-4 border-0 p-0">
            <legend className="mb-1 text-label uppercase text-soil-700">{t('birth.ease')}</legend>
            <div className="flex gap-2">
              {EASE_SCORES.map((score) => (
                <button
                  key={score}
                  type="button"
                  aria-pressed={easeScore === score}
                  aria-label={`${t('birth.ease')} ${score}`}
                  onClick={() => setEaseScore(score)}
                  className={`min-h-touch-min flex-1 rounded border px-2 font-data text-data-lg tabular-nums ${
                    easeScore === score
                      ? 'border-soil-900 bg-sand-100 text-soil-900'
                      : 'border-soil-200 bg-sand-50 text-soil-900'
                  }`}
                >
                  {score}
                </button>
              ))}
            </div>
            <p className="mt-1 text-body text-soil-700">{t('birth.easeHint')}</p>
          </fieldset>

          <div className="mb-4 flex flex-col">
            <label htmlFor="calf-sex" className="mb-1 text-label uppercase text-soil-700">
              {t('birth.calfSex')}
            </label>
            <select
              id="calf-sex"
              name="calf-sex"
              value={calfSex}
              onChange={(e) => setCalfSex(e.target.value as AnimalSex)}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
            >
              {ANIMAL_SEXES.map((option) => (
                <option key={option} value={option}>
                  {sexLabel(t, option)}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-4 flex flex-col">
            <label htmlFor="multiples" className="mb-1 text-label uppercase text-soil-700">
              {t('birth.multiples')}
            </label>
            <select
              id="multiples"
              name="multiples"
              value={multiples}
              onChange={(e) => setMultiples(Number(e.target.value))}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
            >
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-6 flex flex-col">
            <label htmlFor="birth-weight" className="mb-1 text-label uppercase text-soil-700">
              {t('birth.weight')}
            </label>
            <input
              id="birth-weight"
              name="birth-weight"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={birthWeight}
              onChange={(e) => setBirthWeight(e.target.value)}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
            />
          </div>

          <button
            type="submit"
            disabled={blocked}
            className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
          >
            {t('birth.save')}
          </button>
        </form>
      )}

      <Link to="/animals" className="mt-6 inline-block text-body text-dam-700">
        {t('birth.back')}
      </Link>
    </section>
  );
}
