/**
 * Walk a camp's fence and record its boundary (FR-150, § 4 B7).
 *
 * The gap: `land_units.boundary` and its GeoJSON mirror have existed since migration 0008 and the
 * API has accepted a polygon since the land slice — and nothing in the product could produce one. A
 * boundary could only be typed, which means in practice that no farm has ever had one. This is the
 * screen that makes the column true.
 *
 * ⭐ GPS IS THE ONE THING THAT WORKS OUT HERE. It is a receiver, not a connection, so a farmer can
 * walk a fence in a dead zone with no signal at all and the phone still knows exactly where it is.
 * That is why every judgement this screen makes — is that enough corners, does this fence cross
 * itself, how much ground is this — is made ON THE DEVICE. A refusal computed by a server arrives
 * days later, when the farmer is nowhere near the corner that was wrong and cannot walk it again.
 *
 * ⭐ THE WALK IS DURABLE FROM THE FIRST CORNER, not from the Save. Walking a 200 ha camp takes the
 * better part of an hour: phones lock, browsers discard backgrounded tabs, and a farmer drives
 * between far corners. Every corner is written through the draft store as it is marked, so an hour
 * of walking cannot be lost to a screen timeout — which is the failure mode that would make a
 * farmer never trust this screen again.
 *
 * The word "camp" is not chosen here. `vocabularyFor()` decides whether this farm calls a piece of
 * ground a camp or a block, exactly as `AddLandUnitScreen` does.
 */

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { uuidv7, type EnterpriseType } from '@werf/core';
import {
  MIN_WALK_CORNERS,
  closeWalk,
  ringSelfIntersects,
  walkAreaHectares,
  worstAccuracyM,
} from '@werf/domain';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { vocabularyFor } from '../i18n/terminology';
import { useAuth } from '../auth/AuthProvider';
import { currentFix, type FixFailure } from '../geo/geolocation';
import { landKey } from './AddLandUnitScreen';
import { useCurrentBoundary, useLandUnits, useRecordBoundaryWalk, useWalkDraft } from './LocalLand';

/**
 * Above this, a fix is worth saying something about: in the open a phone reports 3–10 m, so 20 m
 * means trees, cloud, or a receiver that has not settled. A UI quality hint and nothing more — it
 * never blocks the save, because the farmer standing at the corner knows things this does not, and
 * a boundary walked badly is still better than no boundary at all.
 */
const POOR_ACCURACY_M = 20;

/** Hectares, to one decimal. More would claim a precision GPS does not have at this scale. */
const showHectares = (hectares: number): string => hectares.toFixed(1);

