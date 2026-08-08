/**
 * Record a pregnancy diagnosis (FR-121) — filed against the DAM, and the screen where a projected
 * calving date appears while the farmer is still standing at the crush.
 *
 * ⭐ THE DUE DATE SHOWN HERE IS A PREVIEW AND IS NOT WHAT GETS STORED. It is computed with
 * `projectDueDate` — the same pure domain function the server runs — from the gestation figures
 * this device has cached. The date that is KEPT is projected server-side at capture from
 * `species_gestation` (ADR-0005, FR-121), which is why the wire carries the service date and never
 * the due date: a device that could send the date could assert a calving date nothing on the
 * server can check, into the field a calving report is planned from. If the cache is stale the two
 * can differ, and the server's is the one that counts.
 *
 * ⛔ A SPECIES WITH NO GESTATION FIGURE STILL RECORDS THE DIAGNOSIS. A positive test on a game
 * animal is a real fact and refusing it would lose the fact to protect a projection. What the
 * screen does instead is say plainly that no calving date can be projected and why — `poultry` does
 * not gestate at all, and `game` spans a hundred days between a springbok and a kudu, so any single
 * figure would be wrong for most of the animals it was read for. A loud absence beats a quiet
 * fabrication, and the farmer finds out here rather than from a date that was never true.
 *
 * The service date is PREFILLED from the most recent mating this device holds for the dam, because
 * the pair of screens is one workflow: served in November, tested in February, and nobody should
 * retype a date the phone already has. For a running-bull window it prefills BULL-IN — the earliest
 * the service could have been, so the projected calving date is the earliest she could calve. When
 * that error runs the wrong way a farmer watches an empty camp for a week; the other way she calves
 * unattended.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { uuidv7 } from '@werf/core';
import { projectDueDate } from '@werf/domain';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { useAuth } from '../auth/AuthProvider';
import { farmDay, farmToday } from '../farmTime';
import { useEffectiveAnimals } from './herd';
import { useAnimalLabels } from './LocalIdentifiers';
import {
  useBreedingEvents,
  useRecordBreeding,
  type PregnancyMethod,
  type PregnancyResult,
  type StoredMating,
} from './LocalBreeding';
import { useGestationDays } from './LocalSpeciesGestation';
import { speciesLabel } from './AnimalsScreen';

const METHODS: readonly PregnancyMethod[] = ['palpation', 'ultrasound', 'blood', 'visual'];
const RESULTS: readonly PregnancyResult[] = ['pregnant', 'open', 'uncertain'];

const METHOD_KEY: Record<PregnancyMethod, TranslationKey> = {
  palpation: 'pregnancy.method.palpation',
  ultrasound: 'pregnancy.method.ultrasound',
  blood: 'pregnancy.method.blood',
  visual: 'pregnancy.method.visual',
};

const RESULT_KEY: Record<PregnancyResult, TranslationKey> = {
  pregnant: 'pregnancy.result.pregnant',
  open: 'pregnancy.result.open',
  uncertain: 'pregnancy.result.uncertain',
};

function instantForDay(day: string): string {
  return day === farmToday() ? new Date().toISOString() : `${day}T12:00:00.000Z`;
}

/**
 * The service date to offer for a dam, from the latest mating this device holds for her.
 *
 * For a window it is BULL-IN, the earliest the service could have been — see the module header for
 * which way that error is allowed to run. For a dated service it is the day the event sits on.
 */
function serviceDayFrom(mating: StoredMating): string {
  return mating.bullInAt ?? farmDay(new Date(mating.occurredAt));
}

