/**
 * Record a treatment, vaccination or dip (FR-130/131/132/133) — COMPLIANCE-GATED
 * (legal-compliance.md § 3). The crush-side capture that the whole withdrawal-period machinery
 * exists to serve.
 *
 * A dosing run is a BATCH by nature: nobody doses one animal and walks away. So selection is the
 * primary interaction, as it is for a move, and every animal gets its own event under one shared
 * `batch_id` (FR-112) so the run can be reviewed or corrected as the single action it was.
 *
 * ⭐ THE CLEAR DATE IS SHOWN BEFORE THE FARMER LEAVES THE CRUSH. "When can I sell this animal?" is
 * the question the record exists to answer, and answering it three weeks later on a screen nobody
 * opens is answering it too late. The date shown here is computed from the CACHED product register
 * using the same pure domain function the server uses — it is a preview, and the date actually
 * STORED is computed server-side from the registration in force on the treatment day (ADR-0005).
 * The client never sends a withdrawal period; it sends a product id, which is what stops a client
 * claiming a shorter withhold by relabelling.
 *
 * Offline-first: `save` commits every event locally and instantly with no network in the path. The
 * product register is a local cache, so the picker works in a dead zone too.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { uuidv7 } from '@werf/core';
import { withholdUntil } from '@werf/domain';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { useAuth } from '../auth/AuthProvider';
import { farmToday } from '../farmTime';
import { useEffectiveAnimals } from './herd';
import { useAnimalLabels } from './LocalIdentifiers';
import { useVetProducts, type StoredVetProduct } from './LocalVetProducts';
import { useRecordHealth, type HealthKind, type StoredHealthEvent } from './LocalHealth';
import { speciesLabel } from './AnimalsScreen';

const KINDS: readonly HealthKind[] = ['treatment', 'vaccination', 'dip'];

export function RecordHealthScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const products = useVetProducts();
  const labels = useAnimalLabels();
  const recordHealth = useRecordHealth();
  const live = useEffectiveAnimals().filter((a) => a.status === 'alive');

  const [kind, setKind] = useState<HealthKind>('treatment');
  const [productId, setProductId] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [administeredBy, setAdministeredBy] = useState('');
  const [reason, setReason] = useState('');
  const [dosedCount, setDosedCount] = useState<number | null>(null);
  // ⭐ ASKED, never assumed. A dose given on Tuesday and captured on Friday — the normal case for a
  // farm in a dead zone — must be dated Tuesday: the server resolves the product REGISTRATION in
  // force on this day (ADR-0005) and computes the withdrawal clock from it. Stamping it with the
  // capture date silently turns the dated lookup back into a `now()` lookup, and dates the
  // treatment register wrong for the residue traceback or export audit that later reads it.
  const [administeredOn, setAdministeredOn] = useState(() => farmToday());

  const chosen = live.filter((a) => selected.has(a.id));
  // A product registered for cattle is not a product for sheep. Filtering by what is actually
  // selected keeps a wrong choice off the screen rather than relying on the farmer to notice.
  const speciesInSelection = useMemo(() => new Set(chosen.map((a) => a.species)), [chosen]);
  const usable = useMemo(
    () =>
      products.filter(
        (p) =>
          speciesInSelection.size === 0 ||
          [...speciesInSelection].every((s) => p.species.includes(s)),
      ),
    [products, speciesInSelection],
  );
  const product = usable.find((p) => p.id === productId);

  if (!activeFarm) return null;

  const clearDate = meatClearDate(product, administeredOn);

  const toggle = (id: string) => {
    setDosedCount(null);
    setSelected((held) => {
      const next = new Set(held);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setDosedCount(null);
    setSelected(new Set(live.map((a) => a.id)));
  };

  const blocked = product === undefined || chosen.length === 0 || administeredOn === '';

  const save = () => {
    if (blocked || !product) return;
    // ONE batch id across the run: it was one action with one syringe and one product.
    const batchId = uuidv7();
    // The two clocks the schema keeps apart. `occurredAt` is when the dose was GIVEN: precise when
    // it is being recorded the same day, and midday on the chosen day when it is back-dated, since
    // the day is genuinely all the farmer knows by then. `createdAt` — when the row was written —
    // is the server's to stamp, and the two differ by days after a week in a dead zone.
    const occurredAt =
      administeredOn === farmToday()
        ? new Date().toISOString()
        : new Date(`${administeredOn}T12:00:00.000Z`).toISOString();

    const events: StoredHealthEvent[] = chosen.map((animal) => ({
      id: uuidv7(),
      farmId: activeFarm.id,
      animalId: animal.id,
      kind,
      occurredAt,
      administeredOn,
      productId: product.id,
      batchId,
      ...(administeredBy.trim() === '' ? {} : { administeredBy: administeredBy.trim() }),
      ...(reason.trim() === '' || kind === 'vaccination' ? {} : { reason: reason.trim() }),
      ...(kind === 'vaccination' && reason.trim() !== '' ? { programme: reason.trim() } : {}),
    }));
    recordHealth(events);

    setDosedCount(events.length);
    setSelected(new Set());
    setReason('');
  };

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('health.title')}</h1>

      {dosedCount !== null && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          <span className="font-data tabular-nums">{dosedCount}</span> {t('health.saved')}
        </p>
      )}

      {live.length === 0 ? (
        <p className="text-body text-soil-700">{t('health.noAnimals')}</p>
      ) : products.length === 0 ? (
        // The register has not reached this device yet. Say so plainly: a farmer must not be left
        // staring at an empty picker wondering what they did wrong.
        <p className="border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
          {t('health.noProducts')}
        </p>
      ) : (
        <>
          <fieldset className="mb-4 border-0 p-0">
            <legend className="mb-1 text-label uppercase text-soil-700">{t('health.what')}</legend>
            <div className="flex gap-2">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  className={`min-h-touch-min flex-1 rounded border px-2 font-ui text-body ${
                    kind === k
                      ? 'border-soil-900 bg-sand-100 text-soil-900'
                      : 'border-soil-200 bg-sand-50 text-soil-900'
                  }`}
                >
                  {t(`health.kind.${k}` as TranslationKey)}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-label uppercase text-soil-700">{t('health.which')}</p>
            <button
              type="button"
              onClick={selectAll}
              className="min-h-touch-min px-2 text-body text-dam-700"
            >
              {t('move.selectAll')}
            </button>
          </div>

          <ul className="mb-6 flex list-none flex-col gap-2 p-0">
            {live.map((animal) => {
              const isSelected = selected.has(animal.id);
              return (
                <li key={animal.id}>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => toggle(animal.id)}
                    className={`flex min-h-touch-min w-full items-center justify-between rounded border p-3 text-left text-body ${
                      isSelected
                        ? 'border-soil-900 bg-sand-100 text-soil-900'
                        : 'border-soil-200 bg-sand-50 text-soil-900'
                    }`}
                  >
                    <span>
                      {labels.has(animal.id) ? (
                        <span className="font-data tabular-nums">{labels.get(animal.id)}</span>
                      ) : (
                        speciesLabel(t, animal.species)
                      )}
                    </span>
                    <span className="text-soil-700">{speciesLabel(t, animal.species)}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            {/* Before the product, because the clear date below depends on it: a farmer changing
                the day must see the withholding answer move with it. */}
            <div className="mb-4 flex flex-col">
              <label htmlFor="administeredOn" className="mb-1 text-label uppercase text-soil-700">
                {t('health.administeredOn')}
              </label>
              <input
                id="administeredOn"
                name="administeredOn"
                type="date"
                max={farmToday()}
                value={administeredOn}
                onChange={(e) => setAdministeredOn(e.target.value)}
                className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
              />
            </div>

            <div className="mb-4 flex flex-col">
              <label htmlFor="product" className="mb-1 text-label uppercase text-soil-700">
                {t('health.product')}
              </label>
              <select
                id="product"
                name="product"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
              >
                <option value="">{t('health.chooseProduct')}</option>
                {usable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.registrationNumber ? ` · ${p.registrationNumber}` : ''}
                  </option>
                ))}
              </select>
              {/* Answers "so when CAN I sell?" before it is asked — in the crush, not three weeks
                  later. A product with no meat withdrawal says so, because "no withholding" is an
                  answer a farmer needs just as much as a date. */}
              {product && (
                <p className="mt-1 border-l-4 border-dam-700 bg-sand-100 p-2 text-body text-soil-900">
                  {clearDate === null ? (
                    t('health.noWithdrawal')
                  ) : (
                    <>
                      {t('health.clearFrom')}{' '}
                      <span className="font-data tabular-nums">{clearDate}</span>
                    </>
                  )}
                </p>
              )}
            </div>

            <div className="mb-4 flex flex-col">
              <label htmlFor="reason" className="mb-1 text-label uppercase text-soil-700">
                {t(kind === 'vaccination' ? 'health.programme' : 'health.reason')}
              </label>
              <input
                id="reason"
                name="reason"
                type="text"
                autoComplete="off"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
              />
            </div>

            <div className="mb-6 flex flex-col">
              <label htmlFor="by" className="mb-1 text-label uppercase text-soil-700">
                {t('health.by')}
              </label>
              <input
                id="by"
                name="by"
                type="text"
                autoComplete="off"
                value={administeredBy}
                onChange={(e) => setAdministeredBy(e.target.value)}
                className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
              />
            </div>

            <button
              type="submit"
              disabled={blocked}
              className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
            >
              {chosen.length > 0 ? `${t('health.save')} · ${chosen.length}` : t('health.save')}
            </button>
          </form>
        </>
      )}

      <Link to="/animals" className="mt-6 inline-block text-body text-dam-700">
        {t('health.back')}
      </Link>
    </section>
  );
}

/**
 * The day the animal clears its MEAT withdrawal, from the cached registration — a PREVIEW for the
 * farmer in the crush, never the stored value (see the file header). Uses the same pure domain
 * function the server uses, so the two agree whenever the cache is current, and null when the
 * product carries no meat withdrawal at all.
 */
function meatClearDate(
  product: StoredVetProduct | undefined,
  administeredOn: string,
): string | null {
  if (!product || product.meatWithdrawalDays === null) return null;
  return withholdUntil(administeredOn, product.meatWithdrawalDays);
}
