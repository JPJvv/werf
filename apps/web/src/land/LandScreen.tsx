/**
 * The farm's ground (FR-150) — camps or blocks, in this farm's word for them. Read entirely from
 * the LOCAL register, so it renders in full in a signal dead zone.
 *
 * This is the destination the guided first run has pointed at since Phase 1 ("Add your first camp"),
 * which until now landed on a placeholder. It is deliberately a plain list with one action: the
 * value of a camp record at this stage is that an animal has somewhere to be, not that the screen
 * is interesting.
 *
 * ⭐ Each camp carries its live head (FR-705). `summariseHerd` has computed `byLandUnit` and been
 * unit-tested since the read-model slice, and nothing rendered it — a number the app knows and does
 * not show is the same as a number it does not have. "How many are in that camp" is the question a
 * farmer asks standing at a gate deciding where to move stock, and it is the one number that makes
 * this a list of ground rather than a list of names. It counts GROUPS as well as individual
 * animals, so a flock of 300 recorded with no animal rows shows as 300 and not as nothing.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { EnterpriseType } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import { termLabelKey, vocabularyFor, type LandTerm } from '../i18n/terminology';
import { useAuth } from '../auth/AuthProvider';
import { useHerdSummary } from '../livestock/herd';
import { useCurrentPlanting } from '../crops/LocalPlantings';
import { useLatestFertiliser } from '../crops/LocalFertiliser';
import { useCurrentBoundary, useEffectiveLandUnits, type StoredLandUnit } from './LocalLand';
import { landKey } from './AddLandUnitScreen';

export function LandScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  // Merged with hydrated land units (phase-checklists.md 3e) — a camp another device created must
  // appear here too, not just the ones this device itself typed in.
  const units = useEffectiveLandUnits();
  // Live head per camp, individual animals and groups together (FR-705).
  const { byLandUnit } = useHerdSummary();

  const term = useMemo(
    () => vocabularyFor((activeFarm?.enterpriseTypes as EnterpriseType[]) ?? []).land,
    [activeFarm],
  );

  // FR-202: which blocks a split has already produced children for. Derived from the graph itself
  // rather than a status column — the same "project it, don't store it" discipline every other
  // aggregate here follows. A block with children is shown what it split into rather than offered
  // "Split this block" again; the parent's own history (boundary, plantings) stays fully visible,
  // it just stops being the door TO a new split.
  const childrenOf = useMemo(() => {
    const map = new Map<string, StoredLandUnit[]>();
    for (const unit of units) {
      if (unit.parentId === null) continue;
      const siblings = map.get(unit.parentId) ?? [];
      siblings.push(unit);
      map.set(unit.parentId, siblings);
    }
    return map;
  }, [units]);

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="font-ui text-h1 text-soil-900">{t(termLabelKey(term))}</h1>
        <p className="font-data text-data-lg tabular-nums text-soil-900">{units.length}</p>
      </div>

      <Link
        to="/land/new"
        className="mb-4 flex min-h-touch-primary items-center justify-center rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action no-underline"
      >
        {t(landKey(term, 'add'))}
      </Link>

      {units.length === 0 ? (
        <p className="text-body text-soil-700">{t(landKey(term, 'empty'))}</p>
      ) : (
        <ul className="flex list-none flex-col gap-2 p-0">
          {units.map((unit) => {
            // Absent from the bucket means no live head there — zero is the honest number, and a
            // blank would read as "not known" on the one screen where empty ground is the point.
            const head = byLandUnit[unit.id] ?? 0;
            return (
              <li
                key={unit.id}
                className="flex flex-col gap-2 rounded border border-soil-200 bg-sand-100 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-data text-body tabular-nums text-soil-900">
                    {unit.code}
                  </span>
                  <span className="text-body text-soil-700">
                    {unit.name ?? ''}
                    {/* Hectares are a measurement: tabular figures, so a column of them lines up. */}
                    {unit.hectares !== null ? (
                      <span className="font-data tabular-nums">
                        {unit.name ? ' · ' : ''}
                        {unit.hectares} {t('land.hectaresUnit')}
                      </span>
                    ) : null}
                    {/* The head count last, so the eye ends on it — it is what changes week to week
                        while the code and the hectares do not. */}
                    <span className="font-data tabular-nums text-soil-900">
                      {unit.name || unit.hectares !== null ? ' · ' : ''}
                      {head}
                    </span>{' '}
                    {t('land.headUnit')}
                  </span>
                </div>
                <BoundaryRow
                  landUnitId={unit.id}
                  term={term}
                  hasTypedBoundary={unit.boundaryGeojson !== null}
                />
                {/* A camp is never planted (FR-203) — gated on the unit's own `kind`, not the farm's
                    vocabulary, so a mixed farm's camps still show only the boundary row above. */}
                {unit.kind === 'block' && <PlantingRow landUnitId={unit.id} />}
                {/* FR-206: a camp is never fertilised in this product's model — gated on `kind`
                    exactly as the planting row above, for the same "camps ask neither" reasoning. */}
                {unit.kind === 'block' && <FertiliserRow landUnitId={unit.id} />}
                {/* FR-202: splitting is a block action, mirroring the planting gate above. */}
                {unit.kind === 'block' && (
                  <SplitRow landUnitId={unit.id} childUnits={childrenOf.get(unit.id) ?? []} />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Link to="/" className="mt-6 inline-block text-body text-dam-700">
        {t('home.back')}
      </Link>
    </section>
  );
}

