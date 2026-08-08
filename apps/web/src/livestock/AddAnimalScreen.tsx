/**
 * Record an animal (FR-101), the crush-side capture path. Everything here is built for the
 * reference user: a few large controls, one ochre primary action, and a commit that lands
 * LOCALLY and instantly — there is no network anywhere in `save`, so it works with the phone
 * in aeroplane mode (.claude/rules/frontend.md, NFR-007).
 *
 * ⭐ The animal is filed under a HERD (FR-113), and that is the only question asked when the farm
 * runs more than one: the species follows from the herd, so "Dorper flock" answers both at once and
 * a sheep can no longer be filed in the cattle enterprise. Picking a herd rather than a species also
 * tells two cattle herds apart ("Bonsmara cows" vs "Feedlot"), which a species never could — and it
 * is what makes every later event on this animal file itself correctly, since the server stamps the
 * event with the herd the animal is in.
 *
 * A farm with ONE herd is asked nothing: a question with a single answer is not a decision, it is an
 * obstacle in a crush. A device whose cached session predates herd scoping falls back to choosing a
 * species — the animal is still captured, unfiled, and the next sign-in fills the herd list in.
 *
 * After a save the form stays put with the herd and sex kept, because a farmer in a race records
 * twenty of the same in a row — "Save" then "Record another" is the rhythm, not a round-trip back
 * to a list each time.
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
import { useRecordPurchase } from './LocalLifecycle';
import { farmToday } from '../farmTime';
import { speciesLabel, sexLabel } from './AnimalsScreen';
import type { TranslationKey } from '../i18n/dictionaries';

type Herd = schemas.SessionEnterprise;

/** Rands as typed → integer cents (Money). Rounded at the I/O boundary, never carried as a float. */
function toCents(rands: string): number {
  return Math.round(Number(rands) * 100);
}

function priceIsValid(rands: string): boolean {
  const n = Number(rands);
  return rands.trim() !== '' && Number.isFinite(n) && n >= 0;
}

