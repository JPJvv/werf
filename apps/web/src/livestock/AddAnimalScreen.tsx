/**
 * Record an animal (FR-101), the crush-side capture path. Everything here is built for the
 * reference user: a few large controls, one ochre primary action, and a commit that lands
 * LOCALLY and instantly — there is no network anywhere in `save`, so it works with the phone
 * in aeroplane mode (.claude/rules/frontend.md, NFR-007).
 *
 * The species offered are only the ones this farm runs (derived from its enterprise types),
 * so a cattle farm is never asked to choose "poultry". After a save the form stays put with
 * the species and sex kept, because a farmer in a race records twenty of the same in a row —
 * "Save" then "Record another" is the rhythm, not a round-trip back to a list each time.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ANIMAL_SEXES,
  enterpriseSpecies,
  uuidv7,
  schemas,
  type AnimalSex,
  type EnterpriseType,
  type Species,
} from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import { useAuth } from '../auth/AuthProvider';
import { useRecordAnimal } from './LocalHerd';
import { speciesLabel, sexLabel } from './AnimalsScreen';

/** The distinct species a farm's enterprises keep, in enterprise order (cattle once, not twice). */
function farmSpecies(enterpriseTypes: readonly EnterpriseType[]): Species[] {
  const seen = new Set<Species>();
  const out: Species[] = [];
  for (const type of enterpriseTypes) {
    const species = enterpriseSpecies(type);
    if (species && !seen.has(species)) {
      seen.add(species);
      out.push(species);
    }
  }
  return out;
}

export function AddAnimalScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const recordAnimal = useRecordAnimal();

  const speciesOptions = useMemo(
    () => farmSpecies((activeFarm?.enterpriseTypes as EnterpriseType[]) ?? []),
    [activeFarm],
  );

  const [species, setSpecies] = useState<Species | ''>('');
  const [sex, setSex] = useState<AnimalSex>('female');
  const [breed, setBreed] = useState('');
  const [justSaved, setJustSaved] = useState(false);

  if (!activeFarm) return null;

  // The effective choice: whatever the farmer picked, else the farm's first species.
  const selectedSpecies: Species | '' = species || speciesOptions[0] || '';

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedSpecies) return;

    const animal = schemas.newAnimalSchema.parse({
      id: uuidv7(),
      farmId: activeFarm.id,
      species: selectedSpecies,
      sex,
      breed: breed.trim() || null,
    });
    recordAnimal(animal);

    // Kept: species and sex. Cleared: the per-animal breed. Ready for the next one in the race.
    setBreed('');
    setJustSaved(true);
  };

  // Any edit after a save dismisses the confirmation — it belongs to the last thing saved.
  const pickSpecies = (value: string) => {
    setJustSaved(false);
    setSpecies(value as Species);
  };
  const pickSex = (value: string) => {
    setJustSaved(false);
    setSex(value as AnimalSex);
  };
  const typeBreed = (value: string) => {
    setJustSaved(false);
    setBreed(value);
  };

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('animals.new.title')}</h1>

      {justSaved && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {t('animals.new.saved')}
        </p>
      )}

      <form onSubmit={save}>
        <div className="mb-4 flex flex-col">
          <label htmlFor="species" className="mb-1 text-label uppercase text-soil-700">
            {t('animals.new.species')}
          </label>
          <select
            id="species"
            name="species"
            value={selectedSpecies}
            onChange={(e) => pickSpecies(e.target.value)}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
          >
            {speciesOptions.map((option) => (
              <option key={option} value={option}>
                {speciesLabel(t, option)}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-4 flex flex-col">
          <label htmlFor="sex" className="mb-1 text-label uppercase text-soil-700">
            {t('animals.new.sex')}
          </label>
          <select
            id="sex"
            name="sex"
            value={sex}
            onChange={(e) => pickSex(e.target.value)}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
          >
            {ANIMAL_SEXES.map((option) => (
              <option key={option} value={option}>
                {sexLabel(t, option)}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-6 flex flex-col">
          <label htmlFor="breed" className="mb-1 text-label uppercase text-soil-700">
            {t('animals.new.breed')}
          </label>
          <input
            id="breed"
            name="breed"
            type="text"
            value={breed}
            onChange={(e) => typeBreed(e.target.value)}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
          />
        </div>

        <button
          type="submit"
          disabled={!selectedSpecies}
          className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
        >
          {justSaved ? t('animals.new.another') : t('animals.new.save')}
        </button>
      </form>

      <Link to="/animals" className="mt-6 inline-block text-body text-dam-700">
        {t('animals.new.done')}
      </Link>
    </section>
  );
}
