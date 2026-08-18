/**
 * Stock on hand (Phase 4e, FR-501) — every lot this device knows about, each carrying the quantity
 * PROJECTED from the movement log (`useEffectiveInventoryLots`, `stock.ts`) rather than a field the
 * app edits, the identical relationship the land list draws to `mobs.head_count` (FR-705). Read
 * entirely from the local + hydrated registers, so it renders in full in a signal dead zone.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { InventoryItemCategory } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import {
  useEffectiveInventoryItems,
  useEffectiveInventoryLots,
  type EffectiveInventoryLot,
} from './stock';

export function StockScreen() {
  const { t } = useTranslation();
  const items = useEffectiveInventoryItems();
  const lots = useEffectiveInventoryLots();

  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  // Newest-created lot first, by UUIDv7's embedded clock — the one a farmer who just receipted a
  // delivery wants to confirm landed. This is display order only, NOT the (occurredAt, id) total
  // order `projectQuantityOnHand` folds by — do not read the two as the same ordering.
  const ordered = useMemo(
    () => [...lots].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)),
    [lots],
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

      {ordered.length === 0 ? (
        <p className="text-body text-soil-700">{t('inventory.empty')}</p>
      ) : (
        <ul className="flex list-none flex-col gap-2 p-0">
          {ordered.map((lot) => (
            <LotRow
              key={lot.id}
              lot={lot}
              itemName={itemsById.get(lot.inventoryItemId)?.name}
              unit={itemsById.get(lot.inventoryItemId)?.unit}
              category={itemsById.get(lot.inventoryItemId)?.category}
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

function LotRow({
  lot,
  itemName,
  unit,
  category,
}: {
  lot: EffectiveInventoryLot;
  itemName: string | undefined;
  unit: string | undefined;
  category: InventoryItemCategory | undefined;
}) {
  const { t } = useTranslation();

  return (
    <li className="flex flex-col gap-1 rounded border border-soil-200 bg-sand-100 p-3">
      <div className="flex items-center justify-between">
        <span className="text-body text-soil-900">
          {/* An item this device has not (yet) heard of reads as its bare id rather than nothing —
              honest about the gap, never a blank that looks like a bug. */}
          {itemName ?? lot.inventoryItemId}
        </span>
        <span className="font-data tabular-nums text-body text-soil-900">
          {lot.quantityOnHand} {unit ?? ''}
        </span>
      </div>
      <p className="text-body text-soil-700">
        {[
          lot.batch === null ? null : `${t('inventory.batch')} ${lot.batch}`,
          lot.expiryDate === null ? null : `${t('inventory.expiry')} ${lot.expiryDate}`,
          lot.location === null ? null : lot.location,
          category === undefined ? null : t(`inventory.category.${category}` as TranslationKey),
        ]
          .filter((part): part is string => part !== null)
          .join(' · ')}
      </p>
    </li>
  );
}