export function RecordPregnancyScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const recordBreeding = useRecordBreeding();
  const labels = useAnimalLabels();
  const breeding = useBreedingEvents();

  const dams = useEffectiveAnimals().filter((a) => a.status === 'alive' && a.sex === 'female');

  const [damId, setDamId] = useState('');
  const [method, setMethod] = useState<PregnancyMethod>('palpation');
  const [result, setResult] = useState<PregnancyResult>('pregnant');
  const [testedOn, setTestedOn] = useState(() => farmToday());
  // Null means "not yet touched by the farmer", so the prefill below can still fill it in. Once
  // they type, their value wins and a change of dam does not silently overwrite it.
  const [matingDate, setMatingDate] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);

  const dam = useMemo(() => dams.find((a) => a.id === damId), [dams, damId]);

  // The latest mating this device holds for her. `(occurredAt, id)` is the same total order the
  // projections use — day-grained captures tie on the instant routinely, and the id is a UUIDv7,
  // so it breaks the tie the same way on every device.
  const lastMating = useMemo(() => {
    const hers = breeding.filter(
      (e): e is StoredMating => e.kind === 'mating' && e.animalId === damId,
    );
    return hers.sort((a, b) =>
      a.occurredAt === b.occurredAt
        ? a.id.localeCompare(b.id)
        : a.occurredAt.localeCompare(b.occurredAt),
    )[hers.length - 1];
  }, [breeding, damId]);

  const suggested = lastMating === undefined ? '' : serviceDayFrom(lastMating);
  const effectiveMatingDate = matingDate ?? suggested;

  const gestation = useGestationDays(dam?.species);
  const projecting = result === 'pregnant' && effectiveMatingDate !== '';
  const dueDate =
    projecting && gestation.status === 'known'
      ? projectDueDate(effectiveMatingDate, gestation.gestationDays)
      : null;

  if (!activeFarm) return null;

  const blocked = dam === undefined || testedOn === '';

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (blocked || !dam) return;

    recordBreeding({
      id: uuidv7(),
      kind: 'pregnancyTest',
      farmId: activeFarm.id,
      animalId: dam.id,
      occurredAt: instantForDay(testedOn),
      method,
      result,
      // Only sent when it is known AND the result is one a due date could follow from. A service
      // date on an `open` result is not wrong, but it is noise the server would ignore.
      ...(projecting ? { matingDate: effectiveMatingDate } : {}),
    });

    setJustSaved(labels.get(dam.id) ?? speciesLabel(t, dam.species));
    setDamId('');
    setMatingDate(null);
  };

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('pregnancy.title')}</h1>

      {justSaved !== null && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {justSaved} {t('pregnancy.saved')}
        </p>
      )}

      {dams.length === 0 ? (
        <p className="text-body text-soil-700">{t('pregnancy.noDams')}</p>
      ) : (
        <form onSubmit={save}>
          <div className="mb-4 flex flex-col">
            <label htmlFor="dam" className="mb-1 text-label uppercase text-soil-700">
              {t('pregnancy.dam')}
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
              <option value="">{t('pregnancy.chooseDam')}</option>
              {dams.map((a) => (
                <option key={a.id} value={a.id}>
                  {labels.get(a.id) ?? speciesLabel(t, a.species)}
                  {a.breed ? ` · ${a.breed}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* The result comes before the method: it is the answer the farmer walked away with, and
              what is asked below depends on it. */}
          <fieldset className="mb-4 border-0 p-0">
            <legend className="mb-1 text-label uppercase text-soil-700">
              {t('pregnancy.result')}
            </legend>
            <div className="flex gap-2">
              {RESULTS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={result === option}
                  onClick={() => setResult(option)}
                  className={`min-h-touch-min flex-1 rounded border px-2 font-ui text-body ${
                    result === option
                      ? 'border-soil-900 bg-sand-100 text-soil-900'
                      : 'border-soil-200 bg-sand-50 text-soil-900'
                  }`}
                >
                  {t(RESULT_KEY[option])}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="mb-4 flex flex-col">
            <label htmlFor="method" className="mb-1 text-label uppercase text-soil-700">
              {t('pregnancy.method')}
            </label>
            <select
              id="method"
              name="method"
              value={method}
              onChange={(e) => setMethod(e.target.value as PregnancyMethod)}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
            >
              {METHODS.map((option) => (
                <option key={option} value={option}>
                  {t(METHOD_KEY[option])}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-4 flex flex-col">
            <label htmlFor="testedOn" className="mb-1 text-label uppercase text-soil-700">
              {t('pregnancy.testedOn')}
            </label>
            <input
              id="testedOn"
              name="testedOn"
              type="date"
              max={farmToday()}
              value={testedOn}
              onChange={(e) => setTestedOn(e.target.value)}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
            />
          </div>

          {/* Only asked when it could lead anywhere. On an open or uncertain result there is
              nothing to project, and asking would imply otherwise. */}
          {result === 'pregnant' && (
            <div className="mb-4 flex flex-col">
              <label htmlFor="matingDate" className="mb-1 text-label uppercase text-soil-700">
                {t('pregnancy.matingDate')}
              </label>
              <input
                id="matingDate"
                name="matingDate"
                type="date"
                max={farmToday()}
                value={effectiveMatingDate}
                onChange={(e) => setMatingDate(e.target.value)}
                className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
              />
              <p className="mt-1 text-body text-soil-700">
                {lastMating === undefined
                  ? t('pregnancy.matingDateHint')
                  : t('pregnancy.matingDateFromRecord')}
              </p>
            </div>
          )}

          {/* The projection, or an honest account of why there is none. Three distinct cases, and
              the last two are deliberately not merged: "we cannot project for this species" and
              "you have not told us when she was served" have different answers. */}
          {result === 'pregnant' && (
            <p
              role="status"
              className="mb-6 border-l-4 border-dam-700 bg-sand-100 p-3 text-body text-soil-900"
            >
              {dueDate !== null ? (
                <>
                  {t('pregnancy.dueAbout')}{' '}
                  <span className="font-data tabular-nums">{dueDate}</span>{' '}
                  {t('pregnancy.dueApprox')}
                </>
              ) : gestation.status === 'notSynced' && dam !== undefined ? (
                // Cold cache: the figure exists, it just has not reached this phone. Do NOT claim
                // this species has no carrying period — that would be false for cattle on first run.
                `${t('pregnancy.figureSyncing')} ${speciesLabel(t, dam.species)}. ${t('pregnancy.figureSyncingWhy')}`
              ) : gestation.status === 'noSuchFigure' && dam !== undefined ? (
                `${t('pregnancy.noFigure')} ${speciesLabel(t, dam.species)}. ${t('pregnancy.noFigureWhy')}`
              ) : (
                t('pregnancy.noServiceDate')
              )}
            </p>
          )}

          <button
            type="submit"
            disabled={blocked}
            className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
          >
            {t('pregnancy.save')}
          </button>
        </form>
      )}

      <Link to="/animals" className="mt-6 inline-block text-body text-dam-700">
        {t('pregnancy.back')}
      </Link>
    </section>
  );
}
