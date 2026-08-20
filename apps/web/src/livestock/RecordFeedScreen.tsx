/**
 * Record a feed-out (Phase 4e, FR-153) — how much of a tracked feed lot went to a mob or a camp.
 * "Per camp/group" is a genuine choice, not a pair of optional fields: picking a group clears any
 * camp picked, and picking a camp clears any group picked — the same toggle shape
 * `RecordHealthScreen.tsx` uses for its own animal/mob choice, one dimension over.
 *
 * ⭐ A GROUP'S CAMP IS NEVER TYPED — it is shown, read-only, from this device's own current
 * projection (`mob.landUnitId`, the same field `MoveMobScreen.tsx` displays). The server derives
 * the authoritative camp from the mob's own row at write time (`livestock.service.ts`), so nothing
 * here needs to send one; a camp-only feed-out (no group) is the only case that sends a camp
 * directly, and it is the only case that needs an ENTERPRISE too — with no mob to derive one from,
 * FR-113's herd-scoping guard needs the farmer's own herd named (single-herd farms skip the
 * picker: a question with one answer is furniture, not a decision — `AddMobScreen.tsx`'s own rule).
 *
 * ⭐ THE COST SHOWN IS AN ESTIMATE, NEVER TYPED. "Cost to enterprise" (FR-153) is the linked lot's
 * own weighted-average RECEIVED cost × the quantity fed (`useEstimatedUnitCostCents`,
 * `../inventory/stock.ts`) — a number two devices feeding from the same lot derive identically,
 * never a farmer-typed figure that could disagree between them. Absent, silently, when the lot has
 * never been received with a cost attached — an honest gap, not a guessed zero.
 *
 * Inventory auto-decrement mirrors 4e·4's spray/fertiliser shape exactly: TWO independent local
 * commits, not one atomic write. If the feed event is later refused server-side, the movement
 * still lands — the feed genuinely left the shed regardless of whether the event was accepted.
 *
 * Offline-first: `save` commits locally and instantly with no network in the path (NFR-007).
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { enterpriseSpecies, formatZAR, money, uuidv7 } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import { useAuth } from '../auth/AuthProvider';
import { farmToday } from '../farmTime';
import { useEffectiveLandUnits } from '../land/LocalLand';
import {
  useEffectiveInventoryItems,
  useEffectiveInventoryLots,
  useCurrentQuantity,
  useEstimatedUnitCostCents,
} from '../inventory/stock';
import { useRecordInventoryMovement } from '../inventory/LocalInventory';
import { useEffectiveMobs } from './herd';
import { useRecordFeed } from './LocalFeed';

function today(): string {
  return farmToday();
}

function fedInstant(day: string): Date {
  return day === today() ? new Date() : new Date(`${day}T12:00:00.000Z`);
}

function optionalPositiveNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function RecordFeedScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const mobs = useEffectiveMobs();
  const landUnits = useEffectiveLandUnits();
  const campNames = useMemo(() => new Map(landUnits.map((u) => [u.id, u.code])), [landUnits]);
  const recordFeed = useRecordFeed();
  const recordMovement = useRecordInventoryMovement();
  const inventoryItems = useEffectiveInventoryItems();
  const inventoryLots = useEffectiveInventoryLots();

  const herds = useMemo(
    () => (activeFarm?.enterprises ?? []).filter((e) => enterpriseSpecies(e.type) !== null),
    [activeFarm],
  );

  const [mobId, setMobId] = useState<string | null>(null);
  const [landUnitId, setLandUnitId] = useState('');
  const [enterpriseId, setEnterpriseId] = useState('');
  const [inventoryLotId, setInventoryLotId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [day, setDay] = useState(today);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const feedLots = useMemo(
    () =>
      inventoryLots
        .filter(
          (lot) => inventoryItems.find((i) => i.id === lot.inventoryItemId)?.category === 'feed',
        )
        .map((lot) => ({ lot, item: inventoryItems.find((i) => i.id === lot.inventoryItemId) })),
    [inventoryLots, inventoryItems],
  );
  const selectedLot = feedLots.find((f) => f.lot.id === inventoryLotId);

  // Called unconditionally, before the `!activeFarm` early return (Rules of Hooks) — the same
  // ordering `RecordSprayScreen.tsx`'s own guard reads obey.
  const currentQuantity = useCurrentQuantity(inventoryLotId);
  const unitCostCents = useEstimatedUnitCostCents(inventoryLotId);

  if (!activeFarm) return null;

  const pickMob = (id: string) => {
    setSaved(null);
    setMobId((held) => (held === id ? null : id));
    setLandUnitId('');
    setEnterpriseId('');
  };

  const pickCamp = (id: string) => {
    setSaved(null);
    setLandUnitId(id);
    setMobId(null);
    if (herds.length === 1) setEnterpriseId(herds[0]!.id);
  };

  const selectedMob = mobs.find((m) => m.id === mobId) ?? null;
  const quantityNumber = optionalPositiveNumber(quantity);
  const campMode = mobId === null && landUnitId !== '';
  // A camp-only feed-out has no mob to derive a herd from (see the module note), so it needs one
  // named here — a farm with no livestock enterprise at all has nothing to attribute it to, and
  // this is never "ready" on such a farm rather than silently sending a null that FR-113's guard
  // would refuse at flush time anyway.
  const enterpriseReady = herds.length === 1 || (herds.length > 1 && enterpriseId !== '');
  const targeted = selectedMob !== null || (campMode && enterpriseReady);
  const valid = targeted && inventoryLotId !== '' && quantityNumber !== undefined;

  const estimatedCostCents =
    unitCostCents === undefined || quantityNumber === undefined
      ? undefined
      : Math.round(unitCostCents * quantityNumber);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || quantityNumber === undefined || saving) return;
    setSaving(true);

    const resolvedEnterpriseId = herds.length === 1 ? herds[0]!.id : enterpriseId;

    await recordFeed({
      id: uuidv7(),
      farmId: activeFarm.id,
      occurredAt: fedInstant(day).toISOString(),
      mobId,
      inventoryLotId,
      quantity: quantityNumber,
      ...(selectedMob === null
        ? { landUnitId, enterpriseId: resolvedEnterpriseId === '' ? null : resolvedEnterpriseId }
        : {}),
    });

    // A SEPARATE local commit from the feed event above — see the module note.
    await recordMovement({
      id: uuidv7(),
      farmId: activeFarm.id,
      inventoryLotId,
      occurredAt: fedInstant(day),
      reason: 'consumed',
      quantity: quantityNumber,
      currentQuantity,
    });

    setSaved(selectedMob?.name ?? campNames.get(landUnitId) ?? null);
    setMobId(null);
    setLandUnitId('');
    setEnterpriseId('');
    setInventoryLotId('');
    setQuantity('');
    setSaving(false);
  };

  if (mobs.length === 0 && landUnits.length === 0) {
    return (
      <section className="mx-auto w-full max-w-3xl p-4">
        <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('feed.title')}</h1>
        <p className="mb-4 text-body text-soil-700">{t('feed.empty')}</p>
        <Link to="/animals" className="text-body text-dam-700">
          {t('feed.back')}
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('feed.title')}</h1>

      {saved !== null && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {saved} {t('feed.saved')}
        </p>
      )}

      {feedLots.length === 0 ? (
        <>
          <p className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
            {t('feed.noLots')}
          </p>
          <Link to="/inventory/receive" className="text-body text-dam-700">
            {t('feed.receiveStock')}
          </Link>
        </>
      ) : (
        <form onSubmit={save}>
          {mobs.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-label uppercase text-soil-700">{t('feed.which')}</p>
              <ul className="flex list-none flex-col gap-2 p-0">
                {mobs.map((mob) => {
                  const isSelected = mob.id === mobId;
                  return (
                    <li key={mob.id}>
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => pickMob(mob.id)}
                        className={`flex min-h-touch-min w-full items-center justify-between rounded border p-3 text-left text-body ${
                          isSelected
                            ? 'border-soil-900 bg-sand-100 text-soil-900'
                            : 'border-soil-200 bg-sand-50 text-soil-900'
                        }`}
                      >
                        <span>{mob.name}</span>
                        <span className="text-soil-700">
                          {mob.landUnitId === null
                            ? t('move.unplaced')
                            : (campNames.get(mob.landUnitId) ?? t('move.unplaced'))}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {landUnits.length > 0 && (
            <div className="mb-4 flex flex-col">
              <label htmlFor="feed-camp" className="mb-1 text-label uppercase text-soil-700">
                {t('feed.orCamp')}
              </label>
              <select
                id="feed-camp"
                value={landUnitId}
                onChange={(e) =>
                  e.target.value === '' ? setLandUnitId('') : pickCamp(e.target.value)
                }
                className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
              >
                <option value="">{t('feed.pickCamp')}</option>
                {landUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.code}
                    {unit.name ? ` — ${unit.name}` : ''}
                  </option>
                ))}
              </select>

              {campMode && herds.length > 1 && (
                <div className="mt-2 flex flex-col">
                  <label htmlFor="feed-herd" className="mb-1 text-label uppercase text-soil-700">
                    {t('feed.herd')}
                  </label>
                  <select
                    id="feed-herd"
                    value={enterpriseId}
                    onChange={(e) => setEnterpriseId(e.target.value)}
                    className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
                  >
                    <option value="">{t('feed.pickHerd')}</option>
                    {herds.map((herd) => (
                      <option key={herd.id} value={herd.id}>
                        {herd.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          <div className="mb-4 flex flex-col">
            <label htmlFor="feed-lot" className="mb-1 text-label uppercase text-soil-700">
              {t('feed.lot')}
            </label>
            <select
              id="feed-lot"
              value={inventoryLotId}
              onChange={(e) => {
                setSaved(null);
                setInventoryLotId(e.target.value);
              }}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
            >
              <option value="">{t('feed.pickLot')}</option>
              {feedLots.map(({ lot, item }) => (
                <option key={lot.id} value={lot.id}>
                  {item?.name ?? lot.inventoryItemId}
                  {lot.batch ? ` · ${lot.batch}` : ''} — {lot.quantityOnHand} {item?.unit ?? ''}
                </option>
              ))}
            </select>
          </div>

          {selectedLot && (
            <div className="mb-4 flex flex-col">
              <label htmlFor="feed-quantity" className="mb-1 text-label uppercase text-soil-700">
                {t('feed.quantity')} ({selectedLot.item?.unit ?? ''})
              </label>
              <input
                id="feed-quantity"
                name="feed-quantity"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={quantity}
                onChange={(e) => {
                  setSaved(null);
                  setQuantity(e.target.value);
                }}
                className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data tabular-nums text-body text-soil-900"
              />
              {estimatedCostCents !== undefined && (
                <p className="mt-1 border-l-4 border-dam-700 bg-sand-100 p-2 text-body text-soil-900">
                  {t('feed.costEstimate')}{' '}
                  <span className="font-data tabular-nums">
                    {formatZAR(money(estimatedCostCents))}
                  </span>
                </p>
              )}
            </div>
          )}

          <div className="mb-6 flex flex-col">
            <label htmlFor="feed-day" className="mb-1 text-label uppercase text-soil-700">
              {t('feed.day')}
            </label>
            <input
              id="feed-day"
              name="feed-day"
              type="date"
              max={today()}
              value={day}
              onChange={(e) => {
                setSaved(null);
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
            {t('feed.save')}
          </button>
        </form>
      )}

      <Link to="/animals" className="mt-6 inline-block text-body text-dam-700">
        {t('feed.back')}
      </Link>
    </section>
  );
}
