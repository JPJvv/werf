/**
 * Create a camp or a block (FR-150) — the first thing the guided first run asks a farmer to do,
 * and until now the one it could not actually do.
 *
 * ⭐ The word is not chosen here. `vocabularyFor()` decides whether this farm calls a piece of
 * ground a camp or a block, and the dictionary holds the word for that term — so a vineyard is
 * never told to add a camp, and the sentence forms are real sentences in Afrikaans rather than a
 * noun dropped into a template. `kind` follows the same decision, which is why there is no "is this
 * a camp or a block?" question: the farm already answered it when it said what it farms.
 *
 * Offline-first like every capture: `save` commits to the local register instantly with no network
 * in the path (NFR-007). The outbox sends it later, BEFORE any animal, because an animal can carry
 * a land_unit_id.
 *
 * The code (the farmer's own label — "Camp 3", "B12") is unique per farm in the database, so a
 * duplicate is refused HERE, against the register the device already holds, rather than being
 * discovered days later when the queue finally reaches a server and cannot drain.
 *
 * ⭐ Checked against LOCAL+HYDRATED (phase-checklists.md 3e, land hydration), not just what this
 * device itself has typed. Two devices both offline naming a camp "3" in the same week is still a
 * genuine conflict this cannot see — neither has heard of the other's capture yet — but ONE common
 * case this now catches that it could not before: a farmer's second device, already caught up via
 * down-sync, retyping a code the FIRST device named days ago. The server still refuses what neither
 * device could see coming, with a message rather than a silent merge.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { schemas, uuidv7, type EnterpriseType } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { vocabularyFor, type LandTerm } from '../i18n/terminology';
import { useAuth } from '../auth/AuthProvider';
import { useEffectiveLandUnits, useRecordLandUnit } from './LocalLand';

/** A sentence about a piece of ground, in this farm's word for it. */
export function landKey(term: LandTerm, part: string): TranslationKey {
  return `land.${part}.${term}` as TranslationKey;
}

/** An optional measurement as typed → a number, or null for "not given". */
function optionalNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** True when the text was given but is not a usable non-negative number. */
function isBadNumber(text: string): boolean {
  return text.trim() !== '' && optionalNumber(text) === null;
}

export function AddLandUnitScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const units = useEffectiveLandUnits();
  const recordLandUnit = useRecordLandUnit();

  const term = useMemo(
    () => vocabularyFor((activeFarm?.enterpriseTypes as EnterpriseType[]) ?? []).land,
    [activeFarm],
  );

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [hectares, setHectares] = useState('');
  const [capacity, setCapacity] = useState('');
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!activeFarm) return null;

  const trimmedCode = code.trim();
  const taken = units.some((u) => u.code.toLowerCase() === trimmedCode.toLowerCase());
  const blocked = trimmedCode === '' || taken || isBadNumber(hectares) || isBadNumber(capacity);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (blocked || saving) return;
    setSaving(true);

    const unit = schemas.newLandUnitSchema.parse({
      id: uuidv7(),
      farmId: activeFarm.id,
      // The farm's vocabulary decides the kind: a farm that speaks in blocks is creating a block.
      kind: term,
      code: trimmedCode,
      name: name.trim() || null,
      hectares: optionalNumber(hectares),
      // Carrying capacity is a grazing number; a block does not have one.
      carryingCapacityLsu: term === 'camp' ? optionalNumber(capacity) : null,
    });
    // Not "saved" until the local write is durable (P1.1).
    await recordLandUnit(unit);

    setJustSaved(unit.code);
    setCode('');
    setName('');
    setHectares('');
    setCapacity('');
    setSaving(false);
  };

  const edit = (setter: (value: string) => void) => (value: string) => {
    setJustSaved(null);
    setter(value);
  };

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t(landKey(term, 'new'))}</h1>

      {justSaved !== null && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {justSaved} {t(landKey(term, 'saved'))}
        </p>
      )}

      <form onSubmit={save}>
        <div className="mb-4 flex flex-col">
          <label htmlFor="code" className="mb-1 text-label uppercase text-soil-700">
            {t(landKey(term, 'code'))}
          </label>
          <input
            id="code"
            name="code"
            type="text"
            autoComplete="off"
            value={code}
            onChange={(e) => edit(setCode)(e.target.value)}
            aria-describedby={taken ? 'code-taken' : undefined}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
          />
          {/* What happened, and what to do about it — never "Validation error". Shown as a tinted
              panel with a left rule, the warning FORM, so it is never mistaken for an action. */}
          {taken && (
            <p
              id="code-taken"
              className="mt-1 border-l-4 border-klei-700 bg-klei-100 p-2 text-body text-soil-900"
            >
              {t(landKey(term, 'taken'))}
            </p>
          )}
        </div>

        <div className="mb-4 flex flex-col">
          <label htmlFor="name" className="mb-1 text-label uppercase text-soil-700">
            {t('land.name')}
          </label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="off"
            value={name}
            onChange={(e) => edit(setName)(e.target.value)}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
          />
        </div>

        <div className="mb-4 flex flex-col">
          <label htmlFor="hectares" className="mb-1 text-label uppercase text-soil-700">
            {t('land.hectares')}
          </label>
          <input
            id="hectares"
            name="hectares"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={hectares}
            onChange={(e) => edit(setHectares)(e.target.value)}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
          />
        </div>

        {/* Grazing capacity is a camp's number. A block is measured in tons, not large stock units. */}
        {term === 'camp' && (
          <div className="mb-6 flex flex-col">
            <label htmlFor="capacity" className="mb-1 text-label uppercase text-soil-700">
              {t('land.capacity')}
            </label>
            <input
              id="capacity"
              name="capacity"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={capacity}
              onChange={(e) => edit(setCapacity)(e.target.value)}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={blocked || saving}
          className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
        >
          {justSaved !== null ? t(landKey(term, 'another')) : t(landKey(term, 'save'))}
        </button>
      </form>

      <Link to="/land" className="mt-6 inline-block text-body text-dam-700">
        {t('land.done')}
      </Link>
    </section>
  );
}
