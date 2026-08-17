/**
 * Record a spray to GlobalGAP standard (FR-204) — COMPLIANCE-GATED
 * (legal-compliance.md § 4). The crush-side capture that FR-211's audit trail and the future
 * harvest guard (4d) both depend on.
 *
 * ⭐ THE EARLIEST SAFE HARVEST DATE IS SHOWN BEFORE THE FARMER WALKS AWAY FROM THE TANK. Mirrors
 * `RecordHealthScreen.tsx`'s own reasoning exactly, one PHI over: the date shown here is a PREVIEW
 * computed from the CACHED chemical-product register using the same pure domain function the server
 * uses; the date actually STORED is computed server-side from the registration in force on the
 * spray day (ADR-0005). The client never sends a PHI or active ingredients; it sends a product id.
 *
 * Offline-first: `save` commits locally and instantly with no network in the path. The product
 * register is a local cache, so the picker and the PHI preview both work at the tank in a dead zone.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { uuidv7 } from '@werf/core';
import { earliestHarvestDateFor } from '@werf/domain';
import { useTranslation } from '../i18n/LocaleProvider';
import { useAuth } from '../auth/AuthProvider';
import { farmToday } from '../farmTime';
import { useEffectiveLandUnits } from '../land/LocalLand';
import {
  useChemicalProducts,
  chemicalProductsInForceOn,
  type StoredChemicalProduct,
} from './LocalChemicalProducts';
import { useRecordSpray } from './LocalSprays';

function today(): string {
  return farmToday();
}

function sprayedInstant(day: string): Date {
  return day === today() ? new Date() : new Date(`${day}T12:00:00.000Z`);
}

function optionalPositiveNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** The earliest safe harvest day from the cached registration — a PREVIEW, never the stored value
 *  (see the module header). Null when the product carries no PHI on record. */
function harvestPreview(
  product: StoredChemicalProduct | undefined,
  sprayedOn: string,
): string | null {
  if (!product || product.phiDays === null) return null;
  return earliestHarvestDateFor(sprayedOn, product.phiDays);
}

