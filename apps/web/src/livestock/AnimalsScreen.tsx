/**
 * The Animals screen (FR-101, FR-705). Everything here is read from the LOCAL herd — no
 * network, no spinner — so it renders in full in a signal dead zone. The live head count is
 * the same number the home tile carries; the list is the farm's animals in the order they
 * were captured.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { enterpriseSpecies, type Species, type AnimalSex, type AnimalStatus } from '@werf/core';
import { ANIMAL_CLASSES } from '@werf/domain';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { useAuth } from '../auth/AuthProvider';
import { useEffectiveAnimals, useEffectiveMobs, useHerdClasses, useHerdSummary } from './herd';
import { useAnimalLabels } from './LocalIdentifiers';
import { useEffectiveLandUnits } from '../land/LocalLand';

export function speciesLabel(t: (key: TranslationKey) => string, species: Species): string {
  return t(`species.${species}` as TranslationKey);
}

export function sexLabel(t: (key: TranslationKey) => string, sex: AnimalSex): string {
  return t(`sex.${sex}` as TranslationKey);
}

export function statusLabel(t: (key: TranslationKey) => string, status: AnimalStatus): string {
  return t(`status.${status}` as TranslationKey);
}

export function AnimalsScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();

  // FR-113: on a farm with several herds, the screen can be narrowed to one. "All herds" is the
  // default, because the whole-farm number is the one the home tile shows and the two must agree.
  const herds = useMemo(
    () => (activeFarm?.enterprises ?? []).filter((e) => enterpriseSpecies(e.type) !== null),
    [activeFarm],
  );
  const [herdId, setHerdId] = useState('');
  const filter = herdId === '' ? undefined : herdId;

  const animals = useEffectiveAnimals(filter);
  const mobs = useEffectiveMobs(filter);
  const landUnits = useEffectiveLandUnits();
  const labels = useAnimalLabels();
  const summary = useHerdSummary(filter);
  const classes = useHerdClasses(filter);
  const hasLive = summary.animalsLive > 0;

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="font-ui text-h1 text-soil-900">{t('animals.title')}</h1>
        <p className="font-data text-data-lg tabular-nums text-soil-900">
          {summary.liveTotal} <span className="text-body text-soil-700">{t('animals.head')}</span>
        </p>
      </div>

      {herds.length > 1 && (
        <div className="mb-4 flex flex-col">
          <label htmlFor="herd-filter" className="mb-1 text-label uppercase text-soil-700">
            {t('animals.herdFilter')}
          </label>
          <select
            id="herd-filter"
            name="herd-filter"
            value={herdId}
            onChange={(e) => setHerdId(e.target.value)}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
          >
            <option value="">{t('animals.allHerds')}</option>
            {herds.map((herd) => (
              <option key={herd.id} value={herd.id}>
                {herd.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <Link
        to="/animals/new"
        className="mb-3 flex min-h-touch-primary items-center justify-center rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action no-underline"
      >
        {t('animals.add')}
      </Link>

      {/* Recording a GROUP is offered beside recording one animal, not buried: for a smallholder
          running 300 sheep as a flock it is the only capture they will ever need (FR-102). It is a
          secondary form, because the ochre action budget is one per screen. */}
      <Link
        to="/animals/groups/new"
        className="mb-3 flex min-h-touch-min items-center justify-center rounded border border-soil-200 px-4 font-ui text-body text-soil-900 no-underline"
      >
        {t('animals.addGroup')}
      </Link>

      <Link
        to="/animals/brands"
        className="mb-3 flex min-h-touch-min items-center justify-center rounded border border-soil-200 px-4 font-ui text-body text-soil-900 no-underline"
      >
        {t('animals.branding')}
      </Link>

      {/* ⭐ Sits OUTSIDE the `hasLive` block below, like the stock-theft action and for the same
          reason: a farm running everything as flocks has no individual animal rows at all, and it
          is exactly that farm whose numbers can only move through here (FR-102). Offered only when
          there is a counted group to change, so it is never a button that leads to an empty list. */}
      {mobs.some((m) => m.headCount !== null) && (
        <Link
          to="/animals/groups/count"
          className="mb-3 flex min-h-touch-min items-center justify-center rounded border border-soil-200 px-4 font-ui text-body text-soil-900 no-underline"
        >
          {t('animals.countGroup')}
        </Link>
      )}

      {/* FR-151: a group can now be walked to another camp, the capture this metric was blocked on —
          offered only when there is somewhere for it to go, same gating as the count-group link
          above. */}
      {mobs.length > 0 && landUnits.length > 0 && (
        <Link
          to="/animals/groups/move"
          className="mb-3 flex min-h-touch-min items-center justify-center rounded border border-soil-200 px-4 font-ui text-body text-soil-900 no-underline"
        >
          {t('animals.moveGroup')}
        </Link>
      )}

      {/* FR-705. The breakdown a farmer actually thinks in: nobody has "42 female cattle", they
          have 18 cows, 9 heifers and 15 weaners. Zero classes are not shown — an empty row is
          noise — but 'unknown' IS, because animals with no recorded birth date are a real group
          and hiding them would make this disagree with the head count above. */}
      {Object.entries(classes).map(([species, counts]) => {
        const shown = ANIMAL_CLASSES.filter((c) => counts[c] > 0);
        if (shown.length === 0) return null;
        return (
          <div key={species} className="mb-4">
            <p className="mb-1 text-label uppercase text-soil-700">
              {speciesLabel(t, species as Species)}
            </p>
            <ul
              aria-label={`${speciesLabel(t, species as Species)} ${t('animals.classes')}`}
              className="flex list-none flex-wrap gap-3 p-0"
            >
              {shown.map((c) => (
                <li key={c} className="text-body text-soil-900">
                  <span className="font-data tabular-nums">{counts[c]}</span>{' '}
                  <span className="text-soil-700">{t(`class.${c}` as TranslationKey)}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {mobs.length > 0 && (
        <>
          <h2 className="mb-2 font-ui text-h2 text-soil-900">{t('animals.groups')}</h2>
          <ul aria-label={t('animals.groups')} className="mb-6 flex list-none flex-col gap-2 p-0">
            {mobs.map((mob) => (
              <li
                key={mob.id}
                className="flex items-center justify-between rounded border border-soil-200 bg-sand-100 p-3"
              >
                <span className="text-body text-soil-900">{mob.name}</span>
                <span className="text-body text-soil-700">
                  <span className="font-data tabular-nums text-soil-900">{mob.headCount ?? 0}</span>{' '}
                  {t('mob.headUnit')}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {hasLive && (
        <div className="mb-6 flex flex-col gap-2">
          <Link
            to="/weigh"
            className="flex min-h-touch-min items-center justify-center rounded border border-soil-200 px-4 font-ui text-body text-soil-900 no-underline"
          >
            {t('animals.weigh')}
          </Link>
          <Link
            to="/animals/tag"
            className="flex min-h-touch-min items-center justify-center rounded border border-soil-200 px-4 font-ui text-body text-soil-900 no-underline"
          >
            {t('animals.tag')}
          </Link>
          <Link
            to="/animals/health"
            className="flex min-h-touch-min items-center justify-center rounded border border-soil-200 px-4 font-ui text-body text-soil-900 no-underline"
          >
            {t('animals.health')}
          </Link>
          {/* Mating sits before pregnancy, and pregnancy before birth: the three are one sequence
              on the same animal, and reading them in the order they happen is the only ordering a
              farmer never has to think about. */}
          <Link
            to="/animals/mating"
            className="flex min-h-touch-min items-center justify-center rounded border border-soil-200 px-4 font-ui text-body text-soil-900 no-underline"
          >
            {t('animals.mating')}
          </Link>
          <Link
            to="/animals/pregnancy"
            className="flex min-h-touch-min items-center justify-center rounded border border-soil-200 px-4 font-ui text-body text-soil-900 no-underline"
          >
            {t('animals.pregnancy')}
          </Link>
          <Link
            to="/animals/birth"
            className="flex min-h-touch-min items-center justify-center rounded border border-soil-200 px-4 font-ui text-body text-soil-900 no-underline"
          >
            {t('animals.birth')}
          </Link>
          <Link
            to="/animals/wean"
            className="flex min-h-touch-min items-center justify-center rounded border border-soil-200 px-4 font-ui text-body text-soil-900 no-underline"
          >
            {t('animals.wean')}
          </Link>
          <Link
            to="/animals/move"
            className="flex min-h-touch-min items-center justify-center rounded border border-soil-200 px-4 font-ui text-body text-soil-900 no-underline"
          >
            {t('animals.move')}
          </Link>
          <Link
            to="/animals/loss"
            className="flex min-h-touch-min items-center justify-center rounded border border-soil-200 px-4 font-ui text-body text-soil-900 no-underline"
          >
            {t('animals.loss')}
          </Link>
          <Link
            to="/animals/photo"
            className="flex min-h-touch-min items-center justify-center rounded border border-soil-200 px-4 font-ui text-body text-soil-900 no-underline"
          >
            {t('animals.photo')}
          </Link>
        </div>
      )}

      {/* ⭐ OUTSIDE the `hasLive` block, unlike every action above it. Stock theft has to be
          reachable on a farm running its stock as groups with no individual animal rows at all —
          which is a great many of the farms most exposed to it. Gating this on having tagged
          animals would put the one screen that produces a police document behind a data-entry
          exercise nobody has done at the moment they need it (FR-603). */}
      <div className="mb-6 flex flex-col gap-2">
        <Link
          to="/animals/theft"
          className="flex min-h-touch-min items-center justify-center rounded border border-soil-200 px-4 font-ui text-body text-soil-900 no-underline"
        >
          {t('animals.theft')}
        </Link>
      </div>

      {/* "Nothing recorded yet" has to mean nothing AT ALL — a farm running one flock as a group
          has 300 head and no individual rows, and telling them they have recorded nothing is the
          exact insult FR-102 exists to avoid. */}
      {animals.length === 0 ? (
        mobs.length === 0 ? (
          <p className="text-body text-soil-700">{t('animals.empty')}</p>
        ) : null
      ) : (
        <ul aria-label={t('animals.title')} className="flex list-none flex-col gap-2 p-0">
          {animals.map((animal) => (
            <li
              key={animal.id}
              className="flex items-center justify-between rounded border border-soil-200 bg-sand-100 p-3"
            >
              {/* An animal is called by its NUMBER, not its species — a farmer says "4021", not
                  "that cow". An untagged animal says so rather than showing a blank where the
                  number should be: "which ones still need tagging" is a real question. */}
              <span className="text-body text-soil-900">
                {labels.has(animal.id) ? (
                  <span className="font-data tabular-nums">{labels.get(animal.id)}</span>
                ) : (
                  <span className="text-soil-700">{t('animals.untagged')}</span>
                )}
                {' · '}
                <span>{speciesLabel(t, animal.species)}</span>
              </span>
              <span className="text-body text-soil-700">
                {sexLabel(t, animal.sex)}
                {animal.breed ? ` · ${animal.breed}` : ''}
                {animal.status !== 'alive' ? ` · ${statusLabel(t, animal.status)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Link to="/" className="mt-6 inline-block text-body text-dam-700">
        {t('home.back')}
      </Link>
    </section>
  );
}
