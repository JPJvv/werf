/**
 * Farmer-owned spray log. Werf records what the farmer says was used and performs transparent
 * date arithmetic from the interval they enter. It does not approve a product, decide whether a
 * spray is lawful, or prevent a farmer from recording work that happened.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { schemas, uuidv7 } from '@werf/core';
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
import {
  useRecordInventoryItem,
  useRecordInventoryMovement,
  type StoredInventoryItem,
} from '../inventory/LocalInventory';
import { useRecordSpray } from './LocalSprays';
import { useSprayPhiGuard } from './usePhiGuard';

const NEW_PRODUCT = '__new_product__';

function today(): string {
  return farmToday();
}

function sprayedInstant(day: string): Date {
  return day === today() ? new Date() : new Date(`${day}T12:00:00.000Z`);
}

function optionalPositiveNumber(text: string): number | undefined {
  const value = Number(text.trim());
  return text.trim() !== '' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function optionalFiniteNumber(text: string): number | undefined {
  const value = Number(text.trim());
  return text.trim() !== '' && Number.isFinite(value) ? value : undefined;
}

function optionalNonNegativeNumber(text: string): number | undefined {
  const value = optionalFiniteNumber(text);
  return value !== undefined && value >= 0 ? value : undefined;
}

function optionalNonNegativeInteger(text: string): number | undefined {
  const value = optionalNonNegativeNumber(text);
  return value !== undefined && Number.isInteger(value) ? value : undefined;
}

function ingredientsOf(text: string): readonly string[] | undefined {
  const ingredients = text
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
  return ingredients.length === 0 ? undefined : ingredients;
}

export function RecordSprayScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const units = useEffectiveLandUnits();
  const blocks = useMemo(() => units.filter((unit) => unit.kind === 'block'), [units]);
  const inventoryItems = useEffectiveInventoryItems();
  const products = useMemo(
    () => inventoryItems.filter((item) => item.category === 'chemical'),
    [inventoryItems],
  );
  const inventoryLots = useEffectiveInventoryLots();
  const recordProduct = useRecordInventoryItem();
  const recordMovement = useRecordInventoryMovement();
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
  const [productChoice, setProductChoice] = useState(NEW_PRODUCT);
  const [productName, setProductName] = useState('');
  const [productUnit, setProductUnit] = useState('L');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [activeIngredients, setActiveIngredients] = useState('');
  const [phiDays, setPhiDays] = useState('');
  const [rateValue, setRateValue] = useState('');
  const [waterValue, setWaterValue] = useState('');
  const [operator, setOperator] = useState('');
  const [equipment, setEquipment] = useState('');
  const [windKph, setWindKph] = useState('');
  const [tempC, setTempC] = useState('');
  const [targetPest, setTargetPest] = useState('');
  const [inventoryLotId, setInventoryLotId] = useState('');
  const [quantityUsed, setQuantityUsed] = useState('');
  const [savedProduct, setSavedProduct] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const existingProduct = products.find((product) => product.id === productChoice);
  const isNewProduct = productChoice === NEW_PRODUCT;
  const enteredPhiDays = optionalNonNegativeInteger(phiDays);
  const phiInputBad = phiDays.trim() !== '' && enteredPhiDays === undefined;
  const sprayDayValid = schemas.dateSchema.safeParse(sprayedOn).success;
  const clearDate =
    enteredPhiDays === undefined || !sprayDayValid
      ? null
      : earliestHarvestDateFor(sprayedOn, enteredPhiDays);
  const guard = useSprayPhiGuard(selectedId, sprayedOn, sprayDayValid ? enteredPhiDays : undefined);

  const productLots = useMemo(
    () =>
      productChoice === NEW_PRODUCT
        ? []
        : inventoryLots
            .filter((lot) => lot.inventoryItemId === productChoice)
            .map((lot) => ({
              lot,
              item: inventoryItems.find((item) => item.id === lot.inventoryItemId),
            })),
    [inventoryItems, inventoryLots, productChoice],
  );
  const selectedLot = productLots.find(({ lot }) => lot.id === inventoryLotId);
  const currentQuantity = useCurrentQuantity(inventoryLotId);

  if (!activeFarm) return null;

  const quantityUsedNumber = optionalPositiveNumber(quantityUsed);
  const rateLPerHa = optionalPositiveNumber(rateValue);
  const waterLPerHa = optionalPositiveNumber(waterValue);
  const windKphNumber = optionalNonNegativeNumber(windKph);
  const tempCNumber = optionalFiniteNumber(tempC);
  const optionalNumberBad =
    (rateValue.trim() !== '' && rateLPerHa === undefined) ||
    (waterValue.trim() !== '' && waterLPerHa === undefined) ||
    (windKph.trim() !== '' && windKphNumber === undefined) ||
    (tempC.trim() !== '' && tempCNumber === undefined);
  const quantityBad = inventoryLotId !== '' && quantityUsedNumber === undefined;
  const productReady =
    productName.trim() !== '' && (!isNewProduct || productUnit.trim() !== '') && !phiInputBad;
  const valid =
    selected !== null && sprayDayValid && productReady && !optionalNumberBad && !quantityBad;

  const chooseProduct = (id: string) => {
    setProductChoice(id);
    setInventoryLotId('');
    setQuantityUsed('');
    setSavedProduct(null);
    const product = products.find((candidate) => candidate.id === id);
    if (!product) {
      setProductName('');
      setProductUnit('L');
      setRegistrationNumber('');
      setActiveIngredients('');
      setPhiDays('');
      return;
    }
    setProductName(product.name);
    setProductUnit(product.unit);
    setRegistrationNumber(product.registrationNumber ?? '');
    setActiveIngredients(product.activeIngredients?.join(', ') ?? '');
    setPhiDays(
      product.phiDays === null || product.phiDays === undefined ? '' : String(product.phiDays),
    );
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || !selected || saving) return;
    setSaving(true);

    const productId = existingProduct?.id ?? uuidv7();
    const cleanName = productName.trim();
    const cleanRegistration = registrationNumber.trim();
    const ingredients = ingredientsOf(activeIngredients);

    if (isNewProduct) {
      const product: StoredInventoryItem = {
        id: productId,
        farmId: activeFarm.id,
        enterpriseId: null,
        category: 'chemical',
        name: cleanName,
        unit: productUnit.trim(),
        registrationNumber: cleanRegistration === '' ? null : cleanRegistration,
        activeIngredients: ingredients ?? null,
        phiDays: enteredPhiDays ?? null,
        reentryHours: null,
      };
      await recordProduct(product);
    }

    await recordSpray({
      id: uuidv7(),
      farmId: activeFarm.id,
      landUnitId: selected.id,
      occurredAt: sprayedInstant(sprayedOn).toISOString(),
      sprayedOn,
      productId,
      productName: cleanName,
      ...(cleanRegistration === '' ? {} : { registrationNumber: cleanRegistration }),
      ...(ingredients === undefined ? {} : { activeIngredients: ingredients }),
      ...(enteredPhiDays === undefined ? {} : { phiDays: enteredPhiDays }),
      ...(clearDate === null ? {} : { earliestHarvestDate: clearDate }),
      ...(rateLPerHa === undefined ? {} : { rateLPerHa }),
      ...(waterLPerHa === undefined ? {} : { waterLPerHa }),
      ...(operator.trim() === '' ? {} : { operator: operator.trim() }),
      ...(equipment.trim() === '' ? {} : { equipment: equipment.trim() }),
      ...(windKphNumber === undefined ? {} : { windKph: windKphNumber }),
      ...(tempCNumber === undefined ? {} : { tempC: tempCNumber }),
      ...(targetPest.trim() === '' ? {} : { targetPest: targetPest.trim() }),
      ...(inventoryLotId === '' ? {} : { inventoryLotId }),
    });

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

    setSavedProduct(cleanName);
    setProductChoice(NEW_PRODUCT);
    setProductName('');
    setProductUnit('L');
    setRegistrationNumber('');
    setActiveIngredients('');
    setPhiDays('');
    setInventoryLotId('');
    setQuantityUsed('');
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

  const fieldClass =
    'min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900';
  const numberClass = `${fieldClass} font-data tabular-nums`;

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

      <form onSubmit={save}>
        <div className="mb-4 flex flex-col">
          <label htmlFor="block" className="mb-1 text-label uppercase text-soil-700">
            {t('crops.spray.which')}
          </label>
          <select
            id="block"
            value={selectedId}
            onChange={(event) => setPicked(event.target.value)}
            className={fieldClass}
          >
            {blocks.map((block) => (
              <option key={block.id} value={block.id}>
                {block.code}
                {block.name ? ` — ${block.name}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-4 flex flex-col">
          <label htmlFor="sprayedOn" className="mb-1 text-label uppercase text-soil-700">
            {t('crops.spray.day')}
          </label>
          <input
            id="sprayedOn"
            type="date"
            max={today()}
            value={sprayedOn}
            onChange={(event) => setSprayedOn(event.target.value)}
            className={numberClass}
          />
        </div>

        <fieldset className="mb-4 rounded border border-soil-200 p-3">
          <legend className="px-1 text-label uppercase text-soil-700">
            {t('crops.spray.product')}
          </legend>
          <select
            id="product"
            aria-label={t('crops.spray.product')}
            value={productChoice}
            onChange={(event) => chooseProduct(event.target.value)}
            className={`${fieldClass} mb-3 w-full`}
          >
            <option value={NEW_PRODUCT}>{t('crops.spray.addProduct')}</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col text-label uppercase text-soil-700">
              {t('crops.spray.productName')}
              <input
                id="productName"
                value={productName}
                onChange={(event) => setProductName(event.target.value)}
                className={fieldClass}
              />
            </label>
            {isNewProduct && (
              <label className="flex flex-col text-label uppercase text-soil-700">
                {t('crops.spray.productUnit')}
                <input
                  id="productUnit"
                  value={productUnit}
                  onChange={(event) => setProductUnit(event.target.value)}
                  className={fieldClass}
                />
              </label>
            )}
            <label className="flex flex-col text-label uppercase text-soil-700">
              {t('crops.spray.registration')}
              <input
                id="registrationNumber"
                value={registrationNumber}
                onChange={(event) => setRegistrationNumber(event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col text-label uppercase text-soil-700">
              {t('crops.spray.phiDays')}
              <input
                id="phiDays"
                type="number"
                min="0"
                step="1"
                value={phiDays}
                onChange={(event) => setPhiDays(event.target.value)}
                className={numberClass}
              />
            </label>
          </div>
          <label className="mt-3 flex flex-col text-label uppercase text-soil-700">
            {t('crops.spray.activeIngredients')}
            <input
              id="activeIngredients"
              value={activeIngredients}
              onChange={(event) => setActiveIngredients(event.target.value)}
              className={fieldClass}
            />
          </label>
          <p className="mt-2 text-label text-soil-700">{t('crops.spray.farmerInputNote')}</p>
          {phiInputBad && <p className="mt-2 text-body text-klei-700">{t('crops.spray.phiBad')}</p>}
          {clearDate !== null && (
            <p className="mt-2 border-l-4 border-dam-700 bg-sand-100 p-2 text-body text-soil-900">
              {t('crops.spray.harvestFrom')}{' '}
              <span className="font-data tabular-nums">{clearDate}</span>
            </p>
          )}
        </fieldset>

        {guard.blocked && (
          <div className="mb-4 border-l-4 border-ochre-500 bg-sand-100 p-3 text-body text-soil-900">
            <p className="font-ui font-semibold">{t('crops.spray.planningWarning')}</p>
            <p>
              {t('crops.spray.blockedClears')}{' '}
              <span className="font-data tabular-nums">{guard.earliestHarvestDate}</span>.{' '}
              {t('crops.spray.blockedPlanned')}{' '}
              <span className="font-data tabular-nums">{guard.expectedHarvestDate}</span>.{' '}
              {t('crops.spray.warningDoesNotBlock')}
            </p>
          </div>
        )}

        {productLots.length > 0 && (
          <div className="mb-4 flex flex-col">
            <label htmlFor="inventoryLot" className="mb-1 text-label uppercase text-soil-700">
              {t('crops.spray.fromStock')}
            </label>
            <select
              id="inventoryLot"
              value={inventoryLotId}
              onChange={(event) => {
                setInventoryLotId(event.target.value);
                setQuantityUsed('');
              }}
              className={fieldClass}
            >
              <option value="">{t('crops.spray.notTracked')}</option>
              {productLots.map(({ lot, item }) => (
                <option key={lot.id} value={lot.id}>
                  {item?.name ?? lot.inventoryItemId}
                  {lot.batch ? ` · ${lot.batch}` : ''} — {lot.quantityOnHand} {item?.unit ?? ''}
                </option>
              ))}
            </select>
            {selectedLot && (
              <label className="mt-2 flex flex-col text-label uppercase text-soil-700">
                {t('crops.spray.quantityUsed')} ({selectedLot.item?.unit ?? ''})
                <input
                  id="quantityUsed"
                  type="number"
                  min="0"
                  step="any"
                  value={quantityUsed}
                  onChange={(event) => setQuantityUsed(event.target.value)}
                  className={numberClass}
                />
              </label>
            )}
            {quantityBad && (
              <p className="mt-2 text-body text-klei-700">{t('crops.spray.quantityUsedBad')}</p>
            )}
          </div>
        )}

        <fieldset className="mb-4 rounded border border-soil-200 p-3">
          <legend className="px-1 text-label uppercase text-soil-700">
            {t('crops.spray.optionalDetails')}
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col text-label uppercase text-soil-700">
              {t('crops.spray.rate')}
              <input
                id="rateValue"
                type="number"
                min="0"
                step="any"
                value={rateValue}
                onChange={(event) => setRateValue(event.target.value)}
                className={numberClass}
              />
            </label>
            <label className="flex flex-col text-label uppercase text-soil-700">
              {t('crops.spray.water')}
              <input
                id="waterValue"
                type="number"
                min="0"
                step="any"
                value={waterValue}
                onChange={(event) => setWaterValue(event.target.value)}
                className={numberClass}
              />
            </label>
            <label className="flex flex-col text-label uppercase text-soil-700">
              {t('crops.spray.operator')}
              <input
                id="operator"
                value={operator}
                onChange={(event) => setOperator(event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col text-label uppercase text-soil-700">
              {t('crops.spray.equipment')}
              <input
                id="equipment"
                value={equipment}
                onChange={(event) => setEquipment(event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col text-label uppercase text-soil-700">
              {t('crops.spray.wind')}
              <input
                id="windKph"
                type="number"
                min="0"
                step="any"
                value={windKph}
                onChange={(event) => setWindKph(event.target.value)}
                className={numberClass}
              />
            </label>
            <label className="flex flex-col text-label uppercase text-soil-700">
              {t('crops.spray.temp')}
              <input
                id="tempC"
                type="number"
                step="any"
                value={tempC}
                onChange={(event) => setTempC(event.target.value)}
                className={numberClass}
              />
            </label>
          </div>
          <label className="mt-3 flex flex-col text-label uppercase text-soil-700">
            {t('crops.spray.targetPest')}
            <input
              id="targetPest"
              value={targetPest}
              onChange={(event) => setTargetPest(event.target.value)}
              className={fieldClass}
            />
          </label>
          {optionalNumberBad && (
            <p className="mt-2 text-body text-klei-700">{t('crops.spray.numberBad')}</p>
          )}
        </fieldset>

        <button
          type="submit"
          disabled={!valid || saving}
          className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
        >
          {t('crops.spray.save')}
        </button>
      </form>
      <Link to="/land" className="mt-6 inline-block text-body text-dam-700">
        {t('crops.spray.back')}
      </Link>
    </section>
  );
}