export function WalkBoundaryScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const units = useLandUnits();
  const recordWalk = useRecordBoundaryWalk();
  const [params] = useSearchParams();

  const term = useMemo(
    () => vocabularyFor((activeFarm?.enterpriseTypes as EnterpriseType[]) ?? []).land,
    [activeFarm],
  );

  // Arrived from the land list with a camp already chosen, or falls back to the first one held.
  const requested = params.get('camp');
  const [selectedId, setSelectedId] = useState<string>(() => requested ?? units[0]?.id ?? '');
  const selected = units.find((unit) => unit.id === selectedId);

  const { corners, mark, dropLast, discard } = useWalkDraft(selectedId);
  const alreadyWalked = useCurrentBoundary(selectedId);

  const [marking, setMarking] = useState(false);
  const [fixFailed, setFixFailed] = useState<FixFailure | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);

  const area = walkAreaHectares(corners);
  const crosses = ringSelfIntersects(corners);
  const worstAccuracy = worstAccuracyM(corners);
  const closed = closeWalk(corners);

  if (!activeFarm) return null;

  const markCorner = async () => {
    setJustSaved(null);
    setMarking(true);
    // ⭐ Awaited on purpose, and this is the one place in the app where waiting is right: a fix that
    // has not arrived is not a corner, and marking one from a stale position would put the fence
    // somewhere the farmer never stood. It is not a NETWORK wait — GPS needs no signal — so the
    // offline rule is untouched.
    const fix = await currentFix();
    setMarking(false);

    if (!fix.ok) {
      setFixFailed(fix.reason);
      return;
    }
    setFixFailed(null);
    mark({ lon: fix.lon, lat: fix.lat, accuracyM: fix.accuracyM });
  };

  const save = () => {
    if (!closed.ok || !selected) return;

    recordWalk({
      id: uuidv7(),
      farmId: activeFarm.id,
      landUnitId: selected.id,
      // A true instant, not a chosen day: the fixes were taken just now, by this phone, standing on
      // the fence. There is nothing to back-date and nothing to convert to a farm-local day.
      occurredAt: new Date().toISOString(),
      corners,
      boundaryGeojson: closed.boundaryGeojson,
      areaHectares: closed.areaHectares,
    });
    // The draft has become a fact. Discard it so the next walk of this camp starts empty rather
    // than inheriting corners that are now in the append-only log.
    discard();
    setJustSaved(selected.code);
  };

  if (units.length === 0) {
    return (
      <section className="mx-auto w-full max-w-3xl p-4">
        <h1 className="mb-4 font-ui text-h1 text-soil-900">{t(landKey(term, 'walk'))}</h1>
        <p className="mb-4 text-body text-soil-700">{t(landKey(term, 'walkNoLand'))}</p>
        <Link to="/land/new" className="text-body text-dam-700">
          {t(landKey(term, 'add'))}
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t(landKey(term, 'walk'))}</h1>

      {justSaved !== null && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {justSaved} {t(landKey(term, 'walkSaved'))}
        </p>
      )}

      <div className="mb-4 flex flex-col">
        <label htmlFor="camp" className="mb-1 text-label uppercase text-soil-700">
          {t(landKey(term, 'walkWhich'))}
        </label>
        <select
          id="camp"
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value);
            setJustSaved(null);
            setFixFailed(null);
          }}
          className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body text-soil-900"
        >
          {units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.code}
              {unit.name ? ` — ${unit.name}` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Two absences are two facts: a camp nobody has walked and a camp walked last winter owe the
          farmer different sentences, and the second must say that saving again REPLACES it. */}
      {alreadyWalked !== undefined && corners.length === 0 && (
        <p className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
          {t(landKey(term, 'walkReplaces'))}{' '}
          <span className="font-data tabular-nums">
            {showHectares(alreadyWalked.areaHectares)} {t('land.hectaresUnit')}
          </span>
        </p>
      )}

      {/* The instrument: what has been walked so far. Corners and hectares are both measurements,
          so both are tabular figures — the signature rule. */}
      <div className="mb-4 rounded border border-soil-200 bg-sand-100 p-3">
        <p className="text-label uppercase text-soil-700">{t(landKey(term, 'walkSoFar'))}</p>
        <p className="font-data text-data-lg tabular-nums text-soil-900">
          {corners.length} {t('land.cornersUnit')}
          {corners.length >= MIN_WALK_CORNERS
            ? ` · ${showHectares(area)} ${t('land.hectaresUnit')}`
            : ''}
        </p>
        {corners.length > 0 && corners.length < MIN_WALK_CORNERS && (
          <p className="mt-1 text-body text-soil-700">{t('land.walkNeedMore')}</p>
        )}
      </div>

      {/* Never colour alone (NFR-411): each of these is a tinted panel with a left rule and its own
          sentence, and none of them is shaped like an action. */}
      {crosses && (
        <p
          role="status"
          className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900"
        >
          {t('land.walkCrosses')}
        </p>
      )}

      {worstAccuracy > POOR_ACCURACY_M && (
        <p className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
          {t('land.walkPoorFix')}{' '}
          <span className="font-data tabular-nums">{Math.round(worstAccuracy)} m</span>
        </p>
      )}

      {fixFailed !== null && (
        <p
          role="alert"
          className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900"
        >
          {t(`land.gps.${fixFailed}` as TranslationKey)}
        </p>
      )}

      {/* ONE ochre action on this screen, and this is it: marking a corner is what the farmer is
          here to do, over and over, wearing gloves. 64px (NFR-402). */}
      <button
        type="button"
        onClick={() => void markCorner()}
        disabled={marking}
        className="min-h-touch-primary mb-3 w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
      >
        {marking ? t('land.walkMarking') : t('land.walkMark')}
      </button>

      <div className="mb-6 flex gap-2">
        <button
          type="button"
          onClick={dropLast}
          disabled={corners.length === 0}
          className="min-h-touch-min flex-1 rounded border border-soil-200 bg-sand-100 px-4 font-ui text-body text-soil-900 disabled:opacity-60"
        >
          {t('land.walkUndo')}
        </button>
        <button
          type="button"
          onClick={() => {
            discard();
            setFixFailed(null);
          }}
          disabled={corners.length === 0}
          className="min-h-touch-min flex-1 rounded border border-soil-200 bg-sand-100 px-4 font-ui text-body text-soil-900 disabled:opacity-60"
        >
          {t('land.walkDiscard')}
        </button>
      </div>

      <button
        type="button"
        onClick={save}
        disabled={!closed.ok}
        className="min-h-touch-primary w-full rounded border-2 border-soil-900 bg-sand-100 px-4 font-ui text-body font-semibold text-soil-900 disabled:opacity-60"
      >
        {t(landKey(term, 'walkSave'))}
      </button>

      <p className="mt-3 text-body text-soil-700">{t('land.walkOffline')}</p>

      <Link to="/land" className="mt-6 inline-block text-body text-dam-700">
        {t('land.done')}
      </Link>
    </section>
  );
}
