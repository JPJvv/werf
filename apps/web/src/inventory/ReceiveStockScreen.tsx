/**
 * Receive stock (Phase 4e, FR-501) — a delivery of chemical, fertiliser, feed or medicine landing
 * in the shed. One form, three local appends: the item (created only if this is the first time
 * this device has seen it, matched by name), a fresh empty lot, and the `received` movement that
 * fills it. All three land LOCALLY and instantly with no network in `save`
 * (.claude/rules/frontend.md, NFR-007) — the same discipline `RecordFertiliserScreen` follows.
 *
 * There is no "starting quantity" field on a lot (`LocalInventory.tsx`'s module note): a lot is
 * always created empty and received into, so the very first receipt of a NEW item still goes
 * through the identical `received` movement path a top-up of an existing one does.
 */

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  INVENTORY_ITEM_CATEGORIES,
  parseRandsToCents,
  uuidv7,
  type InventoryItemCategory,
} from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { useAuth } from '../auth/AuthProvider';
import { farmToday } from '../farmTime';
import { useEffectiveInventoryItems } from './stock';
import {
  useRecordInventoryItem,
  useRecordInventoryLot,
  useRecordInventoryMovement,
} from './LocalInventory';

function today(): string {
  return farmToday();
}

/** The instant a day's receipt happened — NOW for today, midday UTC for an earlier day, the same
 *  construction `RecordFertiliserScreen` uses and for the identical reason. */
function receivedInstant(day: string): Date {
  return day === today() ? new Date() : new Date(`${day}T12:00:00.000Z`);
}

function optionalPositiveNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function ReceiveStockScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const items = useEffectiveInventoryItems();
  const recordItem = useRecordInventoryItem();
  const recordLot = useRecordInventoryLot();
  const recordMovement = useRecordInventoryMovement();

  const [itemName, setItemName] = useState('');
  const [category, setCategory] = useState<InventoryItemCategory>('fertiliser');
  const [unit, setUnit] = useState('');
  const [batch, setBatch] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [location, setLocation] = useState('');
  const [quantity, setQuantity] = useState('');
  const [costRands, setCostRands] = useState('');
  const [day, setDay] = useState(today);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!activeFarm) return null;

  const existing = items.find(
    (item) => item.name.trim().toLowerCase() === itemName.trim().toLowerCase(),
  );
  const quantityNumber = optionalPositiveNumber(quantity);
  const costBad = costRands.trim() !== '' && parseRandsToCents(costRands) === null;
  const valid =
    itemName.trim() !== '' &&
    (existing !== undefined || unit.trim() !== '') &&
    quantityNumber !== undefined &&
    !costBad;

  const clearSaved = () => setSaved(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || quantityNumber === undefined || saving) return;
    setSaving(true);

    const itemId = existing?.id ?? uuidv7();
    if (existing === undefined) {
      await recordItem({
        id: itemId,
        farmId: activeFarm.id,
        enterpriseId: null,
        category,
        name: itemName.trim(),
        unit: unit.trim(),
      });
    }

    const lotId = uuidv7();
    await recordLot({
      id: lotId,
      farmId: activeFarm.id,
      inventoryItemId: itemId,
      batch: batch.trim() === '' ? null : batch.trim(),
      expiryDate: expiryDate === '' ? null : expiryDate,
      location: location.trim() === '' ? null : location.trim(),
    });

    const costCents = costRands.trim() === '' ? null : parseRandsToCents(costRands);
    await recordMovement({
      id: uuidv7(),
      farmId: activeFarm.id,
      inventoryLotId: lotId,
      occurredAt: receivedInstant(day),
      reason: 'received',
      quantity: quantityNumber,
      // A brand new lot: nothing has ever been received into it before this.
      currentQuantity: 0,
      ...(costCents === null ? {} : { unitCostCents: costCents }),
    });

    setSaved(itemName.trim());
    setItemName('');
    setUnit('');
    setBatch('');
    setExpiryDate('');
    setLocation('');
    setQuantity('');
    setCostRands('');
    setSaving(false);
  };

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('inventory.receive.title')}</h1>

      {saved !== null && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {saved} {t('inventory.receive.saved')}
        </p>
      )}

      <form onSubmit={save}>
        <div className="mb-4 flex flex-col">
          <label htmlFor="itemName" className="mb-1 text-label uppercase text-soil-700">
            {t('inventory.receive.item')}
          </label>
          <input
            id="itemName"
            name="itemName"
            type="text"
            list="inventory-items"
            value={itemName}
            onChange={(e) => {
              clearSaved();
              setItemName(e.target.value);
            }}
            className="min-h-touch-primary rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
          />
          <datalist id="inventory-items">
            {items.map((item) => (
              <option key={item.id} value={item.name} />
            ))}
          </datalist>
        </div>

        {existing === undefined && itemName.trim() !== '' && (
          <>
            <fieldset className="mb-4 border-0 p-0">
              <legend className="mb-1 text-label uppercase text-soil-700">
                {t('inventory.receive.category')}
              </legend>
              <div className="flex flex-wrap gap-2">
                {INVENTORY_ITEM_CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={category === c}
                    onClick={() => {
                      clearSaved();
                      setCategory(c);
                    }}
                    className={`min-h-touch-min flex-1 rounded border px-2 font-ui text-body ${
                      category === c
                        ? 'border-soil-900 bg-sand-100 text-soil-900'
                        : 'border-soil-200 bg-sand-50 text-soil-900'
                    }`}
                  >
                    {t(`inventory.category.${c}` as TranslationKey)}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="mb-4 flex flex-col">
              <label htmlFor="unit" className="mb-1 text-label uppercase text-soil-700">
                {t('inventory.receive.unit')}
              </label>
              <input
                id="unit"
                name="unit"
                type="text"
                placeholder={t('inventory.receive.unitExample')}
                value={unit}
                onChange={(e) => {
                  clearSaved();
                  setUnit(e.target.value);
                }}
                className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
              />
            </div>
          </>
        )}

        <div className="mb-4 flex gap-2">
          <div className="flex flex-1 flex-col">
            <label htmlFor="batch" className="mb-1 text-label uppercase text-soil-700">
              {t('inventory.receive.batch')}
            </label>
            <input
              id="batch"
              name="batch"
              type="text"
              value={batch}
              onChange={(e) => {
                clearSaved();
                setBatch(e.target.value);
              }}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
            />
          </div>
          <div className="flex flex-1 flex-col">
            <label htmlFor="expiryDate" className="mb-1 text-label uppercase text-soil-700">
              {t('inventory.receive.expiry')}
            </label>
            <input
              id="expiryDate"
              name="expiryDate"
              type="date"
              value={expiryDate}
              onChange={(e) => {
                clearSaved();
                setExpiryDate(e.target.value);
              }}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data tabular-nums text-body text-soil-900"
            />
          </div>
        </div>

        <div className="mb-4 flex flex-col">
          <label htmlFor="location" className="mb-1 text-label uppercase text-soil-700">
            {t('inventory.receive.location')}
          </label>
          <input
            id="location"
            name="location"
            type="text"
            value={location}
            onChange={(e) => {
              clearSaved();
              setLocation(e.target.value);
            }}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
          />
        </div>

        <div className="mb-4 flex gap-2">
          <div className="flex flex-1 flex-col">
            <label htmlFor="quantity" className="mb-1 text-label uppercase text-soil-700">
              {t('inventory.receive.quantity')}
              {existing !== undefined
                ? ` (${existing.unit})`
                : unit.trim() !== ''
                  ? ` (${unit.trim()})`
                  : ''}
            </label>
            <input
              id="quantity"
              name="quantity"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={quantity}
              onChange={(e) => {
                clearSaved();
                setQuantity(e.target.value);
              }}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data tabular-nums text-body text-soil-900"
            />
          </div>
          <div className="flex flex-1 flex-col">
            <label htmlFor="cost" className="mb-1 text-label uppercase text-soil-700">
              {t('inventory.receive.cost')}
            </label>
            <input
              id="cost"
              name="cost"
              type="text"
              inputMode="decimal"
              value={costRands}
              onChange={(e) => {
                clearSaved();
                setCostRands(e.target.value);
              }}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data tabular-nums text-body text-soil-900"
            />
          </div>
        </div>
        {costBad && (
          <p className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
            {t('inventory.receive.costBad')}
          </p>
        )}

        <div className="mb-6 flex flex-col">
          <label htmlFor="day" className="mb-1 text-label uppercase text-soil-700">
            {t('inventory.receive.day')}
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
          {t('inventory.receive.save')}
        </button>
      </form>

      <Link to="/inventory" className="mt-6 inline-block text-body text-dam-700">
        {t('inventory.receive.back')}
      </Link>
    </section>
  );
}
