/**
 * Record a mating / service (FR-120) — filed against the DAM, because "which cows were served, and
 * by what" is the question asked in September and it is her timeline that answers it.
 *
 * ⭐ THE SERVICE IS A WINDOW AS OFTEN AS IT IS A DAY, and this screen asks which. An AI technician
 * knows the date to the hour; an extensive herd running a bull with the cows for six weeks knows
 * the six weeks and nothing finer. Offering only a date field would make the farmer pick a day the
 * service did not happen on — fabricating a precision they never had, in a record a calving
 * projection is later read from. So "a bull ran with them" is a first-class answer, it records
 * bull-in and bull-out, and it is the DEFAULT for natural service.
 *
 * `bullOutAt` is optional inside that: "the bull is still with them" is an ordinary state in
 * October and there is nothing dishonest about a window that has not closed yet.
 *
 * The sire is a bull on this farm OR an external code (a neighbour's bull, an AI straw). Both are
 * optional — a farmer who genuinely does not know which of three bulls served her should be able
 * to say so rather than guess, and a guessed sire is worse than a blank one because a pedigree is
 * read as fact afterwards.
 *
 * Offline-first: `save` commits locally and instantly with no network in the path (NFR-007). The
 * outbox sends it after the animals it names.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { uuidv7 } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import { useAuth } from '../auth/AuthProvider';
import { farmToday } from '../farmTime';
import { useEffectiveAnimals } from './herd';
import { useAnimalLabels } from './LocalIdentifiers';
import { useRecordBreeding, type MatingMethod } from './LocalBreeding';
import { speciesLabel } from './AnimalsScreen';

const METHODS: readonly MatingMethod[] = ['natural', 'ai'];

/** How the service date is known: to the day, or as a period the bull was in. */
type Timing = 'day' | 'window';

/** The value the external-sire option carries in the picker. Not a uuid, so it cannot collide. */
const EXTERNAL_SIRE = 'external';

/**
 * The instant for a day-grained capture. Today keeps the real clock; a back-dated day fabricates
 * midday, which is the repo's idiom — and the reason the WINDOW is on the payload rather than
 * being squeezed into this one field.
 */
function instantForDay(day: string): string {
  return day === farmToday() ? new Date().toISOString() : `${day}T12:00:00.000Z`;
}

