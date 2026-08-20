/**
 * Split a block into sub-blocks without losing history (FR-202).
 *
 * ⭐ THE PARENT IS NEVER CLOSED. "Without losing history" is the FR's own words: the old block's
 * captures — every spray, every planting — stay filed under its own id forever, and the split does
 * nothing to that row beyond letting new children point at it. There is no server endpoint here
 * beyond the ordinary one: `POST /land-units` has accepted an optional `parentId` since Phase 2
 * (`packages/db/migrations/0008`), farm-scoped and validated (`assertOwnedReferences`), and a split
 * child is — from the write path's point of view — an ordinary new block that happens to carry one.
 * This screen is a bulk-creation UI over that existing path, not a new mutation.
 *
 * Restricted to `kind === 'block'`, the same way `RecordPlantingScreen` is: FR-202's own words say
 * "block", and the reuse map that opened Phase 4 confirmed nothing about camps needs this yet — a
 * camp subdivided for rotational grazing is a real future need, but not one asked for here, and the
 * schema/server layer underneath places no such restriction (only the screen does).
 *
 * Each child inherits the parent's `soilType`/`irrigation`/`enterpriseId` — the same ground, the
 * same crop, the same soil, until a farmer says otherwise — and asks fresh for `code`/`name`/
 * `hectares`, the three facts that are NEW once the ground has been divided. There is no per-child
 * override for soil/irrigation in this slice, and no land-unit EDIT screen exists yet to fix one
 * later either way (a pre-existing gap, not created by this slice) — named rather than silently
 * worked around.
 *
 * ⭐ ONE GENERATION ONLY, ENFORCED BY THE PICKER, NOT JUST THE LANDSCREEN LINK. The picker offers
 * only LEAF blocks — `kind === 'block'` AND not itself any other unit's `parentId`. A block that has
 * already been split cannot be split again. This is deliberate, not incidental: `ancestorChainOf`
 * (in `@werf/domain`) walks every generation, so a grandchild would silently inherit a
 * grandparent's plantings too — fine for the unbounded planting fold, but 4d's PHI spray guard needs
 * a bound (`occurred_at` before the child's own `createdAt`) reasoned for exactly one hop. Multi-
 * generation splits would need that bound re-derived per hop before 4d could trust it. Keeping splits
 * single-generation for now means 4d only has to reason about one hop, ever. If a real need for
 * re-splitting a child shows up, lift this restriction AND revisit 4d's bound in the same change —
 * don't lift one without the other.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { schemas, uuidv7, type EnterpriseType } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import { vocabularyFor } from '../i18n/terminology';
import { useAuth } from '../auth/AuthProvider';
import { useEffectiveLandUnits, useRecordLandUnit, type StoredLandUnit } from './LocalLand';
import { landKey } from './AddLandUnitScreen';

const MIN_CHILDREN = 2;

interface ChildDraft {
  readonly key: string;
  readonly code: string;
  readonly name: string;
  readonly hectares: string;
}

function emptyChild(): ChildDraft {
  return { key: uuidv7(), code: '', name: '', hectares: '' };
}

/** An optional non-negative measurement as typed → a number, or null for "not given". */
function optionalNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function isBadNumber(text: string): boolean {
  return text.trim() !== '' && optionalNumber(text) === null;
}

