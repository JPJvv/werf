/**
 * Record a planting (FR-203) — what's in the ground, from what seed, sown how thick, and when it's
 * due off.
 *
 * The reference user here is standing at the edge of the block that was just planted, not at a
 * desk: one required field (crop), everything else optional, and a commit that lands LOCALLY and
 * instantly — no network anywhere in `save` (.claude/rules/frontend.md, NFR-007).
 *
 * The DAY is a field rather than an assumption, the same reason `RecordRainfallScreen` asks for one:
 * planting often gets logged that evening, not mid-row, and `occurredAt` IS the planted date
 * (there is no separate field for it) — a capture-day default would quietly misdate every season's
 * planting record by however long the farmer took to sit down and type it in.
 *
 * ⭐ THE BLOCK PICKER RECONCILES `?block=` AGAINST THE LIVE LIST ON EVERY RENDER, never snapshotted
 * once — the identical pattern and the identical reason `WalkBoundaryScreen` documents: the farm
 * switcher in the shell header does not navigate, so a farmer who switches farms mid-form must not
 * have a save silently target the wrong farm's block, and a `?block=A` → `?block=B` link on the same
 * route does not remount React at all.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { uuidv7 } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import { useAuth } from '../auth/AuthProvider';
import { farmToday } from '../farmTime';
import { useEffectiveLandUnits } from '../land/LocalLand';
import { useRecordPlanting } from './LocalPlantings';

/** Today ON THE FARM, as YYYY-MM-DD for the date input — not the device's zone (`farmTime.ts`). */
function today(): string {
  return farmToday();
}

/** The instant a day's planting happened, the same construction `RecordRainfallScreen` uses: NOW
 *  for today (the farmer is standing at the block), midday UTC for an earlier day (falls
 *  unambiguously inside that day in the farm's zone). The clock time carries no meaning for a
 *  planting; the DAY is the datum. */
function plantedInstant(day: string): Date {
  return day === today() ? new Date() : new Date(`${day}T12:00:00.000Z`);
}

/** An optional positive number as typed → a number, or undefined for "not given". */
function optionalPositiveNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function isBadPositiveNumber(text: string): boolean {
  return text.trim() !== '' && optionalPositiveNumber(text) === undefined;
}

