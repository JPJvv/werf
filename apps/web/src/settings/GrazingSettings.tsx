/**
 * Settings → Grazing (FR-152, 4e·2). The rest-period WARNING threshold — an agronomic
 * per-farm preference the owner sets, never a literal in code. See `grazing.ts`'s
 * `isRestPeriodPremature` for where this number is actually used, and `phase-checklists.md`
 * 4e·2 for why it lives outside `regulatory_rates` (ADR-0006's boundary between law and
 * veld-management judgement).
 *
 * Online-only, like `FarmsSettings.tsx`'s own farm-configuration edits (`updateEnterpriseTypes`'s
 * precedent) — this changes what every device on the farm warns against, so a change made on one
 * phone in a dead zone would silently diverge from what a co-worker's phone shows until it could
 * reach the server anyway. Unlike `LanguageSettings.tsx`'s locale, there is no honest "device
 * only, will catch up" story for a shared farm setting.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from '../i18n/LocaleProvider';
import { useAuth } from '../auth/AuthProvider';
import { useSyncStatus } from '../sync/useSyncStatus';

export function GrazingSettings() {
  const { t } = useTranslation();
  const { activeFarm, saveRestPeriodDays } = useAuth();
  const online = useSyncStatus().status !== 'offline';
  const isOwner = activeFarm?.role === 'owner';

  const [days, setDays] = useState(() => activeFarm?.restPeriodDays?.toString() ?? '');
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);

  // Re-seed the field whenever the COMMITTED value changes — a farm switch while parked on this
  // screen, or this device's own save landing. `setDays` inside `submit` never runs directly; the
  // committed value flowing back through `activeFarm` is what the field always reflects. Does NOT
  // touch `saved`/`failed`: this effect fires as part of the very save it would be reporting on
  // (a successful save patches `activeFarm.restPeriodDays`, re-firing this effect before the
  // caller's own `setSaved(true)` runs), and clearing them here would race the confirmation banner
  // this screen is trying to show.
  useEffect(() => {
    setDays(activeFarm?.restPeriodDays?.toString() ?? '');
  }, [activeFarm?.id, activeFarm?.restPeriodDays]);

  // A SEPARATE effect, keyed on the farm's id alone: a genuine farm switch (id changes) must clear
  // a stale "Saved"/failure banner left over from the PREVIOUS farm, but this device's own
  // successful save (id unchanged, only `restPeriodDays` changes) must not — that is the exact
  // race the effect above avoids, and folding this into it would reopen it from the other side.
  useEffect(() => {
    setSaved(false);
    setFailed(false);
  }, [activeFarm?.id]);

  if (!activeFarm) return null;

  const trimmed = days.trim();
  const parsed = trimmed === '' ? null : Number.parseInt(trimmed, 10);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed > 0);
  const blocked = !isOwner || !online || working || !valid;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (blocked) return;
    setWorking(true);
    setFailed(false);
    setSaved(false);
    const ok = await saveRestPeriodDays(parsed);
    setWorking(false);
    if (ok) setSaved(true);
    else setFailed(true);
  };

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('settings.grazing.title')}</h1>
      <p className="mb-4 text-body text-soil-700">{t('settings.grazing.intro')}</p>

      {!isOwner ? (
        <p className="text-body text-soil-700">{t('settings.grazing.notOwner')}</p>
      ) : (
        <form onSubmit={(e) => void submit(e)}>
          {!online && (
            <p className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
              {t('settings.grazing.needsSignal')}
            </p>
          )}

          <div className="mb-4 flex flex-col">
            <label htmlFor="rest-period-days" className="mb-1 text-label uppercase text-soil-700">
              {t('settings.grazing.label')}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="rest-period-days"
                name="rest-period-days"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={days}
                onChange={(e) => {
                  setSaved(false);
                  setFailed(false);
                  setDays(e.target.value);
                }}
                className="min-h-touch-min w-32 rounded border border-soil-200 bg-sand-100 px-3 font-data text-body tabular-nums text-soil-900"
              />
              <span className="text-body text-soil-700">{t('land.grazing.restTargetUnit')}</span>
            </div>
          </div>

          {saved && (
            <p
              role="status"
              className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
            >
              {t('settings.grazing.saved')}
            </p>
          )}
          {failed && (
            <p className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
              {t('settings.grazing.failed')}
            </p>
          )}

          <button
            type="submit"
            disabled={blocked}
            className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
          >
            {working ? t('onboarding.working') : t('settings.grazing.save')}
          </button>
        </form>
      )}
    </section>
  );
}
