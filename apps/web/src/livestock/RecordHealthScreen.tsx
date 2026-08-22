/**
 * Record a treatment, vaccination or dip (FR-130/131/132/133) from the farm's own product list.
 *
 * A dosing run is a BATCH by nature: nobody doses one animal and walks away. So selection is the
 * primary interaction, as it is for a move, and every animal gets its own event under one shared
 * `batch_id` (FR-112) so the run can be reviewed or corrected as the single action it was.
 *
 * The reminder date is shown before the farmer leaves the crush. It is calculated from values the
 * farmer entered and is guidance for their own planning, never an approval or a capture block.
 * The event sends a snapshot of the chosen farm product and interval so history remains useful
 * after the catalogue changes. Werf does not compare that input with an official register.
 *
 * Offline-first: `save` commits every event locally and instantly with no network in the path. The
 * farm product list is local, so the picker works in a dead zone too.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { uuidv7, type schemas } from '@werf/core';
import { withholdUntil } from '@werf/domain';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { useAuth } from '../auth/AuthProvider';
import { farmToday } from '../farmTime';
import { useEffectiveAnimals, useEffectiveMobs } from './herd';
import { useAnimalLabels } from './LocalIdentifiers';
import { useEffectiveInventoryItems } from '../inventory/stock';
import { useRecordInventoryItem } from '../inventory/LocalInventory';
import {
  useRecordHealth,
  type DipMethod,
  type HealthKind,
  type StoredHealthEvent,
} from './LocalHealth';
import { speciesLabel } from './AnimalsScreen';

const KINDS: readonly HealthKind[] = ['treatment', 'vaccination', 'dip'];

/**
 * How a dose went in (FR-130) and how a dip was applied (FR-133). Both are on the treatment
 * register a residue traceback or an export audit reads: "20 ml" says nothing useful without
 * "intramuscular", and a plunge dip and a pour-on leave different residues on different timelines.
 */
const ROUTES: readonly schemas.TreatmentRoute[] = [
  'injection_sc',
  'injection_im',
  'injection_iv',
  'oral',
  'topical',
  'intramammary',
  'other',
];

const DIP_METHODS: readonly DipMethod[] = ['plunge', 'spray', 'pour_on', 'hand'];