export function RecordPlantingScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  // Merged with hydrated land units (the land-hydration pattern) — a block another device created
  // is a real piece of ground this device can plant, not just one it typed in itself.
  const units = useEffectiveLandUnits();
  const blocks = useMemo(() => units.filter((unit) => unit.kind === 'block'), [units]);
  const recordPlanting = useRecordPlanting();
  const [params] = useSearchParams();

  // Same reconciliation as `WalkBoundaryScreen` — see the module note.
  const requested = params.get('block');
  const [picked, setPicked] = useState<string | null>(null);
  const [lastRequested, setLastRequested] = useState(requested);
  if (requested !== lastRequested) {
    setLastRequested(requested);
    setPicked(null);
  }
  const preferredId = picked ?? requested ?? '';
  const selected = blocks.find((unit) => unit.id === preferredId) ?? blocks[0] ?? null;
  const selectedId = selected?.id ?? '';

  const [crop, setCrop] = useState('');
  const [cultivar, setCultivar] = useState('');
  const [densityValue, setDensityValue] = useState('');
  const [densityUnit, setDensityUnit] = useState('');
  const [seedSource, setSeedSource] = useState('');
  const [expectedHarvestDate, setExpectedHarvestDate] = useState('');
  const [day, setDay] = useState(today);
  const [savedCrop, setSavedCrop] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!activeFarm) return null;

  const density = optionalPositiveNumber(densityValue);
  // A value with no unit, or a unit with no value, is not a density — refuse the pair rather than
  // silently dropping half of it.
  const densityBad =
    isBadPositiveNumber(densityValue) ||
    (density !== undefined && densityUnit.trim() === '') ||
    (density === undefined && densityValue.trim() === '' && densityUnit.trim() !== '');
  const validCrop = crop.trim() !== '';
  const valid = validCrop && !densityBad;

  const clearSaved = () => setSavedCrop(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || !selected || saving) return;
    setSaving(true);

    // Not "saved" until the local write is durable (P1.1).
    await recordPlanting({
      id: uuidv7(),
      farmId: activeFarm.id,
      landUnitId: selected.id,
      occurredAt: plantedInstant(day),
      crop: crop.trim(),
      ...(cultivar.trim() === '' ? {} : { cultivar: cultivar.trim() }),
      ...(density === undefined ? {} : { density: { value: density, unit: densityUnit.trim() } }),
      ...(seedSource.trim() === '' ? {} : { seedSource: seedSource.trim() }),
      ...(expectedHarvestDate === '' ? {} : { expectedHarvestDate }),
    });

    setSavedCrop(crop.trim());
    setCrop('');
    setCultivar('');
    setDensityValue('');
    setDensityUnit('');
    setSeedSource('');
    setExpectedHarvestDate('');
    setSaving(false);
  };

  if (blocks.length === 0) {
    return (
      <section className="mx-auto w-full max-w-3xl p-4">
        <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('crops.plant.title')}</h1>
        <p className="mb-4 text-body text-soil-700">{t('crops.plant.noBlocks')}</p>
        <Link to="/land/new" className="text-body text-dam-700">
          {t('land.add.block')}
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('crops.plant.title')}</h1>

      {savedCrop !== null && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {savedCrop} {t('crops.plant.saved')}
        </p>
      )}

      <form onSubmit={save}>
        <div className="mb-4 flex flex-col">
          <label htmlFor="block" className="mb-1 text-label uppercase text-soil-700">
            {t('crops.plant.which')}
          </label>
          <select
            id="block"
            value={selectedId}
            onChange={(e) => {
              setPicked(e.target.value);
              clearSaved();
            }}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body text-soil-900"
          >
            {blocks.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.code}
                {unit.name ? ` — ${unit.name}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-4 flex flex-col">
          <label htmlFor="crop" className="mb-1 text-label uppercase text-soil-700">
            {t('crops.plant.crop')}
          </label>
          <input
            id="crop"
            name="crop"
            type="text"
            value={crop}
            onChange={(e) => {
              clearSaved();
              setCrop(e.target.value);
            }}
            className="min-h-touch-primary rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
          />
        </div>

        <div className="mb-4 flex flex-col">
          <label htmlFor="cultivar" className="mb-1 text-label uppercase text-soil-700">
            {t('crops.plant.cultivar')}
          </label>
          <input
            id="cultivar"
            name="cultivar"
            type="text"
            value={cultivar}
            onChange={(e) => {
              clearSaved();
              setCultivar(e.target.value);
            }}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
          />
        </div>

        <div className="mb-4 flex gap-2">
          <div className="flex flex-1 flex-col">
            <label htmlFor="densityValue" className="mb-1 text-label uppercase text-soil-700">
              {t('crops.plant.density')}
            </label>
            <input
              id="densityValue"
              name="densityValue"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={densityValue}
              onChange={(e) => {
                clearSaved();
                setDensityValue(e.target.value);
              }}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data tabular-nums text-body text-soil-900"
            />
          </div>
          <div className="flex flex-1 flex-col">
            <label htmlFor="densityUnit" className="mb-1 text-label uppercase text-soil-700">
              {t('crops.plant.densityUnit')}
            </label>
            <input
              id="densityUnit"
              name="densityUnit"
              type="text"
              placeholder={t('crops.plant.densityUnitExample')}
              value={densityUnit}
              onChange={(e) => {
                clearSaved();
                setDensityUnit(e.target.value);
              }}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
            />
          </div>
        </div>
        {densityBad && (
          <p className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
            {t('crops.plant.densityBad')}
          </p>
        )}

        <div className="mb-4 flex flex-col">
          <label htmlFor="seedSource" className="mb-1 text-label uppercase text-soil-700">
            {t('crops.plant.seedSource')}
          </label>
          <input
            id="seedSource"
            name="seedSource"
            type="text"
            value={seedSource}
            onChange={(e) => {
              clearSaved();
              setSeedSource(e.target.value);
            }}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
          />
        </div>

        <div className="mb-4 flex flex-col">
          <label htmlFor="expectedHarvestDate" className="mb-1 text-label uppercase text-soil-700">
            {t('crops.plant.expectedHarvest')}
          </label>
          <input
            id="expectedHarvestDate"
            name="expectedHarvestDate"
            type="date"
            min={day}
            value={expectedHarvestDate}
            onChange={(e) => {
              clearSaved();
              setExpectedHarvestDate(e.target.value);
            }}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data tabular-nums text-body text-soil-900"
          />
        </div>

        <div className="mb-6 flex flex-col">
          <label htmlFor="day" className="mb-1 text-label uppercase text-soil-700">
            {t('crops.plant.day')}
          </label>
          <input
            id="day"
            name="day"
            type="date"
            value={day}
            max={today()}
            onChange={(e) => {
              clearSaved();
              setDay(e.target.value);
            }}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data tabular-nums text-body text-soil-900"
          />
        </div>

        <button
          type="submit"
          disabled={!valid || saving}
          className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
        >
          {t('crops.plant.save')}
        </button>
      </form>

      <Link to="/land" className="mt-6 inline-block text-body text-dam-700">
        {t('crops.plant.back')}
      </Link>
    </section>
  );
}
