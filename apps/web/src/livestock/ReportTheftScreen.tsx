/**
 * Report stock theft (FR-603/605) — COMPLIANCE-GATED (legal-compliance.md § 3.2, Stock Theft Act
 * 57 of 1959). The field record a farmer files standing at a cut fence, and the thing the SAPS
 * evidence pack is later assembled from.
 *
 * ⛔ THERE IS NO FIELD FOR WHO DID IT, and its absence is the most considered thing on this screen.
 * A farmer naming a neighbour in a record we store and later render into a document is a defamation
 * exposure for them and a POPIA s26 criminal-behaviour processing exposure for us. So the screen
 * asks what was FOUND, not who is suspected — and says so in plain words, because a farmer who
 * cannot find the field will otherwise type the name into "what did you find" and we will have
 * achieved nothing. The store enforces the same rule structurally (`LocalTheft.tsx`).
 *
 * ⭐ The GPS point is taken, not typed, and it is what makes the record worth anything: an incident
 * without a last-seen point is a paragraph, and one with it is evidence. Geolocation is a receiver,
 * not a connection — it works in a dead zone — so asking for it costs an offline farmer nothing.
 * Unlike a missing report (FR-605), a point is not REFUSED here when the phone cannot give one: an
 * incident may be filed days later at the kitchen table for stock last seen in a camp the farmer is
 * no longer standing in, and refusing the whole record over that would lose the report entirely.
 * The screen says which of the two it got.
 *
 * Offline-first like every capture: `save` commits to the local store with no network in the path
 * (NFR-007). The one thing that needs a signal is the PDF, and that is a separate, later, deliberate
 * action on the incidents screen.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { uuidv7 } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { useAuth } from '../auth/AuthProvider';
import { farmToday } from '../farmTime';
import { useLandUnits } from '../land/LocalLand';
import { useEffectiveAnimals } from './herd';
import { useAnimalLabels } from './LocalIdentifiers';
import { useReportTheft } from './LocalTheft';
import { currentPoint, type FixFailure } from './geolocation';
import { speciesLabel } from './AnimalsScreen';

/** A farm-local day (YYYY-MM-DD) as the midday instant of that day, so the zone cannot shift it. */
function dayToInstant(day: string): Date {
  return new Date(`${day}T12:00:00.000Z`);
}

