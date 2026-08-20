/**
 * Stock on hand (Phase 4e, FR-501) — every item this device knows about, each carrying the
 * quantity PROJECTED from the movement log (`useEffectiveInventoryLots`, `stock.ts`) rather than a
 * field the app edits, the identical relationship the land list draws to `mobs.head_count`
 * (FR-705). Read entirely from the local + hydrated registers, so it renders in full in a signal
 * dead zone.
 *
 * ⭐ Grouped by ITEM, not a flat lot list — FR-503's low-stock warning (4e·5) is inherently an
 * item-level question ("is our urea running low?"), never a per-lot one: one nearly-empty batch
 * while two full ones sit beside it is normal, not a warning. Grouping here is also where the
 * reorder-point editor lives, so it is reachable for every item a device has ever received,
 * whichever one first shows the warning.
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { InventoryItemCategory } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { useAuth } from '../auth/AuthProvider';
import { useSyncStatus } from '../sync/useSyncStatus';
import { farmToday } from '../farmTime';
import {
  useEffectiveInventoryItems,
  useEffectiveInventoryLots,
  useSetReorderPoint,
  lowStockWarnings,
  isExpired,
  type EffectiveInventoryLot,
} from './stock';
import type { StoredInventoryItem } from './LocalInventory';

export function StockScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const items = useEffectiveInventoryItems();
  const lots = useEffectiveInventoryLots();
  const online = useSyncStatus().status !== 'offline';
  const saveReorderPoint = useSetReorderPoint();
  const canManage = activeFarm?.role === 'owner' || activeFarm?.role === 'manager';
  const today = farmToday();

  const lotsByItem = useMemo(() => {
    const map = new Map<string, EffectiveInventoryLot[]>();
    for (const lot of lots) {
      const list = map.get(lot.inventoryItemId);
      if (list) list.push(lot);
      else map.set(lot.inventoryItemId, [lot]);
    }
    return map;
  }, [lots]);

  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const lowStock = useMemo(() => lowStockWarnings(items, lots), [items, lots]);
  const lowStockById = useMemo(
    () => new Map(lowStock.map((warning) => [warning.inventoryItemId, warning])),
    [lowStock],
  );

  // Newest item first, by UUIDv7's embedded clock. Only items with at least one lot: an item is
  // never created except alongside its first receipt (`ReceiveStockScreen.tsx`), so this excludes
  // nothing a farmer could otherwise see — it only guards a merge race where this device has heard
  // of the item but not yet its lot.
  const orderedItems = useMemo(
    () =>
      items
        .filter((item) => (lotsByItem.get(item.id)?.length ?? 0) > 0)
        .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)),
    [items, lotsByItem],
  );

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="font-ui text-h1 text-soil-900">{t('inventory.title')}</h1>
        <p className="font-data text-data-lg tabular-nums text-soil-900">{lots.length}</p>
      </div>

      <Link
        to="/inventory/receive"
        className="mb-4 flex min-h-touch-primary items-center justify-center rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action no-underline"
      >
        {t('inventory.receive.action')}
      </Link>

      {lowStock.length > 0 && (
        <section className="mb-6" aria-labelledby="low-stock-title">
          <h2 id="low-stock-title" className="mb-2 font-ui text-h2 text-soil-900">
            {t('inventory.lowStock.sectionTitle')}
          </h2>
          <ul className="flex list-none flex-col gap-2 p-0">
            {lowStock.map((warning) => {
              const item = itemsById.get(warning.inventoryItemId);
              return (
                <li
                  key={warning.inventoryItemId}
                  className="border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900"
                >
                  <span className="font-semibold">{item?.name ?? warning.inventoryItemId}</span>
                  {' — '}
                  <span className="font-data tabular-nums">{warning.quantityOnHand}</span>{' '}
                  {item?.unit ?? ''} {t('inventory.lowStock.below')}{' '}
                  <span className="font-data tabular-nums">{warning.reorderPoint}</span>{' '}
                  {item?.unit ?? ''}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {orderedItems.length === 0 ? (
        <p className="text-body text-soil-700">{t('inventory.empty')}</p>
      ) : (
        <ul className="flex list-none flex-col gap-4 p-0">
          {orderedItems.map((item) => (
            <ItemGroup
              key={item.id}
              item={item}
              lots={lotsByItem.get(item.id) ?? []}
              today={today}
              low={lowStockById.get(item.id)}
              canManage={canManage}
              online={online}
              onSaveReorderPoint={saveReorderPoint}
            />
          ))}
        </ul>
      )}

      <Link to="/" className="mt-6 inline-block text-body text-dam-700">
        {t('home.back')}
      </Link>
    </section>
  );
}

function ItemGroup({
  item,
  lots,
  today,
  low,
  canManage,
  online,
  onSaveReorderPoint,
}: {
  item: StoredInventoryItem;
  lots: readonly EffectiveInventoryLot[];
  today: string;
  low: { readonly quantityOnHand: number; readonly reorderPoint: number } | undefined;
  canManage: boolean;
  online: boolean;
  onSaveReorderPoint: (itemId: string, reorderPoint: number | null) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const total = lots.reduce((sum, lot) => sum + lot.quantityOnHand, 0);

  return (
    <li className="rounded border border-soil-200 bg-sand-100 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-body font-semibold text-soil-900">{item.name}</span>
        <span className="font-data tabular-nums text-body text-soil-900">
          {total} {item.unit}
        </span>
      </div>

      {low !== undefined && (
        <p className="mb-2 border-l-4 border-klei-700 bg-klei-100 p-2 text-body text-soil-900">
          {t('inventory.lowStock.itemWarning')}
        </p>
      )}

      <ReorderPointRow
        itemId={item.id}
        unit={item.unit}
        reorderPoint={item.reorderPoint ?? null}
        canManage={canManage}
        online={online}
        onSave={onSaveReorderPoint}
      />

      <ul className="mt-2 flex list-none flex-col gap-2 p-0">
        {lots.map((lot) => (
          <LotRow key={lot.id} lot={lot} unit={item.unit} category={item.category} today={today} />
        ))}
      </ul>
    </li>
  );
}

function ReorderPointRow({
  itemId,
  unit,
  reorderPoint,
  canManage,
  online,
  onSave,
}: {
  itemId: string;
  unit: string;
  reorderPoint: number | null;
  canManage: boolean;
  online: boolean;
  onSave: (itemId: string, reorderPoint: number | null) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(() => reorderPoint?.toString() ?? '');
  const [working, setWorking] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);

  // Re-seed whenever the COMMITTED value changes — `GrazingSettings.tsx`'s identical fix for the
  // identical bug: the hydrated echo of THIS item's own reorder point can land well after first
  // render (another device, or this save itself round-tripping), and `useState`'s initialiser only
  // ever runs once.
  useEffect(() => {
    setValue(reorderPoint?.toString() ?? '');
  }, [reorderPoint]);

  if (!canManage) {
    return (
      <p className="text-body text-soil-700">
        {t('inventory.reorderPoint.label')}{' '}
        {reorderPoint === null ? (
          t('inventory.reorderPoint.unset')
        ) : (
          <>
            <span className="font-data tabular-nums">{reorderPoint}</span> {unit}
          </>
        )}
      </p>
    );
  }

  const trimmed = value.trim();
  const parsed = trimmed === '' ? null : Number(trimmed);
  const valid = parsed === null || (Number.isFinite(parsed) && parsed > 0);
  const blocked = !online || working || !valid;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (blocked) return;
    setWorking(true);
    setSaved(false);
    setFailed(false);
    const ok = await onSave(itemId, parsed);
    setWorking(false);
    if (ok) setSaved(true);
    else setFailed(true);
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-center gap-2">
      <label htmlFor={`reorder-point-${itemId}`} className="text-label uppercase text-soil-700">
        {t('inventory.reorderPoint.label')}
      </label>
      <input
        id={`reorder-point-${itemId}`}
        type="number"
        inputMode="decimal"
        min={0.01}
        step="any"
        value={value}
        onChange={(e) => {
          setSaved(false);
          setFailed(false);
          setValue(e.target.value);
        }}
        className="min-h-touch-min w-24 rounded border border-soil-200 bg-sand-50 px-2 font-data text-body tabular-nums text-soil-900"
      />
      <span className="text-body text-soil-700">{unit}</span>
      <button
        type="submit"
        disabled={blocked}
        className="min-h-touch-min rounded border border-dam-700 px-3 text-body text-dam-700 disabled:opacity-60"
      >
        {working ? t('onboarding.working') : t('inventory.reorderPoint.save')}
      </button>
      {saved && (
        <span role="status" className="text-body text-soil-700">
          {t('inventory.reorderPoint.saved')}
        </span>
      )}
      {failed && (
        <span className="text-body text-soil-700">{t('inventory.reorderPoint.failed')}</span>
      )}
      {!online && (
        <span className="text-body text-soil-700">{t('inventory.reorderPoint.needsSignal')}</span>
      )}
    </form>
  );
}

function LotRow({
  lot,
  unit,
  category,
  today,
}: {
  lot: EffectiveInventoryLot;
  unit: string;
  category: InventoryItemCategory;
  today: string;
}) {
  const { t } = useTranslation();
  const expired = isExpired(lot, today);

  return (
    <li className="flex flex-col gap-1 rounded border border-soil-200 bg-sand-50 p-2">
      <div className="flex items-center justify-between">
        <span className="font-data tabular-nums text-body text-soil-900">
          {lot.quantityOnHand} {unit}
        </span>
        <span className="text-body text-soil-700">
          {t(`inventory.category.${category}` as TranslationKey)}
        </span>
      </div>
      <p className="text-body text-soil-700">
        {[
          lot.batch === null ? null : `${t('inventory.batch')} ${lot.batch}`,
          lot.expiryDate === null ? null : `${t('inventory.expiry')} ${lot.expiryDate}`,
          lot.location === null ? null : lot.location,
        ]
          .filter((part): part is string => part !== null)
          .join(' · ')}
      </p>
      {expired && (
        <p className="border-l-4 border-klei-700 bg-klei-100 p-2 text-body text-soil-900">
          {t('inventory.expired.warning')}
        </p>
      )}
    </li>
  );
}