export function RecordHealthScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const products = useEffectiveInventoryItems().filter((item) => item.category === 'medicine');
  const recordInventoryItem = useRecordInventoryItem();
  const labels = useAnimalLabels();
  const recordHealth = useRecordHealth();
  const live = useEffectiveAnimals().filter((a) => a.status === 'alive');
  // ⭐ A flock run by head count has no `animals` rows, so it could not be dosed from this screen
  // at all — and a plunge dip on a whole flock is the canonical operation FR-133 exists for. The
  // subject of a health event is an animal XOR a mob; only the animal half was ever built.
  const countedMobs = useEffectiveMobs().filter((m) => m.headCount !== null);

  const [kind, setKind] = useState<HealthKind>('treatment');
  const [productId, setProductId] = useState('');
  const [productName, setProductName] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [meatWithdrawalDays, setMeatWithdrawalDays] = useState('');
  const [milkWithdrawalHours, setMilkWithdrawalHours] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [selectedMob, setSelectedMob] = useState<string | null>(null);
  const [administeredBy, setAdministeredBy] = useState('');
  const [reason, setReason] = useState('');
  const [doseValue, setDoseValue] = useState('');
  const [doseUnit, setDoseUnit] = useState('');
  const [route, setRoute] = useState<schemas.TreatmentRoute | ''>('');
  const [method, setMethod] = useState<DipMethod | ''>('');
  const [dosedCount, setDosedCount] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  // ⭐ ASKED, never assumed. A dose given on Tuesday and captured on Friday — the normal case for a
  // farm in a dead zone — must be dated Tuesday: the server resolves the product REGISTRATION in
  // force on this day (ADR-0005) and computes the withdrawal clock from it. Stamping it with the
  // capture date silently turns the dated lookup back into a `now()` lookup, and dates the
  // treatment register wrong for the residue traceback or export audit that later reads it.
  const [administeredOn, setAdministeredOn] = useState(() => farmToday());

  const chosen = live.filter((a) => selected.has(a.id));
  const chosenMob = countedMobs.find((m) => m.id === selectedMob) ?? null;
  const product = products.find((p) => p.id === productId);

  if (!activeFarm) return null;

  const clearDate = meatClearDate(meatWithdrawalDays, administeredOn);

  // Animal XOR mob, enforced on the screen rather than explained in help text: picking a flock
  // clears any animals picked, and picking an animal clears the flock. The wire contract refuses
  // both at once, so offering a state that cannot be sent would only queue a capture that jams.
  const toggleMob = (id: string) => {
    setDosedCount(null);
    setSelected(new Set());
    setSelectedMob((held) => (held === id ? null : id));
  };

  const toggle = (id: string) => {
    setDosedCount(null);
    setSelectedMob(null);
    setSelected((held) => {
      const next = new Set(held);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setDosedCount(null);
    setSelectedMob(null);
    setSelected(new Set(live.map((a) => a.id)));
  };

  // A dose that was TYPED but is not a number blocks the save rather than being dropped: a
  // treatment register that silently lost the dose someone stood there and entered is worse than
  // one that never had it, because nobody knows to go back.
  const blocked =
    productName.trim() === '' ||
    (chosen.length === 0 && chosenMob === null) ||
    administeredOn === '' ||
    !optionalWholeNumber(meatWithdrawalDays) ||
    !optionalWholeNumber(milkWithdrawalHours) ||
    (kind === 'treatment' && !doseIsValid(doseValue));

  const save = async () => {
    if (blocked || saving) return;
    setSaving(true);
    const chosenProductId = product?.id ?? uuidv7();
    if (!product) {
      await recordInventoryItem({
        id: chosenProductId,
        farmId: activeFarm.id,
        enterpriseId: null,
        category: 'medicine',
        name: productName.trim(),
        unit: 'unit',
        registrationNumber: registrationNumber.trim() || null,
        activeIngredients: null,
        phiDays: null,
        reentryHours: null,
        meatWithdrawalDays: meatWithdrawalDays.trim() === '' ? null : Number(meatWithdrawalDays),
        milkWithdrawalHours: milkWithdrawalHours.trim() === '' ? null : Number(milkWithdrawalHours),
      });
      setProductId(chosenProductId);
    }
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

    const common = {
      kind,
      occurredAt,
      administeredOn,
      productId: chosenProductId,
      productName: productName.trim(),
      registrationNumber: registrationNumber.trim() || null,
      meatWithdrawalDays: meatWithdrawalDays.trim() === '' ? null : Number(meatWithdrawalDays),
      milkWithdrawalHours: milkWithdrawalHours.trim() === '' ? null : Number(milkWithdrawalHours),
      batchId,
      ...(administeredBy.trim() === '' ? {} : { administeredBy: administeredBy.trim() }),
      ...(reason.trim() === '' || kind === 'vaccination' ? {} : { reason: reason.trim() }),
      ...(kind === 'vaccination' && reason.trim() !== '' ? { programme: reason.trim() } : {}),
      // The dose belongs to a TREATMENT only — the vaccination and dip payloads carry no dose, so
      // sending one would be refused on the wire rather than quietly dropped.
      ...(kind === 'treatment' && doseIsValid(doseValue) && doseValue.trim() !== ''
        ? { doseValue: Number(doseValue) }
        : {}),
      ...(kind === 'treatment' && doseUnit.trim() !== '' ? { doseUnit: doseUnit.trim() } : {}),
      ...(kind === 'treatment' && route !== '' ? { route } : {}),
      ...(kind === 'dip' && method !== '' ? { method } : {}),
    };

    // ⭐ ONE event for a whole flock, not one per head. A counted mob has no animal rows to fan out
    // to, and inventing them would be inventing animals; the event names the mob, exactly as the
    // server has always accepted.
    const events: StoredHealthEvent[] = chosenMob
      ? [{ id: uuidv7(), farmId: activeFarm.id, animalId: null, mobId: chosenMob.id, ...common }]
      : chosen.map((animal) => ({
          id: uuidv7(),
          farmId: activeFarm.id,
          animalId: animal.id,
          mobId: null,
          ...common,
        }));
    // Not "saved" until every event in the batch is durable (P1.1) — a dosing run is one act.
    await recordHealth(events);

    setDosedCount(chosenMob ? (chosenMob.headCount ?? 0) : events.length);
    setSelected(new Set());
    setSelectedMob(null);
    setReason('');
    setDoseValue('');
    setSaving(false);
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

      {live.length === 0 && countedMobs.length === 0 ? (
        <p className="text-body text-soil-700">{t('health.noAnimals')}</p>
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

          {/* ⭐ The flocks come FIRST, because a whole-flock dip is the operation this screen is
              most often opened for on a farm that runs stock by the head count. One tap doses the
              lot; there are no individual rows to select and there never will be. */}
          {countedMobs.length > 0 && (
            <ul className="mb-4 flex list-none flex-col gap-2 p-0">
              {countedMobs.map((mob) => {
                const isSelected = selectedMob === mob.id;
                return (
                  <li key={mob.id}>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => toggleMob(mob.id)}
                      className={`flex min-h-touch-min w-full items-center justify-between rounded border p-3 text-left text-body ${
                        isSelected
                          ? 'border-soil-900 bg-sand-100 text-soil-900'
                          : 'border-soil-200 bg-sand-50 text-soil-900'
                      }`}
                    >
                      <span>{mob.name}</span>
                      <span className="text-soil-700">
                        <span className="font-data tabular-nums">{mob.headCount}</span>{' '}
                        {t('tally.headUnit')}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

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
              void save();
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
                onChange={(e) => {
                  const id = e.target.value;
                  setProductId(id);
                  const selectedProduct = products.find((item) => item.id === id);
                  setProductName(selectedProduct?.name ?? '');
                  setRegistrationNumber(selectedProduct?.registrationNumber ?? '');
                  setMeatWithdrawalDays(
                    selectedProduct?.meatWithdrawalDays == null
                      ? ''
                      : String(selectedProduct.meatWithdrawalDays),
                  );
                  setMilkWithdrawalHours(
                    selectedProduct?.milkWithdrawalHours == null
                      ? ''
                      : String(selectedProduct.milkWithdrawalHours),
                  );
                }}
                className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
              >
                <option value="">{t('health.addProduct')}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.registrationNumber ? ` · ${p.registrationNumber}` : ''}
                  </option>
                ))}
              </select>
              <label htmlFor="productName" className="mt-3 mb-1 text-label uppercase text-soil-700">
                {t('health.productName')}
              </label>
              <input
                id="productName"
                value={productName}
                onChange={(e) => {
                  setProductId('');
                  setProductName(e.target.value);
                }}
                className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
              />
              <label
                htmlFor="registrationNumber"
                className="mt-3 mb-1 text-label uppercase text-soil-700"
              >
                {t('health.registrationNumber')}
              </label>
              <input
                id="registrationNumber"
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
                className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
              />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="flex flex-col">
                  <label
                    htmlFor="meatWithdrawalDays"
                    className="mb-1 text-label uppercase text-soil-700"
                  >
                    {t('health.meatWithdrawalDays')}
                  </label>
                  <input
                    id="meatWithdrawalDays"
                    type="number"
                    min="0"
                    step="1"
                    value={meatWithdrawalDays}
                    onChange={(e) => setMeatWithdrawalDays(e.target.value)}
                    className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body text-soil-900"
                  />
                </div>
                <div className="flex flex-col">
                  <label
                    htmlFor="milkWithdrawalHours"
                    className="mb-1 text-label uppercase text-soil-700"
                  >
                    {t('health.milkWithdrawalHours')}
                  </label>
                  <input
                    id="milkWithdrawalHours"
                    type="number"
                    min="0"
                    step="1"
                    value={milkWithdrawalHours}
                    onChange={(e) => setMilkWithdrawalHours(e.target.value)}
                    className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body text-soil-900"
                  />
                </div>
              </div>
              <p className="mt-2 text-body text-soil-700">{t('health.farmerProductHelp')}</p>
              {productName.trim() !== '' && meatWithdrawalDays.trim() !== '' && (
                <p className="mt-1 border-l-4 border-dam-700 bg-sand-100 p-2 text-body text-soil-900">
                  {clearDate !== null && (
                    <>
                      {t('health.clearFrom')}{' '}
                      <span className="font-data tabular-nums">{clearDate}</span>
                    </>
                  )}
                </p>
              )}
            </div>

            {/* ⭐ The dose and the route (FR-130). Both are on the treatment register a residue
                traceback reads, and neither is inferable later: "20" without "ml" is not a dose,
                and a dose without a route does not say what happened to the animal. Optional,
                because a farmer in a crush should never be blocked from recording the treatment
                itself — but asked, because nobody comes back to fill them in. */}
            {kind === 'treatment' && (
              <div className="mb-4 grid grid-cols-2 gap-2">
                <div className="flex flex-col">
                  <label htmlFor="doseValue" className="mb-1 text-label uppercase text-soil-700">
                    {t('health.dose')}
                  </label>
                  <input
                    id="doseValue"
                    name="doseValue"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={doseValue}
                    onChange={(e) => setDoseValue(e.target.value)}
                    className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
                  />
                </div>
                <div className="flex flex-col">
                  <label htmlFor="doseUnit" className="mb-1 text-label uppercase text-soil-700">
                    {t('health.doseUnit')}
                  </label>
                  <input
                    id="doseUnit"
                    name="doseUnit"
                    type="text"
                    autoComplete="off"
                    value={doseUnit}
                    onChange={(e) => setDoseUnit(e.target.value)}
                    className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
                  />
                </div>
                <div className="col-span-2 flex flex-col">
                  <label htmlFor="route" className="mb-1 text-label uppercase text-soil-700">
                    {t('health.route')}
                  </label>
                  <select
                    id="route"
                    name="route"
                    value={route}
                    onChange={(e) => setRoute(e.target.value as schemas.TreatmentRoute | '')}
                    className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
                  >
                    <option value="">{t('health.notSaid')}</option>
                    {ROUTES.map((r) => (
                      <option key={r} value={r}>
                        {t(`health.route.${r}` as TranslationKey)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* How the dip was applied (FR-133). A plunge dip and a pour-on are different
                operations with different coverage, and the dipping register in a controlled area
                is the document that has to say which (Animal Diseases Act 35 of 1984). */}
            {kind === 'dip' && (
              <div className="mb-4 flex flex-col">
                <label htmlFor="method" className="mb-1 text-label uppercase text-soil-700">
                  {t('health.method')}
                </label>
                <select
                  id="method"
                  name="method"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as DipMethod | '')}
                  className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
                >
                  <option value="">{t('health.notSaid')}</option>
                  {DIP_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {t(`health.method.${m}` as TranslationKey)}
                    </option>
                  ))}
                </select>
              </div>
            )}

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
              disabled={blocked || saving}
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

/** A typed dose is valid when it is blank (optional) or a positive number. */
function doseIsValid(typed: string): boolean {
  if (typed.trim() === '') return true;
  const n = Number(typed);
  return Number.isFinite(n) && n > 0;
}

/**
 * The day the animal clears its MEAT withdrawal, from the cached registration — a PREVIEW for the
 * farmer in the crush, never the stored value (see the file header). Uses the same pure domain
 * function the server uses, so the two agree whenever the cache is current, and null when the
 * product carries no meat withdrawal at all.
 */
function optionalWholeNumber(typed: string): boolean {
  if (typed.trim() === '') return true;
  const value = Number(typed);
  return Number.isInteger(value) && value >= 0;
}

function meatClearDate(withdrawalDays: string, administeredOn: string): string | null {
  if (
    !optionalWholeNumber(withdrawalDays) ||
    withdrawalDays.trim() === '' ||
    administeredOn === ''
  ) {
    return null;
  }
  return withholdUntil(administeredOn, Number(withdrawalDays));
}
