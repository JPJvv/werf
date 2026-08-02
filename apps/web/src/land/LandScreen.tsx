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
import { useCurrentBoundary, useLandUnits } from './LocalLand';
import { landKey } from './AddLandUnitScreen';

export function LandScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const units = useLandUnits();
  // Live head per camp, individual animals and groups together (FR-705).
  const { byLandUnit } = useHerdSummary();

  const term = useMemo(
    () => vocabularyFor((activeFarm?.enterpriseTypes as EnterpriseType[]) ?? []).land,
    [activeFarm],
  );

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
                <BoundaryRow landUnitId={unit.id} term={term} />
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
 * ⭐ Two absences are two facts. "Fence not walked yet" and "walked, 108.2 ha" are different
 * sentences, and collapsing them into a blank would leave a farmer unable to tell a camp nobody has
 * mapped from one whose walk failed to save. The same lesson the gestation cold-cache split had to
 * learn, applied here from the start.
 *
 * The measured hectares are shown NEXT TO the declared ones above rather than replacing them,
 * because they answer different questions: one is off a title deed, the other is where the fence
 * actually runs. Neither is allowed to quietly overwrite the other.
 */
function BoundaryRow({ landUnitId, term }: { landUnitId: string; term: LandTerm }) {
  const { t } = useTranslation();
  const walked = useCurrentBoundary(landUnitId);

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-body text-soil-700">
        {walked === undefined ? (
          t('land.notWalked')
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
