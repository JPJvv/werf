/**
 * Stock-theft incidents and the evidence pack (FR-603) — COMPLIANCE-GATED (legal-compliance.md
 * § 3.2). The incidents this farm has filed, and the one action that runs off them: generating the
 * single facts-only PDF a farmer hands the SAPS Stock Theft Unit.
 *
 * ⭐ This screen is where the product's two halves are visibly different, and it does not hide it.
 * FILING an incident is a capture: local, instant, works at a cut fence with no signal. GENERATING
 * THE PACK is not and cannot be — the PDF is rendered from the ownership chain and brand register
 * as the SERVER holds them, so until an incident has been sent there is literally nothing to
 * render. Rather than offer a button that fails, the screen states the situation per incident:
 * still to send, or ready. That is the "what happened, why, what now" rule applied to the one place
 * in livestock where the answer genuinely is "you need a signal for this part".
 *
 * ⛔ No suspect appears anywhere on this screen because no suspect exists anywhere in the chain.
 * See `LocalTheft.tsx` and `packages/domain/src/livestock/evidence.ts`.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../i18n/LocaleProvider';
import { useAuth } from '../auth/AuthProvider';
import { NetworkUnavailableError } from '../auth/api';
import { useSentCaptures } from '../sync/Outbox';
import { useLandUnits } from '../land/LocalLand';
import { farmDay } from '../farmTime';
import { useTheftIncidents, type StoredTheftIncident } from './LocalTheft';
import { theftApi } from './theftApi';

/** Why a pack could not be produced. Each needs different words, so they are not collapsed. */
type PackFailure = 'offline' | 'refused';

/**
 * Hand the rendered PDF to the phone. An object URL and a synthetic click is the only way a browser
 * lets a page deliver bytes it fetched with an Authorization header; the URL is revoked immediately
 * after, because it holds the whole document in memory until it is.
 */
function deliverPdf(pdf: Blob, filename: string): void {
  const url = URL.createObjectURL(pdf);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function TheftIncidentsScreen() {
  const { t } = useTranslation();
  const { session, activeFarm } = useAuth();
  const incidents = useTheftIncidents();
  const sent = useSentCaptures();
  const camps = useLandUnits();

  // Per-incident, because a farmer may generate one pack, fail on another, and both answers have to
  // stay on screen next to the incident they belong to.
  const [working, setWorking] = useState<string | null>(null);
  const [failed, setFailed] = useState<Readonly<Record<string, PackFailure>>>({});

  if (!activeFarm) return null;

  const campName = (id: string | null): string | null =>
    id === null ? null : (camps.find((c) => c.id === id)?.name ?? null);

  const generate = async (incident: StoredTheftIncident) => {
    const token = session?.accessToken;
    if (!token) return;
    setWorking(incident.id);
    setFailed(({ [incident.id]: _cleared, ...rest }) => rest);
    try {
      const pdf = await theftApi.generateEvidencePack(incident.id, token);
      deliverPdf(pdf, `evidence-pack-${farmDay(new Date(incident.discoveredAt))}.pdf`);
    } catch (err) {
      // A transport failure and a refusal are different situations needing different next steps:
      // one is "try again where there is signal", the other is "this cannot be produced as it
      // stands". Anything unrecognised — an `AuthApiError`, a bug in `deliverPdf` — counts as a
      // refusal: telling a farmer to go find signal when signal was never the problem sends them
      // on a drive that changes nothing.
      const reason: PackFailure = err instanceof NetworkUnavailableError ? 'offline' : 'refused';
      setFailed((previous) => ({ ...previous, [incident.id]: reason }));
    } finally {
      setWorking(null);
    }
  };

  // Newest first: a farmer opening this screen is almost always dealing with the last thing that
  // happened, not the first. The store is append-only, so this is a copy, never a sort in place.
  const newestFirst = [...incidents].sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt));

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-2 font-ui text-h1 text-soil-900">{t('theft.title')}</h1>
      <p className="mb-6 text-body text-soil-700">{t('theft.intro')}</p>

      {/* The ochre action, once on the screen (frontend.md). Filing is the thing this screen is for;
          generating a pack is a follow-up on a row, and takes the plain bordered form. */}
      <Link
        to="/animals/theft/new"
        className="mb-6 flex min-h-touch-primary w-full items-center justify-center rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action no-underline"
      >
        {t('theft.report')}
      </Link>

      {newestFirst.length === 0 ? (
        <p className="text-body text-soil-700">{t('theft.empty')}</p>
      ) : (
        <ul aria-label={t('theft.title')} className="flex list-none flex-col gap-4 p-0">
          {newestFirst.map((incident) => {
            const isSent = sent.has(incident.id);
            const camp = campName(incident.landUnitId);
            const failure = failed[incident.id];
            return (
              <li
                key={incident.id}
                className="rounded border border-soil-200 bg-sand-50 p-3 text-soil-900"
              >
                <p className="text-body">
                  <span className="font-data tabular-nums">{incident.headCount}</span>{' '}
                  {t('theft.headTaken')}
                </p>
                <p className="text-body text-soil-700">
                  {t('theft.discovered')}{' '}
                  <span className="font-data tabular-nums">
                    {farmDay(new Date(incident.discoveredAt))}
                  </span>
                  {incident.lastSeenAt !== null && (
                    <>
                      {' · '}
                      {t('theft.lastSeen')}{' '}
                      <span className="font-data tabular-nums">
                        {farmDay(new Date(incident.lastSeenAt))}
                      </span>
                    </>
                  )}
                  {camp !== null && ` · ${camp}`}
                </p>
                {incident.caseNumber !== null && (
                  <p className="text-body text-soil-700">
                    {t('theft.caseNumber')}{' '}
                    <span className="font-data tabular-nums text-soil-900">
                      {incident.caseNumber}
                    </span>
                  </p>
                )}
                {/* Named, not assumed. A pack built from an incident with no point is a weaker
                    document, and the farmer should learn that here rather than from the police. */}
                {incident.lastSeenLocationGeojson === null && (
                  <p className="text-body text-soil-700">{t('theft.noPoint')}</p>
                )}

                {isSent ? (
                  <button
                    type="button"
                    onClick={() => void generate(incident)}
                    disabled={working === incident.id}
                    className="mt-3 flex min-h-touch-min w-full items-center justify-center rounded border border-soil-200 px-4 font-ui text-body text-soil-900 disabled:opacity-60"
                  >
                    {working === incident.id ? t('theft.packWorking') : t('theft.pack')}
                  </button>
                ) : (
                  // Not an error and not styled as one: the incident IS saved, and this says what
                  // is true — the part that needs a signal has not happened yet.
                  <p className="mt-3 text-body text-soil-700">{t('theft.packNotYetSent')}</p>
                )}

                {failure !== undefined && (
                  <p className="mt-2 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
                    {t(failure === 'offline' ? 'theft.packOffline' : 'theft.packRefused')}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Link to="/animals" className="mt-6 inline-block text-body text-dam-700">
        {t('theft.back')}
      </Link>
    </section>
  );
}
