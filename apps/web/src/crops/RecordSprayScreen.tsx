/**
 * Record a spray to GlobalGAP standard (FR-204) — COMPLIANCE-GATED
 * (legal-compliance.md § 4). The crush-side capture that FR-211's audit trail and the harvest
 * guard (4d) both depend on.
 *
 * ⭐ THE EARLIEST SAFE HARVEST DATE IS SHOWN BEFORE THE FARMER WALKS AWAY FROM THE TANK. Mirrors
 * `RecordHealthScreen.tsx`'s own reasoning exactly, one PHI over: the date shown here is a PREVIEW
 * computed from the CACHED chemical-product register using the same pure domain function the server
 * uses; the date actually STORED is computed server-side from the registration in force on the
 * spray day (ADR-0005). The client never sends a PHI or active ingredients; it sends a product id.
 *
 * ⭐ BLOCKS AT CAPTURE, OFFLINE, THE OTHER DIRECTION TOO (legal-compliance.md § 4.3): when the
 * preview above would clear AFTER the block's own planned harvest date (`useSprayPhiGuard`,
 * `usePhiGuard.ts`), this screen refuses to save unless overridden — mirrors
 * `RecordHarvestScreen.tsx`'s own override UI exactly, one guard over. No server round trip needed
 * to know: the planned harvest date is this device's own `useCurrentPlanting` read.
 *
 * Offline-first: `save` commits locally and instantly with no network in the path. The product
 * register and the planting log are both local caches, so the picker, the PHI preview, and the
 * guard all work at the tank in a dead zone.
 *
 * ⭐ Inventory auto-decrement (Phase 4e, FR-502) — OPTIONAL, additive: a farm without stock
 * tracking on sees no lot picker's worth of extra decisions. Picking a lot stores an
 * `inventoryLotId` reference ON the spray event (a plain, uncompliance-gated field — see
 * `@werf/domain`'s `SprayInput`) and, separately, appends a `consumed` `inventory_movement`
 * through the SAME local capture 4e·3's `ReceiveStockScreen` uses (`useRecordInventoryMovement`).
 * These are two independent local commits, not one atomic write: if the spray itself is later
 * refused server-side (a 4xx on a PHI guard this device's stale cache did not know about), the
 * movement still lands — the stock genuinely left the shed regardless of whether the compliance
 * write was accepted, the identical "the spray happened whether or not the shed card was
 * accurate" reasoning `stock.ts`'s own module note gives for a shortfall.
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
  useEffectiveInventoryItems,
  useEffectiveInventoryLots,
  useCurrentQuantity,
} from '../inventory/stock';
import { useRecordInventoryMovement } from '../inventory/LocalInventory';
import {
  useChemicalProducts,
  chemicalProductsInForceOn,
  type StoredChemicalProduct,
} from './LocalChemicalProducts';
import { useRecordSpray } from './LocalSprays';
import { useSprayPhiGuard } from './usePhiGuard';

const OVERRIDE_REASON_CATEGORIES = [
  'emergency_pest_control',
  'harvest_date_will_move',
  'misrecorded_planting',
  'other',
] as const;
type OverrideReasonCategory = (typeof OVERRIDE_REASON_CATEGORIES)[number];

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

  const [sprayedOn, setSprayedOn] = useState(today);
  const [productId, setProductId] = useState('');
  const [rateValue, setRateValue] = useState('');
  const [waterValue, setWaterValue] = useState('');
  const [operator, setOperator] = useState('');
  const [equipment, setEquipment] = useState('');
  const [windKph, setWindKph] = useState('');
  const [tempC, setTempC] = useState('');
  const [targetPest, setTargetPest] = useState('');
  const [overriding, setOverriding] = useState(false);
  const [overrideCategory, setOverrideCategory] = useState<OverrideReasonCategory | ''>('');
  const [overrideText, setOverrideText] = useState('');
  const [inventoryLotId, setInventoryLotId] = useState('');
  const [quantityUsed, setQuantityUsed] = useState('');
  const [savedProduct, setSavedProduct] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const inForce = useMemo(
    () => chemicalProductsInForceOn(products, sprayedOn),
    [products, sprayedOn],
  );
  const product = inForce.find((p) => p.id === productId);

  // Chemical lots only (Phase 4e, FR-502) — a fertiliser or feed lot has no place in a spray
  // capture. Not filtered or matched against `productId`: `chemical_products` (national reference,
  // what the product IS) and an inventory item (farm-owned, what THIS farm has) are deliberately
  // two different catalogues that this app does not yet link (filed, not built — phase-checklists.md
  // 4e·4's own note), so the farmer matches them by name, the same posture `ReceiveStockScreen`
  // already takes for every capture that reads stock.
  const chemicalLots = useMemo(
    () =>
      inventoryLots
        .filter(
          (lot) =>
            inventoryItems.find((i) => i.id === lot.inventoryItemId)?.category === 'chemical',
        )
        .map((lot) => ({
          lot,
          item: inventoryItems.find((i) => i.id === lot.inventoryItemId),
        })),
    [inventoryLots, inventoryItems],
  );
  const selectedLot = chemicalLots.find((c) => c.lot.id === inventoryLotId);

  // Called unconditionally, before the `!activeFarm` early return below (Rules of Hooks) — the
  // identical ordering constraint `RecordHarvestScreen.tsx`'s own guard call obeys. Read
  // unconditionally too, for the same reason — `''` reads as zero, which is never used below.
  const currentQuantity = useCurrentQuantity(inventoryLotId);
  const guard = useSprayPhiGuard(selectedId, sprayedOn, product?.phiDays ?? undefined);

  if (!activeFarm) return null;

  const clearDate = harvestPreview(product, sprayedOn);
  const overrideReady = overrideCategory !== '' && overrideText.trim() !== '';
  const needsOverride = guard.blocked;
  const quantityUsedNumber = optionalPositiveNumber(quantityUsed);
  // Lot picked + quantity blank must block save, never silently emit no movement — see the module
  // note's own "these are two independent commits" point: an unmatched pair here would mean the
  // spray event carries an `inventoryLotId` no movement ever explains.
  const quantityBad = inventoryLotId !== '' && quantityUsedNumber === undefined;
  const valid =
    selected !== null &&
    product !== undefined &&
    (!needsOverride || (overriding && overrideReady)) &&
    !quantityBad;

  const clearSaved = () => setSavedProduct(null);

  const resetOverride = () => {
    setOverriding(false);
    setOverrideCategory('');
    setOverrideText('');
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || !selected || !product || saving) return;
    setSaving(true);

    const rateLPerHa = optionalPositiveNumber(rateValue);
    const waterLPerHa = optionalPositiveNumber(waterValue);

    // `by` is never set here — the acting user id is server-resolved from the session, the same
    // reasoning `createdBy` is never client-set anywhere in this app (`RecordHarvestScreen.tsx`'s
    // own module note, one guard over).
    const phiOverride =
      needsOverride && overrideReady
        ? {
            reason: `${t(`crops.spray.overrideReason.${overrideCategory as OverrideReasonCategory}`)}: ${overrideText.trim()}`,
          }
        : undefined;

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
      ...(phiOverride === undefined ? {} : { phiOverride }),
      ...(inventoryLotId === '' ? {} : { inventoryLotId }),
    });

    // A SEPARATE local commit from the spray above — see the module note. `quantityBad` already
    // kept `valid` false unless a picked lot carries a real quantity, so this is safe to read here.
    if (inventoryLotId !== '' && quantityUsedNumber !== undefined) {
      await recordMovement({
        id: uuidv7(),
        farmId: activeFarm.id,
        inventoryLotId,
        occurredAt: sprayedInstant(sprayedOn),
        reason: 'consumed',
        quantity: quantityUsedNumber,
        currentQuantity,
      });
    }

    resetOverride();
    setSavedProduct(product.name);
    setProductId('');
    setRateValue('');
    setWaterValue('');
    setOperator('');
    setEquipment('');
    setWindKph('');
    setTempC('');
    setTargetPest('');
    setInventoryLotId('');
    setQuantityUsed('');
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
                resetOverride();
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
                resetOverride();
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
                resetOverride();
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

          {chemicalLots.length > 0 && (
            <div className="mb-4 flex flex-col">
              <label htmlFor="inventoryLot" className="mb-1 text-label uppercase text-soil-700">
                {t('crops.spray.fromStock')}
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
                <option value="">{t('crops.spray.notTracked')}</option>
                {chemicalLots.map(({ lot, item }) => (
                  <option key={lot.id} value={lot.id}>
                    {item?.name ?? lot.inventoryItemId}
                    {lot.batch ? ` · ${lot.batch}` : ''} — {lot.quantityOnHand} {item?.unit ?? ''}
                  </option>
                ))}
              </select>
              {selectedLot && (
                <div className="mt-2 flex flex-col">
                  <label htmlFor="quantityUsed" className="mb-1 text-label uppercase text-soil-700">
                    {t('crops.spray.quantityUsed')} ({selectedLot.item?.unit ?? ''})
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
                      {t('crops.spray.quantityUsedBad')}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {guard.blocked && (
            <div className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
              <p className="mb-1 font-ui font-semibold">{t('crops.spray.blockedTitle')}</p>
              <p>
                {t('crops.spray.blockedClears')}{' '}
                <span className="font-data tabular-nums">{guard.earliestHarvestDate}</span>.{' '}
                {t('crops.spray.blockedPlanned')}{' '}
                <span className="font-data tabular-nums">{guard.expectedHarvestDate}</span>.
              </p>
              {!overriding ? (
                <button
                  type="button"
                  onClick={() => setOverriding(true)}
                  className="min-h-touch-min mt-2 rounded border border-soil-700 bg-sand-100 px-3 text-body text-soil-900"
                >
                  {t('crops.spray.override')}
                </button>
              ) : (
                <div className="mt-3 flex flex-col gap-2">
                  <label htmlFor="overrideCategory" className="text-label uppercase text-soil-700">
                    {t('crops.spray.overrideReasonLabel')}
                  </label>
                  <select
                    id="overrideCategory"
                    value={overrideCategory}
                    onChange={(e) =>
                      setOverrideCategory(e.target.value as OverrideReasonCategory | '')
                    }
                    className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
                  >
                    <option value="">{t('crops.spray.overrideReasonChoose')}</option>
                    {OVERRIDE_REASON_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {t(`crops.spray.overrideReason.${category}`)}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="overrideText" className="text-label uppercase text-soil-700">
                    {t('crops.spray.overrideTextLabel')}
                  </label>
                  <textarea
                    id="overrideText"
                    value={overrideText}
                    onChange={(e) => setOverrideText(e.target.value)}
                    className="min-h-24 rounded border border-soil-200 bg-sand-100 px-3 py-2 text-body text-soil-900"
                  />
                  <p className="text-label text-soil-700">{t('crops.spray.overrideAudited')}</p>
                </div>
              )}
            </div>
          )}

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
            {guard.blocked && overriding ? t('crops.spray.saveOverride') : t('crops.spray.save')}
          </button>
        </form>
      )}

      <Link to="/land" className="mt-6 inline-block text-body text-dam-700">
        {t('crops.spray.back')}
      </Link>
    </section>
  );
}
