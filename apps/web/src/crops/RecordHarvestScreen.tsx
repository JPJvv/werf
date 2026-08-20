/**
 * Record a harvest (FR-207) — COMPLIANCE-GATED (legal-compliance.md § 4.3, US-030). Blocks at
 * capture inside an active pre-harvest interval, resolved from the block's OWN spray history
 * (`usePhiGuard`, `@werf/domain`'s `phiGuardFor`) — O-12: blocked locally, no server round trip.
 *
 * ⭐ THE MESSAGE ANSWERS "SO WHEN CAN I HARVEST?" BEFORE IT IS ASKED (US-030's own gherkin): names
 * the product, the spray date, and the earliest safe harvest date. An override is offered, but it is
 * never silent (FR-205): a category AND a free-text reason are both required, and the server writes
 * an immutable audit row with the acting user and timestamp the instant it lands.
 *
 * ⭐ A SPLIT BLOCK'S INHERITED SPRAY HISTORY IS NOT CHECKED HERE. `usePhiGuard` only reads this
 * block's own sprays — see its own module note for why. This screen discloses that gap on its own
 * account whenever the selected block was split from another, so a leaf-only "clear" never reads as
 * a confirmed answer about ground with a history this device cannot see. The server checks the full
 * ancestor chain and is the authoritative backstop (`crops.service.ts`).
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { uuidv7 } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import { useAuth } from '../auth/AuthProvider';
import { farmToday } from '../farmTime';
import { useEffectiveLandUnits } from '../land/LocalLand';
import { useChemicalProducts } from './LocalChemicalProducts';
import { useRecordHarvest } from './LocalHarvest';
import { usePhiGuard } from './usePhiGuard';

const OVERRIDE_REASON_CATEGORIES = [
  'export_deadline',
  'spoilage_risk',
  'misrecorded_spray',
  'other',
] as const;
type OverrideReasonCategory = (typeof OVERRIDE_REASON_CATEGORIES)[number];

function today(): string {
  return farmToday();
}

function harvestedInstant(day: string): Date {
  return day === today() ? new Date() : new Date(`${day}T12:00:00.000Z`);
}

function optionalPositiveNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function RecordHarvestScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const units = useEffectiveLandUnits();
  const blocks = useMemo(() => units.filter((unit) => unit.kind === 'block'), [units]);
  const products = useChemicalProducts();
  const recordHarvest = useRecordHarvest();
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

  const [harvestedOn, setHarvestedOn] = useState(today);
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [grade, setGrade] = useState('');
  const [destination, setDestination] = useState('');
  const [overriding, setOverriding] = useState(false);
  const [overrideCategory, setOverrideCategory] = useState<OverrideReasonCategory | ''>('');
  const [overrideText, setOverrideText] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const guard = usePhiGuard(selectedId, harvestedOn);
  const blockedProduct =
    guard.blocked && guard.reason === 'active_phi'
      ? products.find((p) => p.id === guard.blockedBy.productId)
      : undefined;

  const overrideReady = overrideCategory !== '' && overrideText.trim() !== '';
  const canOverride = guard.blocked && guard.reason === 'active_phi';
  const needsOverride = guard.blocked;
  const quantityValue = optionalPositiveNumber(quantity);

  const valid =
    selected !== null &&
    harvestedOn !== '' &&
    unit.trim() !== '' &&
    quantityValue !== undefined &&
    (!needsOverride || (overriding && overrideReady));

  const resetForm = () => {
    setQuantity('');
    setUnit('');
    setGrade('');
    setDestination('');
    setOverriding(false);
    setOverrideCategory('');
    setOverrideText('');
  };

  const clearSaved = () => setSaved(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || !selected || quantityValue === undefined || saving) return;
    setSaving(true);

    // `by` is never set here — the acting user id is server-resolved from the session, the same
    // reasoning `createdBy` is never client-set anywhere in this app (`LocalHarvest.tsx`'s own
    // module note).
    const phiOverride =
      needsOverride && overrideReady
        ? {
            reason: `${t(`crops.harvest.overrideReason.${overrideCategory as OverrideReasonCategory}`)}: ${overrideText.trim()}`,
          }
        : undefined;

    await recordHarvest({
      id: uuidv7(),
      farmId: activeFarm!.id,
      landUnitId: selected.id,
      occurredAt: harvestedInstant(harvestedOn),
      harvestedOn,
      quantity: quantityValue,
      unit: unit.trim(),
      ...(grade.trim() === '' ? {} : { grade: grade.trim() }),
      ...(destination.trim() === '' ? {} : { destination: destination.trim() }),
      ...(phiOverride === undefined ? {} : { phiOverride }),
    });

    setSaved(true);
    resetForm();
    setSaving(false);
  };

  if (!activeFarm) return null;

  if (blocks.length === 0) {
    return (
      <section className="mx-auto w-full max-w-3xl p-4">
        <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('crops.harvest.title')}</h1>
        <p className="mb-4 text-body text-soil-700">{t('crops.harvest.noBlocks')}</p>
        <Link to="/land/new" className="text-body text-dam-700">
          {t('land.add.block')}
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('crops.harvest.title')}</h1>

      {saved && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {t('crops.harvest.saved')}
        </p>
      )}

      <form onSubmit={save}>
        <div className="mb-4 flex flex-col">
          <label htmlFor="block" className="mb-1 text-label uppercase text-soil-700">
            {t('crops.harvest.which')}
          </label>
          <select
            id="block"
            value={selectedId}
            onChange={(e) => {
              setPicked(e.target.value);
              clearSaved();
            }}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body text-soil-900"
          >
            {blocks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
                {b.name ? ` — ${b.name}` : ''}
              </option>
            ))}
          </select>
          {/* The one gap `usePhiGuard` cannot close offline — disclosed unconditionally, never
              folded into the blocked/clear state, so a split block never reads as confirmed clear
              on the strength of a check that only ever looked at its own history. */}
          {selected?.parentId !== null && selected !== null && (
            <p className="mt-1 border-l-4 border-klei-700 bg-klei-100 p-2 text-body text-soil-900">
              {t('crops.harvest.splitBlockWarning')}
            </p>
          )}
        </div>

        <div className="mb-4 flex flex-col">
          <label htmlFor="harvestedOn" className="mb-1 text-label uppercase text-soil-700">
            {t('crops.harvest.day')}
          </label>
          <input
            id="harvestedOn"
            name="harvestedOn"
            type="date"
            max={today()}
            value={harvestedOn}
            onChange={(e) => {
              clearSaved();
              setHarvestedOn(e.target.value);
              setOverriding(false);
            }}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
          />
        </div>

        {guard.blocked && guard.reason === 'active_phi' && (
          <div className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
            <p className="mb-1 font-ui font-semibold">{t('crops.harvest.blockedTitle')}</p>
            <p>
              {blockedProduct?.name ?? t('crops.harvest.blockedProductUnknown')}{' '}
              {t('crops.harvest.blockedSprayedOn')}{' '}
              <span className="font-data tabular-nums">{guard.blockedBy.sprayedOn}</span>.{' '}
              {t('crops.harvest.blockedEarliest')}{' '}
              <span className="font-data tabular-nums">{guard.blockedBy.earliestHarvestDate}</span>.
            </p>
            {!overriding ? (
              <button
                type="button"
                onClick={() => setOverriding(true)}
                className="min-h-touch-min mt-2 rounded border border-soil-700 bg-sand-100 px-3 text-body text-soil-900"
              >
                {t('crops.harvest.override')}
              </button>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                <label htmlFor="overrideCategory" className="text-label uppercase text-soil-700">
                  {t('crops.harvest.overrideReasonLabel')}
                </label>
                <select
                  id="overrideCategory"
                  value={overrideCategory}
                  onChange={(e) =>
                    setOverrideCategory(e.target.value as OverrideReasonCategory | '')
                  }
                  className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
                >
                  <option value="">{t('crops.harvest.overrideReasonChoose')}</option>
                  {OVERRIDE_REASON_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {t(`crops.harvest.overrideReason.${category}`)}
                    </option>
                  ))}
                </select>
                <label htmlFor="overrideText" className="text-label uppercase text-soil-700">
                  {t('crops.harvest.overrideTextLabel')}
                </label>
                <textarea
                  id="overrideText"
                  value={overrideText}
                  onChange={(e) => setOverrideText(e.target.value)}
                  className="min-h-24 rounded border border-soil-200 bg-sand-100 px-3 py-2 text-body text-soil-900"
                />
                <p className="text-label text-soil-700">{t('crops.harvest.overrideAudited')}</p>
              </div>
            )}
          </div>
        )}

        {guard.blocked && guard.reason === 'unresolved' && (
          <div className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
            {t('crops.harvest.unresolved')}
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-2">
          <div className="flex flex-col">
            <label htmlFor="quantity" className="mb-1 text-label uppercase text-soil-700">
              {t('crops.harvest.quantity')}
            </label>
            <input
              id="quantity"
              name="quantity"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data tabular-nums text-body text-soil-900"
            />
          </div>
          <div className="flex flex-col">
            <label htmlFor="unit" className="mb-1 text-label uppercase text-soil-700">
              {t('crops.harvest.unit')}
            </label>
            <input
              id="unit"
              name="unit"
              type="text"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
            />
          </div>
        </div>

        <div className="mb-4 flex flex-col">
          <label htmlFor="grade" className="mb-1 text-label uppercase text-soil-700">
            {t('crops.harvest.grade')}
          </label>
          <input
            id="grade"
            name="grade"
            type="text"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
          />
        </div>

        <div className="mb-6 flex flex-col">
          <label htmlFor="destination" className="mb-1 text-label uppercase text-soil-700">
            {t('crops.harvest.destination')}
          </label>
          <input
            id="destination"
            name="destination"
            type="text"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
          />
        </div>

        <button
          type="submit"
          disabled={!valid || saving}
          className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
        >
          {canOverride && overriding ? t('crops.harvest.saveOverride') : t('crops.harvest.save')}
        </button>
      </form>

      <Link to="/land" className="mt-6 inline-block text-body text-dam-700">
        {t('crops.harvest.back')}
      </Link>
    </section>
  );
}