export function RecordSprayScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const units = useEffectiveLandUnits();
  const blocks = useMemo(() => units.filter((unit) => unit.kind === 'block'), [units]);
  const products = useChemicalProducts();
  const recordSpray = useRecordSpray();
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

  const [sprayedOn, setSprayedOn] = useState(today);
  const [productId, setProductId] = useState('');
  const [rateValue, setRateValue] = useState('');
  const [waterValue, setWaterValue] = useState('');
  const [operator, setOperator] = useState('');
  const [equipment, setEquipment] = useState('');
  const [windKph, setWindKph] = useState('');
  const [tempC, setTempC] = useState('');
  const [targetPest, setTargetPest] = useState('');
  const [savedProduct, setSavedProduct] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const inForce = useMemo(
    () => chemicalProductsInForceOn(products, sprayedOn),
    [products, sprayedOn],
  );
  const product = inForce.find((p) => p.id === productId);

  if (!activeFarm) return null;

  const clearDate = harvestPreview(product, sprayedOn);
  const valid = selected !== null && product !== undefined;

  const clearSaved = () => setSavedProduct(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || !selected || !product || saving) return;
    setSaving(true);

    const rateLPerHa = optionalPositiveNumber(rateValue);
    const waterLPerHa = optionalPositiveNumber(waterValue);

    await recordSpray({
      id: uuidv7(),
      farmId: activeFarm.id,
      landUnitId: selected.id,
      occurredAt: sprayedInstant(sprayedOn).toISOString(),
      sprayedOn,
      productId: product.id,
      ...(rateLPerHa === undefined ? {} : { rateLPerHa }),
      ...(waterLPerHa === undefined ? {} : { waterLPerHa }),
      ...(operator.trim() === '' ? {} : { operator: operator.trim() }),
      ...(equipment.trim() === '' ? {} : { equipment: equipment.trim() }),
      ...(windKph.trim() === '' ? {} : { windKph: Number(windKph) }),
      ...(tempC.trim() === '' ? {} : { tempC: Number(tempC) }),
      ...(targetPest.trim() === '' ? {} : { targetPest: targetPest.trim() }),
    });

    setSavedProduct(product.name);
    setProductId('');
    setRateValue('');
    setWaterValue('');
    setOperator('');
    setEquipment('');
    setWindKph('');
    setTempC('');
    setTargetPest('');
    setSaving(false);
  };

  if (blocks.length === 0) {
    return (
      <section className="mx-auto w-full max-w-3xl p-4">
        <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('crops.spray.title')}</h1>
        <p className="mb-4 text-body text-soil-700">{t('crops.spray.noBlocks')}</p>
        <Link to="/land/new" className="text-body text-dam-700">
          {t('land.add.block')}
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('crops.spray.title')}</h1>

      {savedProduct !== null && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {savedProduct} {t('crops.spray.saved')}
        </p>
      )}

      {products.length === 0 ? (
        <p className="border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
          {t('crops.spray.noProducts')}
        </p>
      ) : (
        <form onSubmit={save}>
          <div className="mb-4 flex flex-col">
            <label htmlFor="block" className="mb-1 text-label uppercase text-soil-700">
              {t('crops.spray.which')}
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

          {/* Before the product, because the PHI preview below depends on it: a farmer
              back-dating a capture must see the earliest-harvest answer move with the day. */}
          <div className="mb-4 flex flex-col">
            <label htmlFor="sprayedOn" className="mb-1 text-label uppercase text-soil-700">
              {t('crops.spray.day')}
            </label>
            <input
              id="sprayedOn"
              name="sprayedOn"
              type="date"
              max={today()}
              value={sprayedOn}
              onChange={(e) => {
                clearSaved();
                setSprayedOn(e.target.value);
              }}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
            />
          </div>

          <div className="mb-4 flex flex-col">
            <label htmlFor="product" className="mb-1 text-label uppercase text-soil-700">
              {t('crops.spray.product')}
            </label>
            <select
              id="product"
              name="product"
              value={productId}
              onChange={(e) => {
                clearSaved();
                setProductId(e.target.value);
              }}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
            >
              <option value="">{t('crops.spray.chooseProduct')}</option>
              {inForce.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.registrationNumber}
                </option>
              ))}
            </select>
            {/* Answers "so when CAN I harvest?" before it is asked — at the tank, not three weeks
                later. A product with no PHI on record says so, because "no restriction" is an
                answer a farmer needs just as much as a date. */}
            {product && (
              <p className="mt-1 border-l-4 border-dam-700 bg-sand-100 p-2 text-body text-soil-900">
                {clearDate === null ? (
                  t('crops.spray.noPhi')
                ) : (
                  <>
                    {t('crops.spray.harvestFrom')}{' '}
                    <span className="font-data tabular-nums">{clearDate}</span>
                  </>
                )}
              </p>
            )}
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2">
            <div className="flex flex-col">
              <label htmlFor="rateValue" className="mb-1 text-label uppercase text-soil-700">
                {t('crops.spray.rate')}
              </label>
              <input
                id="rateValue"
                name="rateValue"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={rateValue}
                onChange={(e) => setRateValue(e.target.value)}
                className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data tabular-nums text-body text-soil-900"
              />
            </div>
            <div className="flex flex-col">
              <label htmlFor="waterValue" className="mb-1 text-label uppercase text-soil-700">
                {t('crops.spray.water')}
              </label>
              <input
                id="waterValue"
                name="waterValue"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={waterValue}
                onChange={(e) => setWaterValue(e.target.value)}
                className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data tabular-nums text-body text-soil-900"
              />
            </div>
          </div>

          <div className="mb-4 flex flex-col">
            <label htmlFor="targetPest" className="mb-1 text-label uppercase text-soil-700">
              {t('crops.spray.targetPest')}
            </label>
            <input
              id="targetPest"
              name="targetPest"
              type="text"
              value={targetPest}
              onChange={(e) => setTargetPest(e.target.value)}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
            />
          </div>

          <div className="mb-4 flex flex-col">
            <label htmlFor="operator" className="mb-1 text-label uppercase text-soil-700">
              {t('crops.spray.operator')}
            </label>
            <input
              id="operator"
              name="operator"
              type="text"
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
            />
          </div>

          <div className="mb-4 flex flex-col">
            <label htmlFor="equipment" className="mb-1 text-label uppercase text-soil-700">
              {t('crops.spray.equipment')}
            </label>
            <input
              id="equipment"
              name="equipment"
              type="text"
              value={equipment}
              onChange={(e) => setEquipment(e.target.value)}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
            />
          </div>

          <div className="mb-6 grid grid-cols-2 gap-2">
            <div className="flex flex-col">
              <label htmlFor="windKph" className="mb-1 text-label uppercase text-soil-700">
                {t('crops.spray.wind')}
              </label>
              <input
                id="windKph"
                name="windKph"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={windKph}
                onChange={(e) => setWindKph(e.target.value)}
                className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data tabular-nums text-body text-soil-900"
              />
            </div>
            <div className="flex flex-col">
              <label htmlFor="tempC" className="mb-1 text-label uppercase text-soil-700">
                {t('crops.spray.temp')}
              </label>
              <input
                id="tempC"
                name="tempC"
                type="number"
                inputMode="decimal"
                step="any"
                value={tempC}
                onChange={(e) => setTempC(e.target.value)}
                className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data tabular-nums text-body text-soil-900"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={!valid || saving}
            className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
          >
            {t('crops.spray.save')}
          </button>
        </form>
      )}

      <Link to="/land" className="mt-6 inline-block text-body text-dam-700">
        {t('crops.spray.back')}
      </Link>
    </section>
  );
}