/** A trimmed field, or null. The wire contract is "a fact or nothing" — never an empty string. */
function factOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function ReportTheftScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const navigate = useNavigate();
  const report = useReportTheft();
  const camps = useLandUnits();
  const labels = useAnimalLabels();
  const live = useEffectiveAnimals().filter((a) => a.status === 'alive');

  const [discoveredDay, setDiscoveredDay] = useState(farmToday);
  const [lastSeenDay, setLastSeenDay] = useState(farmToday);
  const [headCount, setHeadCount] = useState('');
  const [landUnitId, setLandUnitId] = useState('');
  const [selectedAnimals, setSelectedAnimals] = useState<ReadonlySet<string>>(() => new Set());
  const [caseNumber, setCaseNumber] = useState('');
  const [station, setStation] = useState('');
  const [observations, setObservations] = useState('');
  const [locating, setLocating] = useState(false);
  const [fixFailed, setFixFailed] = useState<FixFailure | null>(null);

  if (!activeFarm) return null;

  const count = Number(headCount);
  const countIsValid = headCount.trim() !== '' && Number.isInteger(count) && count > 0;

  const toggleAnimal = (id: string) => {
    setSelectedAnimals((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    if (!countIsValid) return;

    // The fix is taken at SAVE, not on load: a farmer who opens this screen in the bakkie and then
    // walks to the fence should get the point from where they are standing when they file it.
    //
    // ⭐ A failed fix does NOT file the record silently on the first tap. It names the reason and
    // stops, so the farmer can step into the open and try again — a point is most of what makes
    // this record evidence, and quietly filing one without it, then navigating away, hands over a
    // weaker document with no sign anything was lost. The SECOND tap files it anyway, because
    // refusing outright would lose the report entirely on a phone that simply cannot see the sky.
    let geojson: string | null = null;
    if (fixFailed === null) {
      setLocating(true);
      const fix = await currentPoint();
      setLocating(false);
      if (!fix.ok) {
        setFixFailed(fix.reason);
        return;
      }
      geojson = fix.geojson;
    }

    report({
      id: uuidv7(),
      farmId: activeFarm.id,
      discoveredAt: dayToInstant(discoveredDay),
      lastSeenAt: dayToInstant(lastSeenDay),
      lastSeenLocationGeojson: geojson,
      landUnitId: landUnitId === '' ? null : landUnitId,
      headCount: count,
      caseNumber: factOrNull(caseNumber),
      reportingStation: factOrNull(station),
      observations: factOrNull(observations),
      animalIds: [...selectedAnimals],
    });

    // Straight to the list, where the incident now appears and the evidence pack is offered. A
    // confirmation banner on a form the farmer will not use again is a screen with no way forward.
    navigate('/animals/theft');
  };

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-2 font-ui text-h1 text-soil-900">{t('theft.report.title')}</h1>
      <p className="mb-6 text-body text-soil-700">{t('theft.report.intro')}</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="mb-4 flex flex-col">
          <label htmlFor="discovered" className="mb-1 text-label uppercase text-soil-700">
            {t('theft.discoveredDay')}
          </label>
          <input
            id="discovered"
            name="discovered"
            type="date"
            max={farmToday()}
            value={discoveredDay}
            onChange={(e) => setDiscoveredDay(e.target.value)}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
          />
        </div>

        {/* Asked separately from the discovery day and never defaulted to it: the gap between the
            two IS the window a stock-theft investigation works in. */}
        <div className="mb-4 flex flex-col">
          <label htmlFor="lastSeen" className="mb-1 text-label uppercase text-soil-700">
            {t('theft.lastSeenDay')}
          </label>
          <input
            id="lastSeen"
            name="lastSeen"
            type="date"
            max={farmToday()}
            value={lastSeenDay}
            onChange={(e) => setLastSeenDay(e.target.value)}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
          />
        </div>

        <div className="mb-4 flex flex-col">
          <label htmlFor="headCount" className="mb-1 text-label uppercase text-soil-700">
            {t('theft.headCount')}
          </label>
          <input
            id="headCount"
            name="headCount"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={headCount}
            onChange={(e) => setHeadCount(e.target.value)}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
          />
          {/* The count stands alone: a farm running a flock as a group has stock with no individual
              rows to tick below, and a report that could only name tagged animals would be unusable
              on exactly the farms most exposed to theft. */}
          <p className="mt-1 text-body text-soil-700">{t('theft.headCountHint')}</p>
        </div>

        {camps.length > 0 && (
          <div className="mb-4 flex flex-col">
            <label htmlFor="camp" className="mb-1 text-label uppercase text-soil-700">
              {t('theft.camp')}
            </label>
            <select
              id="camp"
              name="camp"
              value={landUnitId}
              onChange={(e) => setLandUnitId(e.target.value)}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
            >
              <option value="">{t('theft.campNone')}</option>
              {camps.map((camp) => (
                <option key={camp.id} value={camp.id}>
                  {camp.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {live.length > 0 && (
          <fieldset className="mb-4 border-0 p-0">
            <legend className="mb-1 text-label uppercase text-soil-700">
              {t('theft.whichAnimals')}
            </legend>
            <p className="mb-2 text-body text-soil-700">{t('theft.whichAnimalsHint')}</p>
            <ul className="flex list-none flex-col gap-2 p-0">
              {live.map((animal) => {
                const picked = selectedAnimals.has(animal.id);
                return (
                  <li key={animal.id}>
                    <button
                      type="button"
                      aria-pressed={picked}
                      onClick={() => toggleAnimal(animal.id)}
                      className={`flex min-h-touch-min w-full items-center justify-between rounded border p-3 text-left text-body ${
                        picked
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
                      {/* Never colour alone (NFR-411): the selected state is a word, not a tint. */}
                      <span className="text-soil-700">{picked ? t('theft.taken') : ''}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        )}

        {/* ⛔ The line that keeps a name out of the record. Placed immediately above the free-text
            box, because that is the only place a name could get in. */}
        <div className="mb-4 flex flex-col">
          <label htmlFor="observations" className="mb-1 text-label uppercase text-soil-700">
            {t('theft.observations')}
          </label>
          <p className="mb-2 border-l-4 border-soil-200 bg-sand-100 p-3 text-body text-soil-900">
            {t('theft.noSuspects')}
          </p>
          <textarea
            id="observations"
            name="observations"
            rows={4}
            value={observations}
            onChange={(e) => setObservations(e.target.value)}
            className="rounded border border-soil-200 bg-sand-100 px-3 py-2 text-body text-soil-900"
          />
        </div>

        {/* Both optional and both usually unknown at the fence: the case number exists only after
            someone has been to the station. Asked here so a farmer who already has one can put it
            in, never required so that filing has to wait for it. */}
        <div className="mb-4 flex flex-col">
          <label htmlFor="caseNumber" className="mb-1 text-label uppercase text-soil-700">
            {t('theft.caseNumber')}
          </label>
          <input
            id="caseNumber"
            name="caseNumber"
            type="text"
            autoComplete="off"
            value={caseNumber}
            onChange={(e) => setCaseNumber(e.target.value)}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
          />
        </div>

        <div className="mb-6 flex flex-col">
          <label htmlFor="station" className="mb-1 text-label uppercase text-soil-700">
            {t('theft.station')}
          </label>
          <input
            id="station"
            name="station"
            type="text"
            autoComplete="off"
            value={station}
            onChange={(e) => setStation(e.target.value)}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
          />
        </div>

        <p className="mb-4 text-body text-soil-700">{t('theft.gpsExplain')}</p>
        {fixFailed !== null && (
          <>
            {/* Warning FORM — tinted panel with a left rule, never the ochre action shape
                (NFR-411). Each reason gets its own advice; "denied" and "no sky" need different
                things done about them. */}
            <p className="mb-2 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
              {t(`theft.gps.${fixFailed}` as TranslationKey)}
            </p>
            {/* Says what the next tap will do, before it does it. */}
            <p className="mb-4 text-body text-soil-700">{t('theft.gpsRetryHint')}</p>
            <button
              type="button"
              onClick={() => setFixFailed(null)}
              className="mb-2 flex min-h-touch-min w-full items-center justify-center rounded border border-soil-200 px-4 font-ui text-body text-soil-900"
            >
              {t('theft.gpsTryAgain')}
            </button>
          </>
        )}

        <button
          type="submit"
          className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
          disabled={!countIsValid || locating}
        >
          {locating
            ? t('theft.locating')
            : fixFailed === null
              ? t('theft.save')
              : t('theft.saveWithoutPoint')}
        </button>
      </form>

      <Link to="/animals/theft" className="mt-6 inline-block text-body text-dam-700">
        {t('theft.backToIncidents')}
      </Link>
    </section>
  );
}