export function SplitBlockScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const units = useEffectiveLandUnits();
  const parentIds = useMemo(
    () => new Set(units.map((unit) => unit.parentId).filter((id): id is string => id !== null)),
    [units],
  );
  const blocks = useMemo(
    () => units.filter((unit) => unit.kind === 'block' && !parentIds.has(unit.id)),
    [units, parentIds],
  );
  const recordLandUnit = useRecordLandUnit();
  const [params] = useSearchParams();

  // Same live reconciliation as `WalkBoundaryScreen`/`RecordPlantingScreen` — the farm switcher in
  // the shell header changes the active farm WITHOUT navigating, so `?block=` is re-checked against
  // the live list on every render rather than snapshotted once at mount.
  const requested = params.get('block');
  const [picked, setPicked] = useState<string | null>(null);
  const [lastRequested, setLastRequested] = useState(requested);
  if (requested !== lastRequested) {
    setLastRequested(requested);
    setPicked(null);
  }
  const preferredId = picked ?? requested ?? '';
  const parent = blocks.find((unit) => unit.id === preferredId) ?? blocks[0] ?? null;
  const parentId = parent?.id ?? '';

  const [children, setChildren] = useState<readonly ChildDraft[]>(() => [
    emptyChild(),
    emptyChild(),
  ]);
  const [justSplit, setJustSplit] = useState<readonly string[] | null>(null);
  const [saving, setSaving] = useState(false);

  if (!activeFarm) return null;

  const term = vocabularyFor((activeFarm.enterpriseTypes as EnterpriseType[]) ?? []).land;

  const clearSaved = () => setJustSplit(null);

  const updateChild = (key: string, patch: Partial<ChildDraft>): void => {
    clearSaved();
    setChildren((current) => current.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  };

  const addChild = (): void => {
    clearSaved();
    setChildren((current) => [...current, emptyChild()]);
  };

  const removeChild = (key: string): void => {
    clearSaved();
    setChildren((current) => current.filter((c) => c.key !== key));
  };

  const existingCodes = new Set(units.map((u) => u.code.toLowerCase()));
  const trimmedCodes = children.map((c) => c.code.trim());
  const codeCounts = new Map<string, number>();
  for (const code of trimmedCodes) {
    if (code === '') continue;
    const key = code.toLowerCase();
    codeCounts.set(key, (codeCounts.get(key) ?? 0) + 1);
  }
  const codeProblem = (child: ChildDraft): 'blank' | 'existing' | 'duplicate' | null => {
    const trimmed = child.code.trim();
    if (trimmed === '') return 'blank';
    const key = trimmed.toLowerCase();
    if (existingCodes.has(key)) return 'existing';
    if ((codeCounts.get(key) ?? 0) > 1) return 'duplicate';
    return null;
  };

  const anyCodeProblem = children.some((c) => codeProblem(c) !== null);
  const anyBadHectares = children.some((c) => isBadNumber(c.hectares));
  const valid =
    parent !== null && children.length >= MIN_CHILDREN && !anyCodeProblem && !anyBadHectares;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || !parent || saving) return;
    setSaving(true);

    // Sequential, not parallel: each is its own durable local write (P1.1), and there is no reason
    // to race them against the same capture store.
    const codes: string[] = [];
    for (const child of children) {
      const unit = childUnit(parent, activeFarm.id, child);
      await recordLandUnit(unit);
      codes.push(unit.code);
    }

    setJustSplit(codes);
    setChildren([emptyChild(), emptyChild()]);
    setSaving(false);
  };

  if (blocks.length === 0) {
    return (
      <section className="mx-auto w-full max-w-3xl p-4">
        <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('land.split.title')}</h1>
        <p className="mb-4 text-body text-soil-700">{t('land.split.noBlocks')}</p>
        <Link to="/land/new" className="text-body text-dam-700">
          {t('land.add.block')}
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('land.split.title')}</h1>

      {justSplit !== null && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {t('land.split.saved')} {justSplit.join(', ')}
        </p>
      )}

      <form onSubmit={save}>
        <div className="mb-4 flex flex-col">
          <label htmlFor="parent" className="mb-1 text-label uppercase text-soil-700">
            {t('land.split.which')}
          </label>
          <select
            id="parent"
            value={parentId}
            onChange={(e) => {
              setPicked(e.target.value);
              clearSaved();
            }}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body text-soil-900"
          >
            {blocks.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.code}
                {unit.name ? ` — ${unit.name}` : ''}
              </option>
            ))}
          </select>
        </div>

        <p className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
          {t('land.split.keptWarning')}
        </p>

        <ul className="mb-4 flex list-none flex-col gap-3 p-0">
          {children.map((child, index) => {
            const problem = codeProblem(child);
            return (
              <li
                key={child.key}
                className="flex flex-col gap-2 rounded border border-soil-200 bg-sand-100 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-label uppercase text-soil-700">
                    {t('land.split.child')} {index + 1}
                  </span>
                  {children.length > MIN_CHILDREN && (
                    <button
                      type="button"
                      onClick={() => removeChild(child.key)}
                      className="min-h-touch-min text-body text-dam-700"
                    >
                      {t('land.split.remove')}
                    </button>
                  )}
                </div>

                <label htmlFor={`code-${child.key}`} className="text-label uppercase text-soil-700">
                  {t(landKey(term, 'code'))}
                </label>
                <input
                  id={`code-${child.key}`}
                  type="text"
                  autoComplete="off"
                  value={child.code}
                  onChange={(e) => updateChild(child.key, { code: e.target.value })}
                  aria-describedby={problem ? `code-${child.key}-problem` : undefined}
                  className="min-h-touch-min rounded border border-soil-200 bg-white px-3 font-data text-body tabular-nums text-soil-900"
                />
                {problem !== null && (
                  <p id={`code-${child.key}-problem`} className="text-body text-soil-900">
                    {t(
                      problem === 'existing'
                        ? 'land.split.codeExisting'
                        : problem === 'duplicate'
                          ? 'land.split.codeDuplicate'
                          : 'land.split.codeBlank',
                    )}
                  </p>
                )}

                <label htmlFor={`name-${child.key}`} className="text-label uppercase text-soil-700">
                  {t('land.name')}
                </label>
                <input
                  id={`name-${child.key}`}
                  type="text"
                  autoComplete="off"
                  value={child.name}
                  onChange={(e) => updateChild(child.key, { name: e.target.value })}
                  className="min-h-touch-min rounded border border-soil-200 bg-white px-3 text-body text-soil-900"
                />

                <label
                  htmlFor={`hectares-${child.key}`}
                  className="text-label uppercase text-soil-700"
                >
                  {t('land.hectares')}
                </label>
                <input
                  id={`hectares-${child.key}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={child.hectares}
                  onChange={(e) => updateChild(child.key, { hectares: e.target.value })}
                  className="min-h-touch-min rounded border border-soil-200 bg-white px-3 font-data tabular-nums text-body text-soil-900"
                />
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={addChild}
          className="mb-6 min-h-touch-min w-full rounded border border-soil-200 px-4 text-body text-dam-700"
        >
          {t('land.split.addAnother')}
        </button>

        <button
          type="submit"
          disabled={!valid || saving}
          className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
        >
          {t('land.split.save')}
        </button>
      </form>

      <Link to="/land" className="mt-6 inline-block text-body text-dam-700">
        {t('land.split.back')}
      </Link>
    </section>
  );
}

/** Build one child `NewLandUnit` from a draft, inheriting the parent's ground and asking fresh only
 *  for what genuinely changed. */
function childUnit(parent: StoredLandUnit, farmId: string, child: ChildDraft): schemas.NewLandUnit {
  return schemas.newLandUnitSchema.parse({
    id: uuidv7(),
    farmId,
    parentId: parent.id,
    kind: parent.kind,
    code: child.code.trim(),
    name: child.name.trim() || null,
    hectares: optionalNumber(child.hectares),
    enterpriseId: parent.enterpriseId,
    soilType: parent.soilType,
    irrigation: parent.irrigation,
  });
}
