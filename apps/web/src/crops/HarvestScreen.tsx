/**
 * Harvest history (FR-207) — this is the home grid's "harvest" tile destination (`home/tiles.ts`),
 * real from this slice on rather than the placeholder it pointed at before 4d. Mirrors
 * `SpraysScreen.tsx` exactly: built ENTIRELY from local cached data
 * (`useEffectiveHarvests()` joined against the local land register for the block code), no network
 * call in the render path — the server's `GET /crops/harvests` (`CropsService.listHarvestHistory`)
 * exists for future non-device consumers and is not called here.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../i18n/LocaleProvider';
import { useEffectiveLandUnits } from '../land/LocalLand';
import { useEffectiveHarvests, type StoredHarvest } from './LocalHarvest';

function isLaterOccurred(a: StoredHarvest, b: StoredHarvest): boolean {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt > b.occurredAt;
  return a.id > b.id;
}

export function HarvestScreen() {
  const { t } = useTranslation();
  const harvests = useEffectiveHarvests();
  const units = useEffectiveLandUnits();
  const blocks = useMemo(() => units.filter((u) => u.kind === 'block'), [units]);

  const [blockFilter, setBlockFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const landUnitCodes = useMemo(() => new Map(units.map((u) => [u.id, u.code])), [units]);

  const filtered = useMemo(
    () =>
      harvests
        .filter((h) => blockFilter === '' || h.landUnitId === blockFilter)
        .filter((h) => from === '' || h.harvestedOn >= from)
        .filter((h) => to === '' || h.harvestedOn <= to)
        .slice()
        .sort((a, b) => (isLaterOccurred(a, b) ? -1 : 1)),
    [harvests, blockFilter, from, to],
  );

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('crops.harvests.title')}</h1>

      <Link
        to="/crops/harvest"
        className="min-h-touch-primary mb-4 flex items-center justify-center rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action no-underline"
      >
        {t('crops.harvests.record')}
      </Link>

      {blocks.length > 0 && (
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <select
            aria-label={t('crops.harvests.filterBlock')}
            value={blockFilter}
            onChange={(e) => setBlockFilter(e.target.value)}
            className="min-h-touch-min flex-1 rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
          >
            <option value="">{t('crops.harvests.allBlocks')}</option>
            {blocks.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.code}
              </option>
            ))}
          </select>
          <input
            aria-label={t('crops.harvests.filterFrom')}
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data tabular-nums text-body text-soil-900"
          />
          <input
            aria-label={t('crops.harvests.filterTo')}
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data tabular-nums text-body text-soil-900"
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-body text-soil-700">{t('crops.harvests.none')}</p>
      ) : (
        <ul className="flex list-none flex-col gap-2 p-0">
          {filtered.map((harvest) => (
            <li
              key={harvest.id}
              className="flex flex-col gap-1 rounded border border-soil-200 bg-sand-100 p-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-data tabular-nums text-soil-900">{harvest.harvestedOn}</span>
                <span className="font-data text-body text-soil-900">
                  {landUnitCodes.get(harvest.landUnitId) ?? harvest.landUnitId}
                </span>
              </div>
              <span className="text-body text-soil-900">
                <span className="font-data tabular-nums">{harvest.quantity}</span> {harvest.unit}
                {harvest.grade ? ` · ${harvest.grade}` : ''}
                {harvest.destination ? ` · ${harvest.destination}` : ''}
              </span>
              {harvest.phiOverride && (
                <span className="text-body text-klei-700">
                  {t('crops.harvests.overridden')} {harvest.phiOverride.reason}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <Link to="/" className="mt-6 inline-block text-body text-dam-700">
        {t('home.back')}
      </Link>
    </section>
  );
}
