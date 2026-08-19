/**
 * Record a fertiliser application, including fertigation (FR-206).
 *
 * Same reference user and same offline discipline as `RecordPlantingScreen`: one required
 * decision beyond the block (the method — it is what distinguishes fertigation from broadcast/band,
 * FR-206's own words), everything else optional, a commit that lands LOCALLY and instantly with no
 * network in `save` (.claude/rules/frontend.md, NFR-007).
 *
 * The block picker reconciles `?block=` against the live list on every render, the identical
 * pattern `RecordPlantingScreen`/`WalkBoundaryScreen` document — see either for the full reasoning.
 *
 * ⭐ Inventory auto-decrement (Phase 4e, FR-502) — OPTIONAL, additive, the identical shape
 * `RecordSprayScreen.tsx`'s own module note documents one guard lighter (FR-206 carries no
 * compliance gate): picking a lot stores an `inventoryLotId` reference on the application AND,
 * as a SEPARATE local commit, appends a `consumed` `inventory_movement` through the same capture
 * `ReceiveStockScreen` uses.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { uuidv7 } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { useAuth } from '../auth/AuthProvider';
import { farmToday } from '../farmTime';
import { useEffectiveLandUnits } from '../land/LocalLand';
import {
  useEffectiveInventoryItems,
  useEffectiveInventoryLots,
  useCurrentQuantity,
} from '../inventory/stock';
import { useRecordInventoryMovement } from '../inventory/LocalInventory';
import { useRecordFertiliser, type FertiliserMethod } from './LocalFertiliser';

const METHODS: readonly FertiliserMethod[] = ['broadcast', 'band', 'fertigation', 'foliar'];

function today(): string {
  return farmToday();
}

/** The instant a day's application happened — NOW for today, midday UTC for an earlier day, the
 *  same construction `RecordPlantingScreen` uses and for the identical reason. */
function appliedInstant(day: string): Date {
  return day === today() ? new Date() : new Date(`${day}T12:00:00.000Z`);
}

function optionalPositiveNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function isBadPositiveNumber(text: string): boolean {
  return text.trim() !== '' && optionalPositiveNumber(text) === undefined;
}

