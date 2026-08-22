/** Private, offline spray history built from the farmer's own captured facts. */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../i18n/LocaleProvider';
import { useEffectiveLandUnits } from '../land/LocalLand';
import { useEffectiveSprays, type StoredSpray } from './LocalSprays';
import { useEffectiveInventoryItems } from '../inventory/stock';

function isLaterOccurred(a: StoredSpray, b: StoredSpray): boolean {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt > b.occurredAt;
  return a.id > b.id;
}

export function SpraysScreen() {
  const { t } = useTranslation();
  const sprays = useEffectiveSprays();
  const units = useEffectiveLandUnits();
  const products = useEffectiveInventoryItems();
  const blocks = useMemo(() => units.filter((u) => u.kind === 'block'), [units]);

  const [blockFilter, setBlockFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const landUnitCodes = useMemo(() => new Map(units.map((u) => [u.id, u.code])), [units]);
  const productNames = useMemo(
    () => new Map(products.map((product) => [product.id, product.name])),
    [products],
  );

  const filtered = useMemo(
    () =>
      sprays
        .filter((s) => blockFilter === '' || s.landUnitId === blockFilter)
        .filter((s) => from === '' || s.sprayedOn >= from)
        .filter((s) => to === '' || s.sprayedOn <= to)
        .slice()
        .sort((a, b) => (isLaterOccurred(a, b) ? -1 : 1)),
    [sprays, blockFilter, from, to],
  );

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('crops.sprays.title')}</h1>

      <Link
        to="/crops/spray"
        className="min-h-touch-primary mb-4 flex items-center justify-center rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action no-underline"
      >
        {t('crops.sprays.record')}
      </Link>

      {blocks.length > 0 && (
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <select
            aria-label={t('crops.sprays.filterBlock')}
            value={blockFilter}
            onChange={(e) => setBlockFilter(e.target.value)}
            className="min-h-touch-min flex-1 rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
          >
            <option value="">{t('crops.sprays.allBlocks')}</option>
            {blocks.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.code}
              </option>
            ))}
          </select>
          <input
            aria-label={t('crops.sprays.filterFrom')}
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data tabular-nums text-body text-soil-900"
          />
          <input
            aria-label={t('crops.sprays.filterTo')}
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data tabular-nums text-body text-soil-900"
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-body text-soil-700">{t('crops.sprays.none')}</p>
      ) : (
        <ul className="flex list-none flex-col gap-2 p-0">
          {filtered.map((spray) => (
            <li
              key={spray.id}
              className="flex flex-col gap-1 rounded border border-soil-200 bg-sand-100 p-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-data tabular-nums text-soil-900">{spray.sprayedOn}</span>
                <span className="font-data text-body text-soil-900">
                  {landUnitCodes.get(spray.landUnitId) ?? spray.landUnitId}
                </span>
              </div>
              <span className="text-body text-soil-900">
                {spray.productName ||
                  productNames.get(spray.productId) ||
                  t('crops.sprays.unknownProduct')}
                {spray.registrationNumber ? ` · ${spray.registrationNumber}` : ''}
              </span>
              <span className="text-body text-soil-700">
                {spray.phiDays === undefined ? (
                  t('crops.spray.noPhi')
                ) : spray.earliestHarvestDate === undefined ? (
                  t('crops.sprays.harvestDateUnknown')
                ) : (
                  <>
                    {t('crops.spray.harvestFrom')}{' '}
                    <span className="font-data tabular-nums">{spray.earliestHarvestDate}</span>
                  </>
                )}
              </span>
              {(spray.activeIngredients !== undefined ||
                spray.rateLPerHa !== undefined ||
                spray.waterLPerHa !== undefined ||
                spray.operator !== undefined ||
                spray.equipment !== undefined ||
                spray.windKph !== undefined ||
                spray.tempC !== undefined ||
                spray.targetPest !== undefined) && (
                <div className="mt-2 border-t border-soil-200 pt-2 text-body text-soil-900">
                  {spray.activeIngredients !== undefined && (
                    <p>
                      <span className="font-ui font-semibold">{t('crops.sprays.actives')}:</span>{' '}
                      {spray.activeIngredients.join(', ')}
                    </p>
                  )}
                  {(spray.rateLPerHa !== undefined || spray.waterLPerHa !== undefined) && (
                    <p>
                      <span className="font-ui font-semibold">
                        {t('crops.sprays.application')}:
                      </span>{' '}
                      {spray.rateLPerHa ?? '—'} L/ha · {spray.waterLPerHa ?? '—'} L/ha{' '}
                      {t('crops.sprays.water')}
                    </p>
                  )}
                  {(spray.operator !== undefined || spray.equipment !== undefined) && (
                    <p>
                      <span className="font-ui font-semibold">{t('crops.sprays.operator')}:</span>{' '}
                      {spray.operator ?? '—'} · {t('crops.sprays.equipment')}:{' '}
                      {spray.equipment ?? '—'}
                    </p>
                  )}
                  {(spray.windKph !== undefined || spray.tempC !== undefined) && (
                    <p>
                      <span className="font-ui font-semibold">{t('crops.sprays.weather')}:</span>{' '}
                      {spray.windKph ?? '—'} km/h · {spray.tempC ?? '—'} °C
                    </p>
                  )}
                  {spray.targetPest !== undefined && (
                    <p>
                      <span className="font-ui font-semibold">{t('crops.sprays.target')}:</span>{' '}
                      {spray.targetPest}
                    </p>
                  )}
                </div>
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
