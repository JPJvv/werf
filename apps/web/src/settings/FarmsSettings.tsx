/**
 * The farms this business runs, and adding another (FR-004).
 *
 * It lives in Settings rather than on the home grid because adding a farm is a rare, deliberate act
 * — it happens when a business buys ground, not in a crush — and the grid's fixed tile set is
 * muscle memory that a once-a-decade action has no claim on.
 *
 * ⭐ This is one of the very few screens in the app that HONESTLY REQUIRES A CONNECTION, and it says
 * so rather than pretending. A farm is a tenancy root: RLS policies, memberships and every
 * farm-scoped store hang off its id. Minting one offline would create a farm no server has agreed
 * to, with captures already filed under it — and the reconciliation for that is not "sync", it is a
 * support ticket. Everywhere the app CAN work offline it does; here it explains why it cannot,
 * which is the difference between a limitation and a bug.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { ENTERPRISE_TYPES, type EnterpriseType } from '@werf/core';
import { ENTERPRISE_LABELS, PROVINCES } from '../auth/farmOptions';
import { useTranslation } from '../i18n/LocaleProvider';
import { useAuth } from '../auth/AuthProvider';
import { useSyncStatus } from '../sync/useSyncStatus';

export function FarmsSettings() {
  const { t } = useTranslation();
  const { session, activeFarm, addFarm } = useAuth();
  const online = useSyncStatus().status !== 'offline';

  const [name, setName] = useState('');
  const [province, setProvince] = useState<string>(PROVINCES[1]!);
  const [types, setTypes] = useState<ReadonlySet<EnterpriseType>>(new Set());
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);

  const farms = session?.farms ?? [];
  // Only an OWNER may add a farm to the business, and only a farm whose business this device
  // knows. A session cached before `businessId` existed does not know it yet (see the schema), so
  // the form is not offered rather than being offered and failing.
  const businessId = useMemo(
    () => farms.find((f) => f.role === 'owner' && f.businessId !== null)?.businessId ?? null,
    [farms],
  );

  const toggleType = (type: EnterpriseType) => {
    setFailed(false);
    setTypes((held) => {
      const next = new Set(held);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const blocked = name.trim() === '' || types.size === 0 || !online || working;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (blocked || businessId === null) return;
    setWorking(true);
    setFailed(false);
    try {
      await addFarm({
        businessId,
        name: name.trim(),
        province,
        district: null,
        enterpriseTypes: [...types],
      });
      setName('');
      setTypes(new Set());
    } catch {
      setFailed(true);
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('settings.farms.title')}</h1>

      <ul aria-label={t('settings.farms.title')} className="mb-6 flex list-none flex-col gap-2 p-0">
        {farms.map((farm) => (
          <li
            key={farm.id}
            className="flex items-center justify-between rounded border border-soil-200 bg-sand-100 p-3"
          >
            <span className="text-body text-soil-900">{farm.name}</span>
            <span className="text-body text-soil-700">
              {farm.id === activeFarm?.id ? t('settings.farms.current') : ''}
            </span>
          </li>
        ))}
      </ul>

      {businessId === null ? (
        <p className="text-body text-soil-700">{t('settings.farms.notOwner')}</p>
      ) : (
        <form onSubmit={(e) => void submit(e)}>
          <h2 className="mb-2 font-ui text-h2 text-soil-900">{t('settings.farms.add')}</h2>

          {/* States the situation without blaming the network, and without hiding the form —
              a farmer should be able to see what it will ask for before they go and find signal. */}
          {!online && (
            <p className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
              {t('settings.farms.needsSignal')}
            </p>
          )}

          <div className="mb-4 flex flex-col">
            <label htmlFor="farm-name" className="mb-1 text-label uppercase text-soil-700">
              {t('onboarding.farm.name')}
            </label>
            <input
              id="farm-name"
              name="farm-name"
              type="text"
              autoComplete="off"
              value={name}
              onChange={(e) => {
                setFailed(false);
                setName(e.target.value);
              }}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
            />
          </div>

          <div className="mb-4 flex flex-col">
            <label htmlFor="farm-province" className="mb-1 text-label uppercase text-soil-700">
              {t('onboarding.farm.province')}
            </label>
            <select
              id="farm-province"
              name="farm-province"
              value={province}
              onChange={(e) => setProvince(e.target.value)}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
            >
              {PROVINCES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="mb-6 border-0 p-0">
            <legend className="mb-1 text-label uppercase text-soil-700">
              {t('onboarding.enterprises.legend')}
            </legend>
            <div className="flex flex-wrap gap-2">
              {ENTERPRISE_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={types.has(type)}
                  onClick={() => toggleType(type)}
                  className={`min-h-touch-min rounded border px-3 font-ui text-body ${
                    types.has(type)
                      ? 'border-soil-900 bg-sand-100 text-soil-900'
                      : 'border-soil-200 bg-sand-50 text-soil-900'
                  }`}
                >
                  {ENTERPRISE_LABELS[type]}
                </button>
              ))}
            </div>
          </fieldset>

          {failed && (
            <p className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
              {t('settings.farms.failed')}
            </p>
          )}

          <button
            type="submit"
            disabled={blocked}
            className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
          >
            {working ? t('onboarding.working') : t('settings.farms.add')}
          </button>
        </form>
      )}
    </section>
  );
}
