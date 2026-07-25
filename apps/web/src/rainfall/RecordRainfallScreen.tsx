/**
 * Record rainfall (FR-213) — how much was in the gauge, and when it was read.
 *
 * The reference user here is not in a crush; they are at the gauge by the shed at first light, in
 * the rain, with wet hands. So: one large millimetre field, one ochre action, and a commit that
 * lands LOCALLY and instantly — no network anywhere in `save` (.claude/rules/frontend.md, NFR-007).
 *
 * The DAY is a field rather than an assumption, because the common case is not today. A gauge read
 * on Sunday morning is captured on Monday when the farmer is back at the house, and a rest-period
 * or a season total built on the capture date instead of the reading date is quietly wrong for the
 * rest of the year. `occurredAt` is the reading day; `created_at` (server-side) is when the row was
 * written. They are allowed to differ by a week (CLAUDE.md, § 5).
 */

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { uuidv7 } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import { useAuth } from '../auth/AuthProvider';
import { useRecordRainfall } from './LocalRainfall';

/** Today in the DEVICE's timezone, as YYYY-MM-DD for the date input. The device is on the farm. */
function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * The instant a day's reading happened. For today, that is now — the farmer is standing at the
 * gauge. For an earlier day it is that morning, local time: `YYYY-MM-DDT06:00` with no offset is
 * parsed in the device's zone, which is the farm's zone. Gauges are read at first light.
 */
function readingInstant(day: string): Date {
  return day === today() ? new Date() : new Date(`${day}T06:00`);
}

export function RecordRainfallScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const recordRainfall = useRecordRainfall();

  const [mm, setMm] = useState('');
  const [gauge, setGauge] = useState('');
  const [day, setDay] = useState(today);
  const [savedMm, setSavedMm] = useState<number | null>(null);

  if (!activeFarm) return null;

  // An empty field is not a reading; a typed 0 is. `Number('')` is 0, which is exactly the trap.
  const typed = mm.trim();
  const parsed = typed === '' ? Number.NaN : Number(typed);
  const valid = Number.isFinite(parsed) && parsed >= 0;

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;

    recordRainfall({
      id: uuidv7(),
      farmId: activeFarm.id,
      occurredAt: readingInstant(day),
      mm: parsed,
      ...(gauge.trim() === '' ? {} : { gauge: gauge.trim() }),
    });

    // Kept: the gauge and the day, because a farm with three gauges reads them in one round.
    setMm('');
    setSavedMm(parsed);
  };

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('rain.title')}</h1>

      {savedMm !== null && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          <span className="font-data tabular-nums">{savedMm}</span> {t('rain.mmUnit')}{' '}
          {t('rain.saved')}
        </p>
      )}

      <form onSubmit={save}>
        <div className="mb-4 flex flex-col">
          <label htmlFor="mm" className="mb-1 text-label uppercase text-soil-700">
            {t('rain.mm')}
          </label>
          <input
            id="mm"
            name="mm"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.5"
            value={mm}
            onChange={(e) => {
              setSavedMm(null);
              setMm(e.target.value);
            }}
            className="min-h-touch-primary rounded border border-soil-200 bg-sand-100 px-3 font-data text-h1 tabular-nums text-soil-900"
          />
        </div>

        <div className="mb-4 flex flex-col">
          <label htmlFor="day" className="mb-1 text-label uppercase text-soil-700">
            {t('rain.day')}
          </label>
          <input
            id="day"
            name="day"
            type="date"
            value={day}
            max={today()}
            onChange={(e) => {
              setSavedMm(null);
              setDay(e.target.value);
            }}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 font-data tabular-nums text-body text-soil-900"
          />
        </div>

        <div className="mb-6 flex flex-col">
          <label htmlFor="gauge" className="mb-1 text-label uppercase text-soil-700">
            {t('rain.gauge')}
          </label>
          <input
            id="gauge"
            name="gauge"
            type="text"
            value={gauge}
            onChange={(e) => {
              setSavedMm(null);
              setGauge(e.target.value);
            }}
            className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
          />
        </div>

        <button
          type="submit"
          disabled={!valid}
          className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
        >
          {t('rain.save')}
        </button>
      </form>

      <Link to="/" className="mt-6 inline-block text-body text-dam-700">
        {t('rain.back')}
      </Link>
    </section>
  );
}
