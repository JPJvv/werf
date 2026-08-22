/** Farmer-owned harvest log. Interval calculations are reminders and never block capture. */

import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { uuidv7 } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import { useAuth } from '../auth/AuthProvider';
import { farmToday } from '../farmTime';
import { useEffectiveLandUnits } from '../land/LocalLand';
import { useEffectiveInventoryItems } from '../inventory/stock';
import { useRecordHarvest } from './LocalHarvest';
import { usePhiGuard } from './usePhiGuard';

function today(): string {
  return farmToday();
}

function harvestedInstant(day: string): Date {
  return day === today() ? new Date() : new Date(`${day}T12:00:00.000Z`);
}

function optionalPositiveNumber(text: string): number | undefined {
  const value = Number(text.trim());
  return text.trim() !== '' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function RecordHarvestScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const units = useEffectiveLandUnits();
  const blocks = useMemo(() => units.filter((unit) => unit.kind === 'block'), [units]);
  const products = useEffectiveInventoryItems();
  const recordHarvest = useRecordHarvest();
  const [params] = useSearchParams();

  const requested = params.get('block');
  const [picked, setPicked] = useState<string | null>(null);
  const [lastRequested, setLastRequested] = useState(requested);
  if (requested !== lastRequested) {
    setLastRequested(requested);
    setPicked(null);
  }
  const selected =
    blocks.find((unit) => unit.id === (picked ?? requested ?? '')) ?? blocks[0] ?? null;
  const selectedId = selected?.id ?? '';

  const [harvestedOn, setHarvestedOn] = useState(today);
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [grade, setGrade] = useState('');
  const [destination, setDestination] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const guard = usePhiGuard(selectedId, harvestedOn);
  const reminderProduct =
    guard.blocked && guard.reason === 'active_phi'
      ? products.find((product) => product.id === guard.blockedBy.productId)
      : undefined;
  const quantityValue = optionalPositiveNumber(quantity);
  const valid =
    selected !== null && harvestedOn !== '' && unit.trim() !== '' && quantityValue !== undefined;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeFarm || !valid || !selected || quantityValue === undefined || saving) return;
    setSaving(true);
    await recordHarvest({
      id: uuidv7(),
      farmId: activeFarm.id,
      landUnitId: selected.id,
      occurredAt: harvestedInstant(harvestedOn),
      harvestedOn,
      quantity: quantityValue,
      unit: unit.trim(),
      ...(grade.trim() === '' ? {} : { grade: grade.trim() }),
      ...(destination.trim() === '' ? {} : { destination: destination.trim() }),
    });
    setSaved(true);
    setQuantity('');
    setUnit('');
    setGrade('');
    setDestination('');
    setSaving(false);
  };

  if (!activeFarm) return null;
  if (blocks.length === 0) {
    return (
      <section className="mx-auto w-full max-w-3xl p-4">
        <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('crops.harvest.title')}</h1>
        <p className="mb-4 text-body text-soil-700">{t('crops.harvest.noBlocks')}</p>
        <Link to="/land/new" className="text-body text-dam-700">
          {t('land.add.block')}
        </Link>
      </section>
    );
  }

  const fieldClass =
    'min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900';

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('crops.harvest.title')}</h1>
      {saved && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {t('crops.harvest.saved')}
        </p>
      )}

      <form onSubmit={save}>
        <div className="mb-4 flex flex-col">
          <label htmlFor="block" className="mb-1 text-label uppercase text-soil-700">
            {t('crops.harvest.which')}
          </label>
          <select
            id="block"
            value={selectedId}
            onChange={(event) => {
              setPicked(event.target.value);
              setSaved(false);
            }}
            className={fieldClass}
          >
            {blocks.map((block) => (
              <option key={block.id} value={block.id}>
                {block.code}
                {block.name ? ` — ${block.name}` : ''}
              </option>
            ))}
          </select>
          {selected?.parentId !== null && selected !== null && (
            <p className="mt-1 border-l-4 border-ochre-500 bg-sand-100 p-2 text-body text-soil-900">
              {t('crops.harvest.splitBlockWarning')}
            </p>
          )}
        </div>

        <div className="mb-4 flex flex-col">
          <label htmlFor="harvestedOn" className="mb-1 text-label uppercase text-soil-700">
            {t('crops.harvest.day')}
          </label>
          <input
            id="harvestedOn"
            type="date"
            max={today()}
            value={harvestedOn}
            onChange={(event) => {
              setHarvestedOn(event.target.value);
              setSaved(false);
            }}
            className={`${fieldClass} font-data tabular-nums`}
          />
        </div>

        {guard.blocked && guard.reason === 'active_phi' && (
          <div className="mb-4 border-l-4 border-ochre-500 bg-sand-100 p-3 text-body text-soil-900">
            <p className="mb-1 font-ui font-semibold">{t('crops.harvest.reminderTitle')}</p>
            <p>
              {reminderProduct?.name ?? t('crops.harvest.blockedProductUnknown')}{' '}
              {t('crops.harvest.blockedSprayedOn')}{' '}
              <span className="font-data tabular-nums">{guard.blockedBy.sprayedOn}</span>.{' '}
              {t('crops.harvest.blockedEarliest')}{' '}
              <span className="font-data tabular-nums">{guard.blockedBy.earliestHarvestDate}</span>.{' '}
              {t('crops.harvest.warningDoesNotBlock')}
            </p>
          </div>
        )}
        {guard.blocked && guard.reason === 'unresolved' && (
          <div className="mb-4 border-l-4 border-ochre-500 bg-sand-100 p-3 text-body text-soil-900">
            {t('crops.harvest.unresolved')}
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-2">
          <label className="flex flex-col text-label uppercase text-soil-700">
            {t('crops.harvest.quantity')}
            <input
              id="quantity"
              type="number"
              min="0"
              step="any"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className={`${fieldClass} font-data tabular-nums`}
            />
          </label>
          <label className="flex flex-col text-label uppercase text-soil-700">
            {t('crops.harvest.unit')}
            <input
              id="unit"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              className={fieldClass}
            />
          </label>
        </div>
        <label className="mb-4 flex flex-col text-label uppercase text-soil-700">
          {t('crops.harvest.grade')}
          <input
            id="grade"
            value={grade}
            onChange={(event) => setGrade(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="mb-6 flex flex-col text-label uppercase text-soil-700">
          {t('crops.harvest.destination')}
          <input
            id="destination"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            className={fieldClass}
          />
        </label>

        <button
          type="submit"
          disabled={!valid || saving}
          className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
        >
          {t('crops.harvest.save')}
        </button>
      </form>
      <Link to="/land" className="mt-6 inline-block text-body text-dam-700">
        {t('crops.harvest.back')}
      </Link>
    </section>
  );
}
