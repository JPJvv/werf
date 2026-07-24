/**
 * The Animals screen (FR-101, FR-705). Everything here is read from the LOCAL herd — no
 * network, no spinner — so it renders in full in a signal dead zone. The live head count is
 * the same number the home tile carries; the list is the farm's animals in the order they
 * were captured.
 */

import { Link } from 'react-router-dom';
import type { Species, AnimalSex } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { useAnimals, useHerdSummary } from './LocalHerd';

export function speciesLabel(t: (key: TranslationKey) => string, species: Species): string {
  return t(`species.${species}` as TranslationKey);
}

export function sexLabel(t: (key: TranslationKey) => string, sex: AnimalSex): string {
  return t(`sex.${sex}` as TranslationKey);
}

export function AnimalsScreen() {
  const { t } = useTranslation();
  const animals = useAnimals();
  const summary = useHerdSummary();

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="font-ui text-h1 text-soil-900">{t('animals.title')}</h1>
        <p className="font-data text-data-lg tabular-nums text-soil-900">
          {summary.liveTotal} <span className="text-body text-soil-700">{t('animals.head')}</span>
        </p>
      </div>

      <Link
        to="/animals/new"
        className="mb-6 flex min-h-touch-primary items-center justify-center rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action no-underline"
      >
        {t('animals.add')}
      </Link>

      {animals.length === 0 ? (
        <p className="text-body text-soil-700">{t('animals.empty')}</p>
      ) : (
        <ul className="flex list-none flex-col gap-2 p-0">
          {animals.map((animal) => (
            <li
              key={animal.id}
              className="flex items-center justify-between rounded border border-soil-200 bg-sand-100 p-3"
            >
              <span className="text-body text-soil-900">{speciesLabel(t, animal.species)}</span>
              <span className="text-body text-soil-700">
                {sexLabel(t, animal.sex)}
                {animal.breed ? ` · ${animal.breed}` : ''}
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