/** The farm's herds that keep animals — a crop enterprise is not somewhere to file an animal. */
function livestockHerds(enterprises: readonly Herd[]): Herd[] {
  return enterprises.filter((e) => enterpriseSpecies(e.type) !== null);
}

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
  const recordPurchase = useRecordPurchase();

  const herds = useMemo(() => livestockHerds(activeFarm?.enterprises ?? []), [activeFarm]);
  const speciesOptions = useMemo(
    () => farmSpecies((activeFarm?.enterpriseTypes as EnterpriseType[]) ?? []),
    [activeFarm],
  );

  const [herdId, setHerdId] = useState('');
  const [species, setSpecies] = useState<Species | ''>('');
  const [sex, setSex] = useState<AnimalSex>('female');
  const [breed, setBreed] = useState('');
  const [dob, setDob] = useState('');
  const [dobEstimated, setDobEstimated] = useState(false);
  // Where it came from (FR-106). "Bought" is not a different KIND of animal — it is the same herd
  // row plus a purchase event, which is why this lives here rather than on a screen of its own.
  // FR-107. Per-species, and the screen asks only what THIS species has: a wool class field on a
  // cattle capture is a question nobody can answer, and one more thing to skip in a crush.
  const [hornStatus, setHornStatus] = useState<schemas.HornStatus | ''>('');
  const [woolClass, setWoolClass] = useState('');
  const [bought, setBought] = useState(false);
  const [seller, setSeller] = useState('');
  const [acquiredOn, setAcquiredOn] = useState(farmToday);
  const [priceRands, setPriceRands] = useState('');
  const [justSaved, setJustSaved] = useState(false);

  if (!activeFarm) return null;

  // The herd this animal belongs to: whichever the farmer picked, else the farm's only one.
  const selectedHerd = herds.find((h) => h.id === herdId) ?? herds[0];
  // Species follows the herd when there is one; otherwise it is asked for directly (an older
  // cached session that predates herd scoping, or a farm whose herds have not synced yet).
  const selectedSpecies: Species | '' = selectedHerd
    ? (enterpriseSpecies(selectedHerd.type) ?? '')
    : species || speciesOptions[0] || '';

  const today = farmToday();
  const dobIsValid = dob === '' || dob <= today;
  const purchaseIsValid =
    !bought ||
    (seller.trim() !== '' &&
      priceIsValid(priceRands) &&
      acquiredOn !== '' &&
      acquiredOn <= today &&
      (dob === '' || dob <= acquiredOn));

  // What this species carries, straight from the schema — so a species added to the vocabulary
  // cannot quietly go unrepresented here, and the screen and the server cannot disagree.
  const attributeKeys = selectedSpecies ? schemas.attributeKeysFor(selectedSpecies) : [];
  const asksHorns = attributeKeys.includes('hornStatus');
  const asksWool = attributeKeys.includes('woolClass');
  // Validated on the device before the save, not only on arrival: a capture refused days later,
  // by which time nobody remembers which animal it was, is a rule that reached nobody.
  const attributes = {
    ...(asksHorns && hornStatus !== '' ? { hornStatus } : {}),
    ...(asksWool && woolClass.trim() !== '' ? { woolClass: woolClass.trim().toUpperCase() } : {}),
  };
  const attributesAreValid =
    selectedSpecies === '' ||
    schemas.attributeSchemaFor(selectedSpecies).safeParse(attributes).success;

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedSpecies || !dobIsValid || !purchaseIsValid || !attributesAreValid) return;

    const occurredAt =
      bought && acquiredOn !== today ? new Date(`${acquiredOn}T12:00:00.000Z`) : new Date();
    const animal = schemas.newAnimalSchema.parse({
      id: uuidv7(),
      farmId: activeFarm.id,
      // FR-113: filed under its herd at capture, so every later event on this animal inherits it.
      enterpriseId: selectedHerd?.id ?? null,
      species: selectedSpecies,
      sex,
      breed: breed.trim() || null,
      dob: dob || null,
      dobEstimated: dob !== '' && dobEstimated,
      attributes,
      // A bought animal carries where it came from on the herd row too, because "who did I buy
      // this from" is asked of the ANIMAL, and an evidence pack reads `source`/`acquired_at`
      // rather than trawling the event log (FR-603).
      ...(bought ? { source: seller.trim(), acquiredAt: acquiredOn } : {}),
    });
    recordAnimal(animal);

    // The money side (FR-106). A purchase changes no status — the animal arrived alive — so it is
    // an event about the animal, not a state it is in.
    if (bought) {
      recordPurchase({
        id: uuidv7(),
        farmId: activeFarm.id,
        animalId: animal.id,
        occurredAt,
        currentStatus: 'alive',
        counterparty: seller.trim(),
        priceCents: toCents(priceRands),
      });
    }

    // Kept: herd/species, sex, and the seller — a farmer buying a truckload buys them from one
    // person. Cleared: the per-animal breed and price.
    setBreed('');
    setDob('');
    setDobEstimated(false);
    setPriceRands('');
    // Cleared with the breed, for the same reason: horn status and wool class are per ANIMAL, and
    // carrying the last one forward would quietly stamp it on the next fifty head.
    setHornStatus('');
    setWoolClass('');
    setJustSaved(true);
  };

  // Any edit after a save dismisses the confirmation — it belongs to the last thing saved.
  const pickHerd = (value: string) => {
    setJustSaved(false);
    setHerdId(value);
  };
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
        {/* FR-113. One herd = no question asked; the species is not asked either, because the herd
            already answers it. Only a farm running several is asked, and then only once. */}
        {herds.length > 1 && (
          <div className="mb-4 flex flex-col">
            <label htmlFor="herd" className="mb-1 text-label uppercase text-soil-700">
              {t('animals.new.herd')}
            </label>
            <select
              id="herd"
              name="herd"
              value={selectedHerd?.id ?? ''}
              onChange={(e) => pickHerd(e.target.value)}
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

        {/* One herd: stated, not asked. The farmer still needs to see where the animal is filed —
            "no question" must not become "no idea". */}
        {herds.length === 1 && (
          <p className="mb-4 text-body text-soil-700">
            <span className="text-label uppercase">{t('animals.new.herd')}</span>{' '}
            {selectedHerd!.name}
          </p>
        )}

        {herds.length === 0 && (
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
        )}

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

        <div className="mb-4 flex flex-col">
          <label htmlFor="dob" className="mb-1 text-label uppercase text-soil-700">
            {t('animals.new.dob')}
          </label>
          <input
            id="dob"
            name="dob"
            type="date"
            max={today}
            value={dob}
            onChange={(e) => {
              setJustSaved(false);
              setDob(e.target.value);
              if (e.target.value === '') setDobEstimated(false);
            }}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
          />
        </div>

        {dob !== '' && (
          <label className="mb-6 flex min-h-touch-min items-center gap-3 text-body text-soil-900">
            <input
              type="checkbox"
              checked={dobEstimated}
              onChange={(e) => {
                setJustSaved(false);
                setDobEstimated(e.target.checked);
              }}
              className="h-6 w-6 accent-ochre-500"
            />
            {t('animals.new.dobEstimated')}
          </label>
        )}

        {/* FR-107, rendered from the species' own schema. Both optional — a farmer tagging fifty
            head is not stopping to record horn status on each one, and demanding it would mean the
            animal does not get recorded at all. */}
        {asksHorns && (
          <div className="mb-4 flex flex-col">
            <label htmlFor="hornStatus" className="mb-1 text-label uppercase text-soil-700">
              {t('animals.new.hornStatus')}
            </label>
            <select
              id="hornStatus"
              name="hornStatus"
              value={hornStatus}
              onChange={(e) => {
                setJustSaved(false);
                setHornStatus(e.target.value as schemas.HornStatus | '');
              }}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
            >
              <option value="">{t('animals.new.notSaid')}</option>
              {schemas.HORN_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`animals.horn.${status}` as TranslationKey)}
                </option>
              ))}
            </select>
          </div>
        )}

        {asksWool && (
          <div className="mb-4 flex flex-col">
            <label htmlFor="woolClass" className="mb-1 text-label uppercase text-soil-700">
              {t('animals.new.woolClass')}
            </label>
            <input
              id="woolClass"
              name="woolClass"
              type="text"
              autoComplete="off"
              value={woolClass}
              onChange={(e) => {
                setJustSaved(false);
                setWoolClass(e.target.value);
              }}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body uppercase tabular-nums text-soil-900"
            />
            {/* A free field rather than a picker, and the reason is on the schema: the SA classing
                code list is Cape Wools' and is not in this app, so a fabricated picker would be
                wrong in a way a wool farmer spots immediately. */}
            {woolClass.trim() !== '' && !attributesAreValid && (
              <p className="mt-1 border-l-4 border-klei-700 bg-klei-100 p-2 text-body text-soil-900">
                {t('animals.new.woolClassHint')}
              </p>
            )}
          </div>
        )}

        {/* FR-106. Off by default: most animals on a farm were born there, and asking every
            capture where it came from would tax the common case to serve the rarer one. */}
        <div className="mb-4">
          <button
            type="button"
            aria-pressed={bought}
            onClick={() => {
              setJustSaved(false);
              setBought(!bought);
            }}
            className={`min-h-touch-min w-full rounded border px-4 font-ui text-body ${
              bought
                ? 'border-soil-900 bg-sand-100 text-soil-900'
                : 'border-soil-200 bg-sand-50 text-soil-900'
            }`}
          >
            {t('animals.new.bought')}
          </button>
        </div>

        {bought && (
          <>
            <div className="mb-4 flex flex-col">
              <label htmlFor="seller" className="mb-1 text-label uppercase text-soil-700">
                {t('animals.new.seller')}
              </label>
              <input
                id="seller"
                name="seller"
                type="text"
                autoComplete="off"
                value={seller}
                onChange={(e) => {
                  setJustSaved(false);
                  setSeller(e.target.value);
                }}
                className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
              />
            </div>
            <div className="mb-6 flex flex-col">
              <label htmlFor="acquiredOn" className="mb-1 text-label uppercase text-soil-700">
                {t('animals.new.acquiredOn')}
              </label>
              <input
                id="acquiredOn"
                name="acquiredOn"
                type="date"
                max={today}
                value={acquiredOn}
                onChange={(e) => {
                  setJustSaved(false);
                  setAcquiredOn(e.target.value);
                }}
                className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
              />
            </div>
            <div className="mb-6 flex flex-col">
              <label htmlFor="paid" className="mb-1 text-label uppercase text-soil-700">
                {t('animals.new.paid')}
              </label>
              <input
                id="paid"
                name="paid"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={priceRands}
                onChange={(e) => {
                  setJustSaved(false);
                  setPriceRands(e.target.value);
                }}
                className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
              />
            </div>
          </>
        )}

        <button
          type="submit"
          disabled={!selectedSpecies || !dobIsValid || !purchaseIsValid || !attributesAreValid}
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
