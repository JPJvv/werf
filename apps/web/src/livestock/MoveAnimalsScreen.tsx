/**
 * Move animals (FR-103) — and, because this is the capture where it is unavoidable, the first real
 * BATCH action (FR-112).
 *
 * A farmer does not walk one animal. They open a gate and a camp empties. A screen that asked them
 * to record forty individual moves would be a screen they walk past, so selection is the primary
 * interaction here and a single-animal move is simply a group of one. Every animal in the selection
 * gets its own event — the history is per animal, because that is what a movement record has to be —
 * tied together by ONE `batch_id` so the group can be reviewed or corrected as the single action it
 * actually was.
 *
 * "Select all in this camp" is offered because that is the real-world action: the whole of Camp 3
 * walks to Camp 4. Filtering by where they are now is what makes the selection tractable with a
 * thumb.
 *
 * Offline-first: `save` commits every move locally and instantly with no network in the path.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { uuidv7 } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { vocabularyFor } from '../i18n/terminology';
import type { EnterpriseType } from '@werf/core';
import { useAuth } from '../auth/AuthProvider';
import { useLandUnits } from '../land/LocalLand';
import { useEffectiveAnimals, useEffectiveMobs } from './herd';
import { useAnimalLabels } from './LocalIdentifiers';
import { useRecordMoves, type StoredMove } from './LocalMoves';
import { speciesLabel } from './AnimalsScreen';

/** Where an animal is now, in the farmer's words. */
function whereLabel(
  landUnitId: string | null,
  camps: ReadonlyMap<string, string>,
  nowhere: string,
): string {
  return landUnitId === null ? nowhere : (camps.get(landUnitId) ?? nowhere);
}

export function MoveAnimalsScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const landUnits = useLandUnits();
  // ⭐ Merged with hydrated mobs (phase-checklists.md 3e, `useEffectiveMobs`) — a mob another device
  // created is a real destination a gate can walk animals into, not just one this device happened
  // to make itself.
  const mobs = useEffectiveMobs();
  const labels = useAnimalLabels();
  const recordMoves = useRecordMoves();
  const live = useEffectiveAnimals().filter((a) => a.status === 'alive');

  const term = useMemo(
    () => vocabularyFor((activeFarm?.enterpriseTypes as EnterpriseType[]) ?? []).land,
    [activeFarm],
  );
  const campNames = useMemo(() => new Map(landUnits.map((u) => [u.id, u.code])), [landUnits]);

  // Narrow the list to one origin: "everything in Camp 3" is the selection a gate actually makes.
  const [fromId, setFromId] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [toLandUnitId, setToLandUnitId] = useState('');
  const [toMobId, setToMobId] = useState('');
  const [movedCount, setMovedCount] = useState<number | null>(null);

  const shown = useMemo(
    () =>
      fromId === ''
        ? live
        : live.filter((a) => (fromId === 'none' ? a.landUnitId === null : a.landUnitId === fromId)),
    [live, fromId],
  );

  if (!activeFarm) return null;

  const toggle = (id: string) => {
    setMovedCount(null);
    setSelected((held) => {
      const next = new Set(held);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllShown = () => {
    setMovedCount(null);
    setSelected(new Set(shown.map((a) => a.id)));
  };

  const chosen = shown.filter((a) => selected.has(a.id));
  // A destination must be named, and it must actually move something. Sending an animal to the camp
  // it is already in is not a move — the server refuses it, so the screen does too, up front.
  const destinationNamed = toLandUnitId !== '' || toMobId !== '';
  const wouldMove = chosen.filter(
    (a) =>
      (toLandUnitId !== '' && a.landUnitId !== toLandUnitId) ||
      (toMobId !== '' && a.mobId !== toMobId),
  );
  const blocked = !destinationNamed || wouldMove.length === 0;

  const save = () => {
    if (blocked) return;
    // ONE batch id across the whole walk — the group is a single action, not forty coincidences.
    const batchId = uuidv7();
    const occurredAt = new Date().toISOString();

    const moves: StoredMove[] = wouldMove.map((animal) => ({
      id: uuidv7(),
      farmId: activeFarm.id,
      animalId: animal.id,
      occurredAt,
      batchId,
      // Omitted, not null: a destination that was not named leaves that dimension alone. Sending
      // null here would turn "walk them to Camp 4" into "and take them out of their mob".
      ...(toLandUnitId === '' ? {} : { toLandUnitId }),
      ...(toMobId === '' ? {} : { toMobId }),
    }));
    recordMoves(moves);

    setMovedCount(moves.length);
    setSelected(new Set());
  };

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">
        {t(`move.title.${term}` as TranslationKey)}
      </h1>

      {movedCount !== null && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          <span className="font-data tabular-nums">{movedCount}</span> {t('move.saved')}
        </p>
      )}

      {live.length === 0 ? (
        <p className="text-body text-soil-700">{t('move.empty')}</p>
      ) : landUnits.length === 0 && mobs.length === 0 ? (
        // Nowhere to move them TO. Say what to do rather than showing an empty picker.
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
          {landUnits.length > 0 && (
            <div className="mb-4 flex flex-col">
              <label htmlFor="move-from" className="mb-1 text-label uppercase text-soil-700">
                {t(`move.from.${term}` as TranslationKey)}
              </label>
              <select
                id="move-from"
                name="move-from"
                value={fromId}
                onChange={(e) => {
                  setFromId(e.target.value);
                  setSelected(new Set());
                  setMovedCount(null);
                }}
                className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
              >
                <option value="">{t('move.anywhere')}</option>
                <option value="none">{t('move.unplaced')}</option>
                {landUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.code}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-label uppercase text-soil-700">{t('move.which')}</p>
            <button
              type="button"
              onClick={selectAllShown}
              className="min-h-touch-min px-2 text-body text-dam-700"
            >
              {t('move.selectAll')}
            </button>
          </div>

          <ul className="mb-6 flex list-none flex-col gap-2 p-0">
            {shown.map((animal) => {
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
                    <span className="text-soil-700">
                      {whereLabel(animal.landUnitId, campNames, t('move.unplaced'))}
                    </span>
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
            {landUnits.length > 0 && (
              <div className="mb-4 flex flex-col">
                <label htmlFor="move-to" className="mb-1 text-label uppercase text-soil-700">
                  {t(`move.to.${term}` as TranslationKey)}
                </label>
                <select
                  id="move-to"
                  name="move-to"
                  value={toLandUnitId}
                  onChange={(e) => setToLandUnitId(e.target.value)}
                  className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
                >
                  <option value="">{t('move.unchanged')}</option>
                  {landUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.code}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {mobs.length > 0 && (
              <div className="mb-6 flex flex-col">
                <label htmlFor="move-to-mob" className="mb-1 text-label uppercase text-soil-700">
                  {t('move.toGroup')}
                </label>
                <select
                  id="move-to-mob"
                  name="move-to-mob"
                  value={toMobId}
                  onChange={(e) => setToMobId(e.target.value)}
                  className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
                >
                  <option value="">{t('move.unchanged')}</option>
                  {mobs.map((mob) => (
                    <option key={mob.id} value={mob.id}>
                      {mob.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="submit"
              disabled={blocked}
              className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
            >
              {wouldMove.length > 0 ? `${t('move.save')} · ${wouldMove.length}` : t('move.save')}
            </button>
          </form>
        </>
      )}

      <Link to="/animals" className="mt-6 inline-block text-body text-dam-700">
        {t('move.back')}
      </Link>
    </section>
  );
}