export function RecordMatingScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const recordBreeding = useRecordBreeding();
  const labels = useAnimalLabels();
  const herd = useEffectiveAnimals();

  // Only live females can be served, and only live males can serve. Offering the whole herd would
  // make the picker the longest part of the job.
  const dams = herd.filter((a) => a.status === 'alive' && a.sex === 'female');
  const sires = herd.filter((a) => a.status === 'alive' && a.sex === 'male');

  const [damId, setDamId] = useState('');
  const [method, setMethod] = useState<MatingMethod>('natural');
  const [sireChoice, setSireChoice] = useState('');
  const [sireCode, setSireCode] = useState('');
  const [timing, setTiming] = useState<Timing>('window');
  const [servedOn, setServedOn] = useState(() => farmToday());
  const [bullInAt, setBullInAt] = useState(() => farmToday());
  const [bullOutAt, setBullOutAt] = useState('');
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dam = useMemo(() => dams.find((a) => a.id === damId), [dams, damId]);

  if (!activeFarm) return null;

  const external = sireChoice === EXTERNAL_SIRE;
  // A window that runs backwards is a typo, and it is the one mistake here worth blocking: the
  // record would say the bull came out before he went in.
  const windowIsBackwards = timing === 'window' && bullOutAt !== '' && bullOutAt < bullInAt;
  const blocked =
    dam === undefined ||
    (timing === 'day' ? servedOn === '' : bullInAt === '') ||
    windowIsBackwards ||
    (external && sireCode.trim() === '');

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (blocked || !dam || saving) return;
    setSaving(true);

    // The event sits at the EARLIEST day the service could have happened. For a window that is
    // bull-in: an append-only event placed at the start of the exposure never claims something
    // happened before it could have, and no precision is lost either way because both bounds are
    // on the payload — which is the whole reason they are there.
    const anchorDay = timing === 'day' ? servedOn : bullInAt;

    // Not "saved" until the local write is durable (P1.1).
    await recordBreeding({
      id: uuidv7(),
      kind: 'mating',
      farmId: activeFarm.id,
      animalId: dam.id,
      occurredAt: instantForDay(anchorDay),
      method,
      ...(external || sireChoice === '' ? {} : { sireId: sireChoice }),
      ...(external && sireCode.trim() !== '' ? { sireCode: sireCode.trim() } : {}),
      ...(timing === 'window' ? { bullInAt } : {}),
      ...(timing === 'window' && bullOutAt !== '' ? { bullOutAt } : {}),
    });

    setJustSaved(labels.get(dam.id) ?? speciesLabel(t, dam.species));
    setDamId('');
    setSireChoice('');
    setSireCode('');
    setSaving(false);
  };

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('mating.title')}</h1>

      {justSaved !== null && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {justSaved} {t('mating.saved')}
        </p>
      )}

      {dams.length === 0 ? (
        <p className="text-body text-soil-700">{t('mating.noDams')}</p>
      ) : (
        <form onSubmit={save}>
          <div className="mb-4 flex flex-col">
            <label htmlFor="dam" className="mb-1 text-label uppercase text-soil-700">
              {t('mating.dam')}
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
              <option value="">{t('mating.chooseDam')}</option>
              {dams.map((a) => (
                <option key={a.id} value={a.id}>
                  {labels.get(a.id) ?? speciesLabel(t, a.species)}
                  {a.breed ? ` · ${a.breed}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Two large buttons rather than a select: there are two answers and the choice below
              depends on this one, so it must be readable at arm's length. */}
          <fieldset className="mb-4 border-0 p-0">
            <legend className="mb-1 text-label uppercase text-soil-700">
              {t('mating.method')}
            </legend>
            <div className="flex gap-2">
              {METHODS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={method === option}
                  onClick={() => {
                    setMethod(option);
                    // AI is a dated procedure and a running bull is not. Following the choice saves
                    // the technician a tap and never traps them — the timing buttons stay live.
                    setTiming(option === 'ai' ? 'day' : 'window');
                  }}
                  className={`min-h-touch-min flex-1 rounded border px-2 font-ui text-body ${
                    method === option
                      ? 'border-soil-900 bg-sand-100 text-soil-900'
                      : 'border-soil-200 bg-sand-50 text-soil-900'
                  }`}
                >
                  {t(option === 'natural' ? 'mating.method.natural' : 'mating.method.ai')}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="mb-4 flex flex-col">
            <label htmlFor="sire" className="mb-1 text-label uppercase text-soil-700">
              {t('mating.sire')}
            </label>
            <select
              id="sire"
              name="sire"
              value={sireChoice}
              onChange={(e) => setSireChoice(e.target.value)}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
            >
              {/* "Not known" is first and is the default, because a guessed sire is worse than a
                  blank one — a pedigree is read as fact by everyone who comes after. */}
              <option value="">{t('mating.sireUnknown')}</option>
              {sires.map((a) => (
                <option key={a.id} value={a.id}>
                  {labels.get(a.id) ?? speciesLabel(t, a.species)}
                  {a.breed ? ` · ${a.breed}` : ''}
                </option>
              ))}
              <option value={EXTERNAL_SIRE}>{t('mating.sireExternal')}</option>
            </select>
          </div>

          {external && (
            <div className="mb-4 flex flex-col">
              <label htmlFor="sireCode" className="mb-1 text-label uppercase text-soil-700">
                {t('mating.sireCode')}
              </label>
              <input
                id="sireCode"
                name="sireCode"
                type="text"
                autoComplete="off"
                value={sireCode}
                onChange={(e) => setSireCode(e.target.value)}
                className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
              />
              <p className="mt-1 text-body text-soil-700">{t('mating.sireCodeHint')}</p>
            </div>
          )}

          <fieldset className="mb-4 border-0 p-0">
            <legend className="mb-1 text-label uppercase text-soil-700">{t('mating.when')}</legend>
            <div className="mb-2 flex gap-2">
              <button
                type="button"
                aria-pressed={timing === 'window'}
                onClick={() => setTiming('window')}
                className={`min-h-touch-min flex-1 rounded border px-2 font-ui text-body ${
                  timing === 'window'
                    ? 'border-soil-900 bg-sand-100 text-soil-900'
                    : 'border-soil-200 bg-sand-50 text-soil-900'
                }`}
              >
                {t('mating.timing.window')}
              </button>
              <button
                type="button"
                aria-pressed={timing === 'day'}
                onClick={() => setTiming('day')}
                className={`min-h-touch-min flex-1 rounded border px-2 font-ui text-body ${
                  timing === 'day'
                    ? 'border-soil-900 bg-sand-100 text-soil-900'
                    : 'border-soil-200 bg-sand-50 text-soil-900'
                }`}
              >
                {t('mating.timing.day')}
              </button>
            </div>

            {timing === 'day' ? (
              <div className="flex flex-col">
                <label htmlFor="servedOn" className="mb-1 text-label uppercase text-soil-700">
                  {t('mating.servedOn')}
                </label>
                <input
                  id="servedOn"
                  name="servedOn"
                  type="date"
                  max={farmToday()}
                  value={servedOn}
                  onChange={(e) => setServedOn(e.target.value)}
                  className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
                />
              </div>
            ) : (
              <div className="flex gap-2">
                <div className="flex flex-1 flex-col">
                  <label htmlFor="bullInAt" className="mb-1 text-label uppercase text-soil-700">
                    {t('mating.bullIn')}
                  </label>
                  <input
                    id="bullInAt"
                    name="bullInAt"
                    type="date"
                    max={farmToday()}
                    value={bullInAt}
                    onChange={(e) => setBullInAt(e.target.value)}
                    className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
                  />
                </div>
                <div className="flex flex-1 flex-col">
                  <label htmlFor="bullOutAt" className="mb-1 text-label uppercase text-soil-700">
                    {t('mating.bullOut')}
                  </label>
                  <input
                    id="bullOutAt"
                    name="bullOutAt"
                    type="date"
                    max={farmToday()}
                    value={bullOutAt}
                    onChange={(e) => setBullOutAt(e.target.value)}
                    className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
                  />
                  <p className="mt-1 text-body text-soil-700">{t('mating.bullOutHint')}</p>
                </div>
              </div>
            )}
          </fieldset>

          {/* Warning, not an error panel: a tinted block with a left rule and the word, never
              colour alone (NFR-411). Ochre is the action colour and does not appear here. */}
          {windowIsBackwards && (
            <p
              role="alert"
              className="mb-4 border-l-4 border-klei-600 bg-sand-100 p-3 text-body text-soil-900"
            >
              {t('mating.windowBackwards')}
            </p>
          )}

          <button
            type="submit"
            disabled={blocked || saving}
            className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
          >
            {t('mating.save')}
          </button>
        </form>
      )}

      <Link to="/animals" className="mt-6 inline-block text-body text-dam-700">
        {t('mating.back')}
      </Link>
    </section>
  );
}