/**
 * Whether this piece of ground has been walked, and the way in to walking it (FR-150).
 *
 * ⭐ THREE states, not two, and the middle one is the one this row used to lose. A camp can have no
 * boundary at all; it can have one that was TYPED when the camp was created; or it can have one that
 * was walked. "Fence not walked yet" is true of the first two and tells a farmer nothing about which
 * they are looking at — so a camp whose shape is already on file reads exactly like one nobody has
 * ever mapped, and walking it looks equally necessary in both cases when it is not.
 *
 * This is the "two absences are two facts" rule that the gestation cold-cache split had to learn,
 * one state further along: an absent WALK and an absent BOUNDARY are different absences.
 *
 * The measured hectares are shown NEXT TO the declared ones above rather than replacing them,
 * because they answer different questions: one is off a title deed, the other is where the fence
 * actually runs. Neither is allowed to quietly overwrite the other.
 */
function BoundaryRow({
  landUnitId,
  term,
  hasTypedBoundary,
}: {
  landUnitId: string;
  term: LandTerm;
  hasTypedBoundary: boolean;
}) {
  const { t } = useTranslation();
  const walked = useCurrentBoundary(landUnitId);

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-body text-soil-700">
        {walked === undefined ? (
          t(hasTypedBoundary ? 'land.boundaryTyped' : 'land.notWalked')
        ) : (
          <>
            <span className="font-data tabular-nums text-soil-900">
              {walked.areaHectares.toFixed(1)} {t('land.hectaresUnit')}
            </span>{' '}
            {t('land.walked')}
          </>
        )}
      </span>
      <Link
        to={`/land/walk?camp=${landUnitId}`}
        className="min-h-touch-min flex items-center rounded border border-soil-200 px-3 text-body text-dam-700 no-underline"
      >
        {t(landKey(term, 'walkFrom'))}
      </Link>
    </div>
  );
}

/**
 * What's currently in the ground on this block (FR-203), and the way in to recording a planting.
 *
 * Same "two absences are two facts" shape `BoundaryRow` already draws: "never planted" and "planted
 * last season, still standing" are different sentences, and `useCurrentPlanting` is the same
 * `(occurredAt, id)`-ordered projection over the append-only log that boundary uses for a walk (see
 * `@werf/domain/crops/planting.ts`'s module note).
 */
function PlantingRow({ landUnitId }: { landUnitId: string }) {
  const { t } = useTranslation();
  const current = useCurrentPlanting(landUnitId);

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-body text-soil-700">
        {current === undefined ? (
          t('crops.notPlanted')
        ) : (
          <>
            <span className="text-soil-900">{current.crop}</span> {t('crops.planted')}
          </>
        )}
      </span>
      <Link
        to={`/crops/plant?block=${landUnitId}`}
        className="min-h-touch-min flex items-center rounded border border-soil-200 px-3 text-body text-dam-700 no-underline"
      >
        {t('crops.recordPlanting')}
      </Link>
    </div>
  );
}

/**
 * The most recent fertiliser application on this block (FR-206), and the way in to recording one.
 *
 * Display only, unlike `PlantingRow`'s "currently planted" — a fertiliser application has no
 * ongoing state to project (`LocalFertiliser.tsx`'s module note): "last applied" is a convenience
 * for the farmer, never a safety or compliance read.
 */
function FertiliserRow({ landUnitId }: { landUnitId: string }) {
  const { t } = useTranslation();
  const latest = useLatestFertiliser(landUnitId);

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-body text-soil-700">
        {latest === undefined ? (
          t('crops.fertilise.none')
        ) : (
          <>
            <span className="text-soil-900">{latest.product}</span> {t('crops.fertilise.applied')}
          </>
        )}
      </span>
      <Link
        to={`/crops/fertilise?block=${landUnitId}`}
        className="min-h-touch-min flex items-center rounded border border-soil-200 px-3 text-body text-dam-700 no-underline"
      >
        {t('crops.fertilise.record')}
      </Link>
    </div>
  );
}

/**
 * FR-202: either the way in to splitting a block, or — once it has been — what it was split into.
 *
 * A parent is never closed by a split, so its own boundary/planting rows above stay exactly as
 * useful as they were; this row only stops offering "Split this block" again once children exist,
 * so a farmer does not accidentally start a second split of ground already divided.
 */
function SplitRow({
  landUnitId,
  childUnits,
}: {
  landUnitId: string;
  childUnits: readonly StoredLandUnit[];
}) {
  const { t } = useTranslation();

  if (childUnits.length > 0) {
    return (
      <p className="text-body text-soil-700">
        {t('land.split.into')} {childUnits.map((c) => c.code).join(', ')}
      </p>
    );
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Link
        to={`/land/split?block=${landUnitId}`}
        className="min-h-touch-min flex items-center rounded border border-soil-200 px-3 text-body text-dam-700 no-underline"
      >
        {t('land.split.action')}
      </Link>
    </div>
  );
}
