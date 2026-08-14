/**
 * Record a birth (FR-104) — the calving-season capture, and the one that creates an animal as a
 * side effect of recording something else.
 *
 * TWO records come out of one calf, which is why this screen exists rather than a farmer being
 * asked to do it in two places: the CALF's herd row (it is a new animal, filed under the dam's herd
 * and inheriting her species) and the BIRTH event, filed against the DAM. The event goes on the
 * cow's timeline because the calf has no history yet and "which cows calved, and how hard" is the
 * question a farmer actually asks at the end of a season.
 *
 * ⭐ A TWIN BIRTH PRODUCES TWO OF EACH. This screen used to mint exactly one calf however many were
 * born, while storing `multiples: 2` on the event — so a lambing season left the flock short by one
 * per twin birth, and the two facts contradicted each other inside the same action. `birthPayload`
 * names ONE `calfId` and carries the multiple count, so the shape that fits it is one event per
 * calf, each recording that it was one of N. Two lambs, two herd rows, two events, one count that
 * is right. Sheep twin routinely; this is not an edge case, it is the middle of a lambing season.
 *
 * Each calf gets its own sex and its own birth weight, because twins differ in both and a screen
 * that asks once and applies the answer twice is inventing data rather than capturing it.
 *
 * Ease score is asked ONCE and applies to every calf: it is the DAM's calving, not the calf's, and
 * it is the field most likely to be skipped and most worth having — a 4 or a 5 on the same cow two
 * seasons running is a culling decision nobody reconstructs from memory in September. Five large
 * buttons rather than a number field, because it is a judgement with five answers, not a measurement.
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

/** How many can be born at once. Three covers cattle and sheep; more is not a thing to plan for. */
const MULTIPLE_COUNTS = [1, 2, 3] as const;

/** One calf as it is being typed. Its weight stays TEXT until save — "3." is mid-typing, not bad. */
interface CalfDraft {
  readonly sex: AnimalSex;
  readonly weightText: string;
}

const BLANK_CALF: CalfDraft = { sex: 'female', weightText: '' };

/**
 * Grow or shrink the list of calves to `count`, keeping what has already been typed. A farmer who
 * fills in the first lamb and then realises there were two must not lose the first one's details.
 */
function resize(calves: readonly CalfDraft[], count: number): readonly CalfDraft[] {
  if (count === calves.length) return calves;
  if (count < calves.length) return calves.slice(0, count);
  return [...calves, ...Array.from({ length: count - calves.length }, () => BLANK_CALF)];
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
  const [calves, setCalves] = useState<readonly CalfDraft[]>([BLANK_CALF]);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dam = useMemo(() => dams.find((a) => a.id === damId), [dams, damId]);

  if (!activeFarm) return null;

  const multiples = calves.length;
  // A weight is optional, but a weight that is TYPED and nonsense blocks the save — a silently
  // dropped number is worse than being asked to look at it again.
  const weightIsBad = calves.some(
    (calf) => calf.weightText.trim() !== '' && optionalWeight(calf.weightText) === null,
  );
  const blocked = dam === undefined || weightIsBad;

  const updateCalf = (index: number, change: Partial<CalfDraft>) => {
    setCalves((previous) => previous.map((c, i) => (i === index ? { ...c, ...change } : c)));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (blocked || !dam || saving) return;
    setSaving(true);

    // One instant for the whole calving: twins are born minutes apart and recorded together, and
    // two births of the same litter that disagree about the day would be worse than a shared one.
    const occurredAt = new Date();
    const dob = farmDay(occurredAt);

    const writes: Promise<void>[] = [];
    for (const calf of calves) {
      const calfId = uuidv7();
      const weight = optionalWeight(calf.weightText);

      // The calf, as a herd row. It inherits the dam's species and herd — a Bonsmara cow does not
      // calve a sheep, and a calf filed under a different enterprise from its mother is a reporting
      // error waiting to happen (FR-113).
      writes.push(
        recordAnimal(
          schemas.newAnimalSchema.parse({
            id: calfId,
            farmId: activeFarm.id,
            enterpriseId: dam.enterpriseId,
            species: dam.species,
            sex: calf.sex,
            damId: dam.id,
            // Born today on this farm — the one case where the date of birth is known exactly
            // rather than estimated, which is the whole reason a birth capture beats a headcount.
            dob,
            dobEstimated: false,
            // It is where its mother is.
            landUnitId: dam.landUnitId,
            mobId: dam.mobId,
          }),
        ),
      );

      // The calving, against the dam — one per calf, each carrying the multiple count, so the
      // herd rows and the events agree about how many were born. See the module header.
      writes.push(
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
        }),
      );
    }

    // Not "saved" until every calf's herd row AND its birth event are durable (P1.1) — a twin
    // birth is one act, and the confirmation must not appear while half of it is still in flight.
    await Promise.all(writes);

    setJustSaved(labels.get(dam.id) ?? speciesLabel(t, dam.species));
    setCalves([BLANK_CALF]);
    setDamId('');
    setEaseScore(1);
    setSaving(false);
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

          {/* The count comes BEFORE the calves, because it decides how many there are to fill in.
              Answering it grows the list below and keeps whatever is already typed. */}
          <div className="mb-4 flex flex-col">
            <label htmlFor="multiples" className="mb-1 text-label uppercase text-soil-700">
              {t('birth.multiples')}
            </label>
            <select
              id="multiples"
              name="multiples"
              value={multiples}
              onChange={(e) => setCalves((previous) => resize(previous, Number(e.target.value)))}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
            >
              {MULTIPLE_COUNTS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          {/* One block per calf. A single birth is unchanged — "The calf is" and one weight field,
              no numbering — because numbering one of one is noise in a lambing pen. */}
          {calves.map((calf, index) => (
            <fieldset
              key={index}
              className={`border-0 p-0 ${index === multiples - 1 ? 'mb-6' : 'mb-4'}`}
            >
              {multiples > 1 && (
                <legend className="mb-1 text-label uppercase text-soil-700">
                  {t('birth.calf')} <span className="font-data tabular-nums">{index + 1}</span>
                </legend>
              )}
              <div className="mb-4 flex flex-col">
                <label
                  htmlFor={`calf-sex-${index}`}
                  className="mb-1 text-label uppercase text-soil-700"
                >
                  {t('birth.calfSex')}
                </label>
                <select
                  id={`calf-sex-${index}`}
                  name={`calf-sex-${index}`}
                  value={calf.sex}
                  onChange={(e) => updateCalf(index, { sex: e.target.value as AnimalSex })}
                  className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
                >
                  {ANIMAL_SEXES.map((option) => (
                    <option key={option} value={option}>
                      {sexLabel(t, option)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col">
                <label
                  htmlFor={`birth-weight-${index}`}
                  className="mb-1 text-label uppercase text-soil-700"
                >
                  {t('birth.weight')}
                </label>
                <input
                  id={`birth-weight-${index}`}
                  name={`birth-weight-${index}`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={calf.weightText}
                  onChange={(e) => updateCalf(index, { weightText: e.target.value })}
                  className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
                />
              </div>
            </fieldset>
          ))}

          <button
            type="submit"
            disabled={blocked || saving}
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