export function RecordFertiliserScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const units = useEffectiveLandUnits();
  const blocks = useMemo(() => units.filter((unit) => unit.kind === 'block'), [units]);
  const recordFertiliser = useRecordFertiliser();
  const recordMovement = useRecordInventoryMovement();
  const inventoryItems = useEffectiveInventoryItems();
  const inventoryLots = useEffectiveInventoryLots();
  const [params] = useSearchParams();

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

  const [product, setProduct] = useState('');
  const [method, setMethod] = useState<FertiliserMethod>('broadcast');
  const [rateValue, setRateValue] = useState('');
  const [rateUnit, setRateUnit] = useState('');
  const [operator, setOperator] = useState('');
  const [day, setDay] = useState(today);
  const [inventoryLotId, setInventoryLotId] = useState('');
  const [quantityUsed, setQuantityUsed] = useState('');
  const [savedProduct, setSavedProduct] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Fertiliser lots only (Phase 4e, FR-502) — see `RecordSprayScreen.tsx`'s identical note on why
  // this is matched by category, not by `product` (two different, unlinked catalogues).
  const fertiliserLots = useMemo(
    () =>
      inventoryLots
        .filter(
          (lot) =>
            inventoryItems.find((i) => i.id === lot.inventoryItemId)?.category === 'fertiliser',
        )
        .map((lot) => ({
          lot,
          item: inventoryItems.find((i) => i.id === lot.inventoryItemId),
        })),
    [inventoryLots, inventoryItems],
  );
  const selectedLot = fertiliserLots.find((c) => c.lot.id === inventoryLotId);
  const currentQuantity = useCurrentQuantity(inventoryLotId);

  if (!activeFarm) return null;

  const rateValueNumber = optionalPositiveNumber(rateValue);
  const rateBad =
    isBadPositiveNumber(rateValue) ||
    (rateValueNumber !== undefined && rateUnit.trim() === '') ||
    (rateValueNumber === undefined && rateValue.trim() === '' && rateUnit.trim() !== '');
  const validProduct = product.trim() !== '';
  const quantityUsedNumber = optionalPositiveNumber(quantityUsed);
  const quantityBad = inventoryLotId !== '' && quantityUsedNumber === undefined;
  const valid = validProduct && !rateBad && !quantityBad;

  const clearSaved = () => setSavedProduct(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || !selected || saving) return;
    setSaving(true);

    await recordFertiliser({
      id: uuidv7(),
      farmId: activeFarm.id,
      landUnitId: selected.id,
      occurredAt: appliedInstant(day),
      product: product.trim(),
      method,
      ...(rateValueNumber === undefined
        ? {}
        : { rate: { value: rateValueNumber, unit: rateUnit.trim() } }),
      ...(operator.trim() === '' ? {} : { operator: operator.trim() }),
      ...(inventoryLotId === '' ? {} : { inventoryLotId }),
    });

    // A SEPARATE local commit — see the module note. `quantityBad` already kept `valid` false
    // unless a picked lot carries a real quantity.
    if (inventoryLotId !== '' && quantityUsedNumber !== undefined) {
      await recordMovement({
        id: uuidv7(),
        farmId: activeFarm.id,
        inventoryLotId,
        occurredAt: appliedInstant(day),
        reason: 'consumed',
        quantity: quantityUsedNumber,
        currentQuantity,
      });
    }

    setSavedProduct(product.trim());
    setProduct('');
    setRateValue('');
    setRateUnit('');
    setOperator('');
    setInventoryLotId('');
    setQuantityUsed('');
    setSaving(false);
  };

  if (blocks.length === 0) {
    return (
      <section className="mx-auto w-full max-w-3xl p-4">
        <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('crops.fertilise.title')}</h1>
        <p className="mb-4 text-body text-soil-700">{t('crops.fertilise.noBlocks')}</p>
        <Link to="/land/new" className="text-body text-dam-700">
          {t('land.add.block')}
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('crops.fertilise.title')}</h1>

      {savedProduct !== null && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {savedProduct} {t('crops.fertilise.saved')}
        </p>
      )}

      <form onSubmit={save}>
        <div className="mb-4 flex flex-col">
          <label htmlFor="block" className="mb-1 text-label uppercase text-soil-700">
            {t('crops.fertilise.which')}
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
          <label htmlFor="product" className="mb-1 text-label uppercase text-soil-700">
            {t('crops.fertilise.product')}
          </label>
          <input
            id="product"
            name="product"
            type="text"
            value={product}
            onChange={(e) => {
              clearSaved();
              setProduct(e.target.value);
            }}
            className="min-h-touch-primary rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
          />
        </div>

        <fieldset className="mb-4 border-0 p-0">
          <legend className="mb-1 text-label uppercase text-soil-700">
            {t('crops.fertilise.method')}
          </legend>
          <div className="flex flex-wrap gap-2">
            {METHODS.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={method === m}
                onClick={() => {
                  clearSaved();
                  setMethod(m);
                }}
                className={`min-h-touch-min flex-1 rounded border px-2 font-ui text-body ${
                  method === m
                    ? 'border-soil-900 bg-sand-100 text-soil-900'
                    : 'border-soil-200 bg-sand-50 text-soil-900'
                }`}
              >
                {t(`crops.fertilise.method.${m}` as TranslationKey)}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mb-4 flex gap-2">
          <div className="flex flex-1 flex-col">
            <label htmlFor="rateValue" className="mb-1 text-label uppercase text-soil-700">
              {t('crops.fertilise.rate')}
            </label>
            <input
              id="rateValue"
              name="rateValue"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={rateValue}
              onChange={(e) => {
                clearSaved();
                setRateValue(e.target.value);
              }}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data tabular-nums text-body text-soil-900"
            />
          </div>
          <div className="flex flex-1 flex-col">
            <label htmlFor="rateUnit" className="mb-1 text-label uppercase text-soil-700">
              {t('crops.fertilise.rateUnit')}
            </label>
            <input
              id="rateUnit"
              name="rateUnit"
              type="text"
              placeholder={t('crops.fertilise.rateUnitExample')}
              value={rateUnit}
              onChange={(e) => {
                clearSaved();
                setRateUnit(e.target.value);
              }}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
            />
          </div>
        </div>
        {rateBad && (
          <p className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
            {t('crops.fertilise.rateBad')}
          </p>
        )}

        {fertiliserLots.length > 0 && (
          <div className="mb-4 flex flex-col">
            <label htmlFor="inventoryLot" className="mb-1 text-label uppercase text-soil-700">
              {t('crops.fertilise.fromStock')}
            </label>
            <select
              id="inventoryLot"
              value={inventoryLotId}
              onChange={(e) => {
                clearSaved();
                setInventoryLotId(e.target.value);
                setQuantityUsed('');
              }}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
            >
              <option value="">{t('crops.fertilise.notTracked')}</option>
              {fertiliserLots.map(({ lot, item }) => (
                <option key={lot.id} value={lot.id}>
                  {item?.name ?? lot.inventoryItemId}
                  {lot.batch ? ` · ${lot.batch}` : ''} — {lot.quantityOnHand} {item?.unit ?? ''}
                </option>
              ))}
            </select>
            {selectedLot && (
              <div className="mt-2 flex flex-col">
                <label htmlFor="quantityUsed" className="mb-1 text-label uppercase text-soil-700">
                  {t('crops.fertilise.quantityUsed')} ({selectedLot.item?.unit ?? ''})
                </label>
                <input
                  id="quantityUsed"
                  name="quantityUsed"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={quantityUsed}
                  onChange={(e) => {
                    clearSaved();
                    setQuantityUsed(e.target.value);
                  }}
                  className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data tabular-nums text-body text-soil-900"
                />
                {quantityBad && (
                  <p className="mt-1 text-label text-klei-700">
                    {t('crops.fertilise.quantityUsedBad')}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mb-4 flex flex-col">
          <label htmlFor="operator" className="mb-1 text-label uppercase text-soil-700">
            {t('crops.fertilise.operator')}
          </label>
          <input
            id="operator"
            name="operator"
            type="text"
            value={operator}
            onChange={(e) => {
              clearSaved();
              setOperator(e.target.value);
            }}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
          />
        </div>

        <div className="mb-6 flex flex-col">
          <label htmlFor="day" className="mb-1 text-label uppercase text-soil-700">
            {t('crops.fertilise.day')}
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
          {t('crops.fertilise.save')}
        </button>
      </form>

      <Link to="/land" className="mt-6 inline-block text-body text-dam-700">
        {t('crops.fertilise.back')}
      </Link>
    </section>
  );
}
