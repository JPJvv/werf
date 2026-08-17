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
import { farmToday } from '../farmTime';
import { useRecordRainfall } from './LocalRainfall';

/** Today ON THE FARM, as YYYY-MM-DD for the date input. Not the device's zone: a tablet left on
 *  UTC would file a first-light reading into the previous rainfall day, and at the July season
 *  boundary into the previous SEASON. Every other capture screen already goes through `farmTime`. */
function today(): string {
  return farmToday();
}

/**
 * The instant a day's reading happened. For today, that is now — the farmer is standing at the
 * gauge. For an earlier day it is midday UTC, which falls unambiguously inside that same day in the
 * farm's zone, so the instant round-trips back through `farmDay` to the day the farmer chose. The
 * clock time carries no meaning for a gauge reading; the DAY is the datum, and it is the one thing
 * a season total must not get wrong.
 */
function readingInstant(day: string): Date {
  return day === today() ? new Date() : new Date(`${day}T12:00:00.000Z`);
}

export function RecordRainfallScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const recordRainfall = useRecordRainfall();

  const [mm, setMm] = useState('');
  const [gauge, setGauge] = useState('');
  const [day, setDay] = useState(today);
  const [savedMm, setSavedMm] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  if (!activeFarm) return null;

  // An empty field is not a reading; a typed 0 is. `Number('')` is 0, which is exactly the trap.
  const typed = mm.trim();
  const parsed = typed === '' ? Number.NaN : Number(typed);
  const valid = Number.isFinite(parsed) && parsed >= 0;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);

    // Not "saved" until the local write is durable (P1.1).
    await recordRainfall({
      id: uuidv7(),
      farmId: activeFarm.id,
      occurredAt: readingInstant(day),
      mm: parsed,
      ...(gauge.trim() === '' ? {} : { gauge: gauge.trim() }),
    });

    // Kept: the gauge and the day, because a farm with three gauges reads them in one round.
    setMm('');
    setSavedMm(parsed);
    setSaving(false);
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
          disabled={!valid || saving}
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
