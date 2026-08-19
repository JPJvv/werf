/**
 * Move a group (FR-151) — the capture FR-151's own grazing-days/stocking-rate projection has been
 * blocked on since it was first scoped: a mob-only flock had no way to record that it walked to
 * another camp at all (`mobs.land_unit_id` was written once, at creation, and never again). This
 * screen is that missing capture, not the projection itself — see `phase-checklists.md` 4e·1 for
 * the owner decision this closes and what still sits on top of it.
 *
 * One mob, one destination camp, per save — the same "one difficulty level" shape
 * `AdjustMobScreen.tsx` uses rather than `MoveAnimalsScreen.tsx`'s batch-selection one: a group
 * move has no per-animal fan-out to select over, so there is nothing a batch UI would buy here.
 *
 * Offline-first: save commits locally and instantly, with no network in the path (NFR-007).
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { uuidv7 } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { vocabularyFor } from '../i18n/terminology';
import type { EnterpriseType } from '@werf/core';
import { useAuth } from '../auth/AuthProvider';
import { useEffectiveLandUnits } from '../land/LocalLand';
import { useEffectiveMobs } from './herd';
import { useRecordMobMove } from './LocalMobMoves';
import { useCampGrazing, restPeriodWarning } from './grazing';

export function MoveMobScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const landUnits = useEffectiveLandUnits();
  const mobs = useEffectiveMobs();
  const recordMobMove = useRecordMobMove();
  // FR-152 (4e·2): warn, never block, when the chosen destination hasn't rested the owner-set
  // number of days yet — checked at capture, the same "warn before the truck leaves" discipline
  // every advisory check in this app follows, even though this one is agronomic, not a guard.
  const grazing = useCampGrazing();

  const term = useMemo(
    () => vocabularyFor((activeFarm?.enterpriseTypes as EnterpriseType[]) ?? []).land,
    [activeFarm],
  );
  const campNames = useMemo(() => new Map(landUnits.map((u) => [u.id, u.code])), [landUnits]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toLandUnitId, setToLandUnitId] = useState('');
  const [movedName, setMovedName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!activeFarm) return null;

  const selected = mobs.find((m) => m.id === selectedId) ?? null;
  // A destination must be named and it must actually move the group — sending it to the camp it is
  // already in is not a move, and the screen refuses it up front rather than letting the server 400.
  const destinationNamed = toLandUnitId !== '';
  const wouldMove = destinationNamed && selected !== null && selected.landUnitId !== toLandUnitId;
  const destinationStatus = wouldMove ? grazing.get(toLandUnitId) : undefined;
  const destinationWarning = restPeriodWarning(destinationStatus, activeFarm.restPeriodDays);

  const save = async () => {
    if (!selected || !wouldMove || saving) return;
    setSaving(true);
    await recordMobMove({
      id: uuidv7(),
      farmId: activeFarm.id,
      mobId: selected.id,
      occurredAt: new Date().toISOString(),
      toLandUnitId,
    });
    setMovedName(selected.name);
    setSelectedId(null);
    setToLandUnitId('');
    setSaving(false);
  };

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('moveMob.title')}</h1>

      {movedName !== null && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {movedName} {t('moveMob.saved')}
        </p>
      )}

      {mobs.length === 0 ? (
        <p className="text-body text-soil-700">{t('moveMob.empty')}</p>
      ) : landUnits.length === 0 ? (
        <>
          <p className="mb-4 text-body text-soil-700">
            {t(`move.nowhere.${term}` as TranslationKey)}
          </p>
          <Link
            to="/land/new"
            className="flex min-h-touch-primary items-center justify-center rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action no-underline"
          >
            {t(`land.add.${term}` as TranslationKey)}
          </Link>
        </>
      ) : (
        <>
          <p className="mb-2 text-label uppercase text-soil-700">{t('moveMob.which')}</p>
          <ul className="mb-6 flex list-none flex-col gap-2 p-0">
            {mobs.map((mob) => {
              const isSelected = mob.id === selectedId;
              return (
                <li key={mob.id}>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => {
                      setMovedName(null);
                      setSelectedId(mob.id);
                      setToLandUnitId('');
                    }}
                    className={`flex min-h-touch-min w-full items-center justify-between rounded border p-3 text-left text-body ${
                      isSelected
                        ? 'border-soil-900 bg-sand-100 text-soil-900'
                        : 'border-soil-200 bg-sand-50 text-soil-900'
                    }`}
                  >
                    <span>{mob.name}</span>
                    <span className="text-soil-700">
                      {mob.landUnitId === null
                        ? t('move.unplaced')
                        : (campNames.get(mob.landUnitId) ?? t('move.unplaced'))}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {selected && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <div className="mb-4 flex flex-col">
                <label htmlFor="mob-move-to" className="mb-1 text-label uppercase text-soil-700">
                  {t(`move.to.${term}` as TranslationKey)}
                </label>
                <select
                  id="mob-move-to"
                  name="mob-move-to"
                  value={toLandUnitId}
                  onChange={(e) => setToLandUnitId(e.target.value)}
                  className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
                >
                  <option value="">{t('moveMob.pickDestination')}</option>
                  {landUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.code}
                    </option>
                  ))}
                </select>
              </div>

              {destinationWarning !== null && (
                <div className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
                  <p className="mb-1 font-ui font-semibold">
                    {t('land.grazing.prematureMoveTitle')}
                  </p>
                  <p>
                    {t('land.grazing.readyIn')}{' '}
                    <span className="font-data tabular-nums">
                      {destinationWarning.daysRemaining}
                    </span>{' '}
                    {t('land.grazing.restTargetUnit')}
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={!wouldMove || saving}
                className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
              >
                {t('moveMob.save')}
              </button>
            </form>
          )}
        </>
      )}

      <Link to="/animals" className="mt-6 inline-block text-body text-dam-700">
        {t('moveMob.back')}
      </Link>
    </section>
  );
}
