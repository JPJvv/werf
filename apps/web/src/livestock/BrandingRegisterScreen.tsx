/** Create and read the farm's registered animal-identification marks (FR-601), fully offline. */

import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { enterpriseSpecies, schemas, uuidv7, type EnterpriseType, type Species } from '@werf/core';
import { useAuth } from '../auth/AuthProvider';
import { farmToday } from '../farmTime';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { speciesLabel } from './AnimalsScreen';
import { useEffectiveBrandingRegisters, useRecordBrandingRegister } from './LocalBranding';

const MARK_TYPES: readonly schemas.MarkType[] = ['tattoo', 'freeze_brand', 'hot_brand'];

function farmSpecies(types: readonly EnterpriseType[]): Species[] {
  const seen = new Set<Species>();
  for (const type of types) {
    const species = enterpriseSpecies(type);
    if (species) seen.add(species);
  }
  return [...seen];
}

export function BrandingRegisterScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const registers = useEffectiveBrandingRegisters();
  const record = useRecordBrandingRegister();
  const speciesOptions = useMemo(
    () => farmSpecies((activeFarm?.enterpriseTypes as EnterpriseType[]) ?? []),
    [activeFarm],
  );

  const [mark, setMark] = useState('');
  const [markType, setMarkType] = useState<schemas.MarkType | ''>('');
  const [chosenSpecies, setChosenSpecies] = useState<Species[]>([]);
  const [bodyPosition, setBodyPosition] = useState('');
  const [certificateReference, setCertificateReference] = useState('');
  const [registeredAt, setRegisteredAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!activeFarm) return null;

  // One species is stated, never asked. A mixed farm chooses exactly what the certificate covers.
  const coveredSpecies = speciesOptions.length === 1 ? speciesOptions : chosenSpecies;
  const valid = mark.trim() !== '' && markType !== '' && coveredSpecies.length > 0 && !saving;

  const toggleSpecies = (species: Species) => {
    setSaved(false);
    setChosenSpecies((current) =>
      current.includes(species)
        ? current.filter((item) => item !== species)
        : [...current, species],
    );
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setSaving(true);
    const register = schemas.newBrandingRegisterSchema.parse({
      id: uuidv7(),
      farmId: activeFarm.id,
      mark: mark.trim().toUpperCase(),
      markType,
      species: coveredSpecies,
      bodyPosition: bodyPosition.trim() || null,
      certificateReference: certificateReference.trim() || null,
      registeredAt: registeredAt || null,
    });
    await record(register);
    setMark('');
    setBodyPosition('');
    setCertificateReference('');
    setRegisteredAt('');
    setSaving(false);
    setSaved(true);
  };

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-2 font-ui text-h1 text-soil-900">{t('branding.title')}</h1>
      <p className="mb-4 text-body text-soil-700">{t('branding.intro')}</p>

      {registers.length === 0 ? (
        <p className="mb-6 text-body text-soil-700">{t('branding.empty')}</p>
      ) : (
        <ul aria-label={t('branding.list')} className="mb-6 flex list-none flex-col gap-2 p-0">
          {registers.map((register) => (
            <li key={register.id} className="rounded border border-soil-200 bg-sand-100 p-3">
              <p className="font-data text-data-lg tabular-nums text-soil-900">{register.mark}</p>
              <p className="text-body text-soil-700">
                {t(`branding.type.${register.markType}` as TranslationKey)} ·{' '}
                {register.species.map((species) => speciesLabel(t, species as Species)).join(', ')}
              </p>
              {register.bodyPosition && (
                <p className="text-body text-soil-700">{register.bodyPosition}</p>
              )}
              {register.certificateReference && (
                <p className="font-data text-body tabular-nums text-soil-700">
                  {t('branding.certificate')}: {register.certificateReference}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-3 font-ui text-h2 text-soil-900">{t('branding.add')}</h2>
      {saved && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {t('branding.saved')}
        </p>
      )}
      <form onSubmit={save}>
        <div className="mb-4 flex flex-col">
          <label htmlFor="registered-mark" className="mb-1 text-label uppercase text-soil-700">
            {t('branding.mark')}
          </label>
          <input
            id="registered-mark"
            value={mark}
            onChange={(event) => {
              setSaved(false);
              setMark(event.target.value.toUpperCase());
            }}
            autoComplete="off"
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body uppercase tabular-nums text-soil-900"
          />
          <p className="mt-1 text-body text-soil-700">{t('branding.markHint')}</p>
        </div>

        <div className="mb-4 flex flex-col">
          <label htmlFor="mark-type" className="mb-1 text-label uppercase text-soil-700">
            {t('branding.type')}
          </label>
          <select
            id="mark-type"
            value={markType}
            onChange={(event) => {
              setSaved(false);
              setMarkType(event.target.value as schemas.MarkType | '');
            }}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
          >
            <option value="">{t('branding.chooseType')}</option>
            {MARK_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`branding.type.${type}` as TranslationKey)}
              </option>
            ))}
          </select>
        </div>

        {speciesOptions.length === 1 ? (
          <p className="mb-4 text-body text-soil-700">
            <span className="text-label uppercase">{t('branding.species')}</span>{' '}
            {speciesLabel(t, speciesOptions[0]!)}
          </p>
        ) : (
          <fieldset className="mb-4">
            <legend className="mb-1 text-label uppercase text-soil-700">
              {t('branding.species')}
            </legend>
            <div className="flex flex-col gap-1">
              {speciesOptions.map((species) => (
                <label
                  key={species}
                  className="flex min-h-touch-min items-center gap-3 text-body text-soil-900"
                >
                  <input
                    type="checkbox"
                    checked={chosenSpecies.includes(species)}
                    onChange={() => toggleSpecies(species)}
                    className="h-6 w-6 accent-ochre-500"
                  />
                  {speciesLabel(t, species)}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="mb-4 flex flex-col">
          <label htmlFor="body-position" className="mb-1 text-label uppercase text-soil-700">
            {t('branding.bodyPosition')}
          </label>
          <input
            id="body-position"
            value={bodyPosition}
            onChange={(event) => setBodyPosition(event.target.value)}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
          />
        </div>

        <div className="mb-4 flex flex-col">
          <label
            htmlFor="certificate-reference"
            className="mb-1 text-label uppercase text-soil-700"
          >
            {t('branding.certificate')}
          </label>
          <input
            id="certificate-reference"
            value={certificateReference}
            onChange={(event) => setCertificateReference(event.target.value)}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
          />
        </div>

        <div className="mb-6 flex flex-col">
          <label htmlFor="registered-at" className="mb-1 text-label uppercase text-soil-700">
            {t('branding.registeredAt')}
          </label>
          <input
            id="registered-at"
            type="date"
            max={farmToday()}
            value={registeredAt}
            onChange={(event) => setRegisteredAt(event.target.value)}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
          />
        </div>

        <button
          type="submit"
          disabled={!valid}
          className="flex min-h-touch-primary w-full items-center justify-center rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-50"
        >
          {t('branding.save')}
        </button>
      </form>

      <Link to="/animals" className="mt-6 inline-block text-body text-dam-700">
        {t('branding.back')}
      </Link>
    </section>
  );
}
