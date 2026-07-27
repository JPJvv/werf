/**
 * Record a group (FR-102) — a flock or mob managed by HEAD COUNT, with no individual animals behind
 * it. This is the model most South African smallholders actually use, and the reason it exists as a
 * first-class record rather than a shortcut: a farmer with 300 sheep does not have 300 ear tags, and
 * an app that demands 300 rows before it will tell them anything is an app they stop opening.
 *
 * The count feeds the live total exactly as individual animals do, so the home tile moves the
 * instant this is saved (FR-705/017).
 *
 * Offline-first like every capture: `save` commits locally and instantly with no network in the
 * path. The group may be put in a camp, and only in a camp on this farm — the picker is the local
 * register, so there is nothing else to pick.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { enterpriseSpecies, schemas, uuidv7, type EnterpriseType, type Species } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { vocabularyFor } from '../i18n/terminology';
import { useAuth } from '../auth/AuthProvider';
import { useLandUnits } from '../land/LocalLand';
import { useRecordMob } from './LocalMobs';
import { speciesLabel } from './AnimalsScreen';

type Herd = schemas.SessionEnterprise;

/** A whole number of head, or null when the field is empty or nonsense. */
function headCount(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function AddMobScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const camps = useLandUnits();
  const recordMob = useRecordMob();

  const herds = useMemo<Herd[]>(
    () => (activeFarm?.enterprises ?? []).filter((e) => enterpriseSpecies(e.type) !== null),
    [activeFarm],
  );
  const term = useMemo(
    () => vocabularyFor((activeFarm?.enterpriseTypes as EnterpriseType[]) ?? []).land,
    [activeFarm],
  );

  const [herdId, setHerdId] = useState('');
  const [name, setName] = useState('');
  const [head, setHead] = useState('');
  const [campId, setCampId] = useState('');
  const [justSaved, setJustSaved] = useState<string | null>(null);

  if (!activeFarm) return null;

  // Same rule as recording an animal: the herd answers the species, and a farm with one is asked
  // nothing (a question with a single answer is an obstacle, not a decision).
  const selectedHerd = herds.find((h) => h.id === herdId) ?? herds[0];
  const species: Species | '' = selectedHerd ? (enterpriseSpecies(selectedHerd.type) ?? '') : '';

  const count = headCount(head);
  const blocked = name.trim() === '' || count === null || species === '';

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (blocked) return;

    const mob = schemas.newMobSchema.parse({
      id: uuidv7(),
      farmId: activeFarm.id,
      enterpriseId: selectedHerd?.id ?? null,
      name: name.trim(),
      species,
      headCount: count,
      // Equal at creation and never again: `headCount` is the running total every tally moves,
      // `initialHeadCount` is the fixed point the tally log is folded over. Setting both here is
      // what the server does with the same value, so the two sides fold from the same baseline.
      initialHeadCount: count,
      landUnitId: campId === '' ? null : campId,
    });
    recordMob(mob);

    setJustSaved(mob.name);
    setName('');
    setHead('');
  };

  const edit = (setter: (value: string) => void) => (value: string) => {
    setJustSaved(null);
    setter(value);
  };

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('mob.title')}</h1>

      {justSaved !== null && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {justSaved} {t('mob.saved')}
        </p>
      )}

      {herds.length === 0 ? (
        <p className="text-body text-soil-700">{t('mob.noHerds')}</p>
      ) : (
        <form onSubmit={save}>
          {herds.length > 1 && (
            <div className="mb-4 flex flex-col">
              <label htmlFor="mob-herd" className="mb-1 text-label uppercase text-soil-700">
                {t('animals.new.herd')}
              </label>
              <select
                id="mob-herd"
                name="mob-herd"
                value={selectedHerd?.id ?? ''}
                onChange={(e) => edit(setHerdId)(e.target.value)}
                className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
              >
                {herds.map((herd) => (
                  <option key={herd.id} value={herd.id}>
                    {herd.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {herds.length === 1 && (
            <p className="mb-4 text-body text-soil-700">
              <span className="text-label uppercase">{t('animals.new.herd')}</span>{' '}
              {selectedHerd!.name}
            </p>
          )}

          <div className="mb-4 flex flex-col">
            <label htmlFor="mob-name" className="mb-1 text-label uppercase text-soil-700">
              {t('mob.name')}
            </label>
            <input
              id="mob-name"
              name="mob-name"
              type="text"
              autoComplete="off"
              value={name}
              onChange={(e) => edit(setName)(e.target.value)}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
            />
          </div>

          <div className="mb-4 flex flex-col">
            <label htmlFor="mob-head" className="mb-1 text-label uppercase text-soil-700">
              {t('mob.head')}
            </label>
            <input
              id="mob-head"
              name="mob-head"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={head}
              onChange={(e) => edit(setHead)(e.target.value)}
              className="min-h-touch-primary rounded border border-soil-200 bg-sand-100 px-3 font-data text-data-lg tabular-nums text-soil-900"
            />
          </div>

          {/* Only offered once there is ground to choose. A picker with nothing in it is a dead end. */}
          {camps.length > 0 && (
            <div className="mb-6 flex flex-col">
              <label htmlFor="mob-camp" className="mb-1 text-label uppercase text-soil-700">
                {t(`mob.where.${term}` as TranslationKey)}
              </label>
              <select
                id="mob-camp"
                name="mob-camp"
                value={campId}
                onChange={(e) => edit(setCampId)(e.target.value)}
                className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
              >
                <option value="">{t('mob.nowhere')}</option>
                {camps.map((camp) => (
                  <option key={camp.id} value={camp.id}>
                    {camp.code}
                    {camp.name ? ` · ${camp.name}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="submit"
            disabled={blocked}
            className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
          >
            {species === ''
              ? t('mob.save')
              : `${t('mob.save')} · ${speciesLabel(t, species as Species)}`}
          </button>
        </form>
      )}

      <Link to="/animals" className="mt-6 inline-block text-body text-dam-700">
        {t('mob.back')}
      </Link>
    </section>
  );
}
