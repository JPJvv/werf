/**
 * Which devices can open this account (FR-014c) — the passkeys enrolled, add another, revoke one.
 *
 * ⭐ This screen exists for one moment: a phone has been lost or sold, and the person needs the key
 * on it to stop working. That is the whole reason a passkey is LABELLED and the reason there can be
 * more than one — an owner with a single passkey on a single phone has an account that dies with the
 * phone, so "add another" is not a power-user feature, it is the thing that makes the preferred
 * factor safe to prefer (ADR-0007).
 *
 * ⭐ It needs a connection, and it says so plainly rather than failing quietly. Almost nothing else
 * in this product does — but revoking a key is a change to the ACCOUNT, held server-side, and a
 * revocation that sat in an outbox would be a revocation that had not happened while the screen
 * implied it had. That is the one direction this failure must not go.
 *
 * Public keys are never on this screen because they are never sent to it: the list carries a label,
 * when the key was made, and when it was last used. Nothing about a passkey record is secret, which
 * is the point of choosing public-key credentials, but there is also no reason to ship the key.
 */

import { useCallback, useEffect, useState } from 'react';
import type { schemas } from '@werf/core';
import { useAuth } from '../auth/AuthProvider';
import { authApi, AuthApiError, NetworkUnavailableError } from '../auth/api';
import { createPasskey, deviceLabel, passkeysAvailable } from '../auth/passkeys';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { farmDateTime } from '../farmTime';
import { SkeletonList } from '../components/SkeletonList';

export function SecuritySettings() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const accessToken = session?.accessToken;

  const [keys, setKeys] = useState<readonly schemas.PasskeySummary[] | null>(null);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [notice, setNotice] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      setKeys(await authApi.listPasskeys(accessToken));
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof NetworkUnavailableError
          ? 'settings.security.offline'
          : 'settings.security.loadFailed',
      );
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!accessToken) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const options = await authApi.beginPasskeyEnrolment(accessToken);
      const result = await createPasskey(options);
      if (!result.ok) {
        // A cancelled prompt is not an error and gets no red panel; "already enrolled" is an
        // ANSWER — this device is covered — so it is a notice rather than a failure.
        if (result.reason === 'alreadyEnrolled') setNotice('security.passkey.alreadyEnrolled');
        else if (result.reason !== 'cancelled') {
          setError(`security.passkey.${result.reason}` as TranslationKey);
        }
        return;
      }
      await authApi.confirmPasskeyEnrolment(accessToken, {
        credential: result.credential,
        deviceLabel: deviceLabel(),
      });
      setNotice('settings.security.added');
      await load();
    } catch (caught) {
      setError(
        caught instanceof NetworkUnavailableError
          ? 'settings.security.offline'
          : 'settings.security.addFailed',
      );
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (passkey: schemas.PasskeySummary) => {
    if (!accessToken) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await authApi.revokePasskey(accessToken, passkey.id);
      setNotice('settings.security.revoked');
      await load();
    } catch (caught) {
      // The server refuses to remove the LAST factor, and that refusal is its rule rather than
      // ours — an account with no second factor is one the server would lock out of every route
      // anyway. Named specifically, because "add another first" is the action and the generic
      // failure line does not say it.
      setError(
        caught instanceof AuthApiError && caught.status === 409
          ? 'settings.security.lastFactor'
          : caught instanceof NetworkUnavailableError
            ? 'settings.security.offline'
            : 'settings.security.revokeFailed',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="p-4">
      <h1 className="mb-2 font-ui text-h1 text-soil-900">{t('settings.security.title')}</h1>
      <p className="mb-4 text-body text-soil-700">{t('settings.security.body')}</p>

      {error && (
        <p
          role="alert"
          className="mb-4 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900"
        >
          {t(error)}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {t(notice)}
        </p>
      )}

      {keys === null ? (
        <SkeletonList label={t('settings.security.loading')} rows={2} />
      ) : keys.length === 0 ? (
        <p className="mb-4 text-body text-soil-700">{t('settings.security.none')}</p>
      ) : (
        <ul className="mb-6 flex list-none flex-col gap-2 p-0">
          {keys.map((passkey) => (
            <li
              key={passkey.id}
              className="flex min-h-touch-min items-center justify-between gap-3 rounded border border-soil-200 bg-sand-50 p-3"
            >
              <span className="text-body text-soil-900">
                {passkey.deviceLabel ?? t('settings.security.unnamed')}
                <br />
                <span className="text-label text-soil-700">
                  {t('settings.security.lastUsed')}{' '}
                  <span className="font-data tabular-nums">
                    {passkey.lastUsedAt === null
                      ? t('settings.security.never')
                      : farmDateTime(passkey.lastUsedAt)}
                  </span>
                </span>
              </span>
              <button
                type="button"
                onClick={() => void revoke(passkey)}
                disabled={busy}
                className="min-h-touch-min shrink-0 rounded border border-soil-200 bg-sand-100 px-3 font-ui text-body text-soil-900 disabled:opacity-60"
              >
                {t('settings.security.revoke')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Offered only when the device can honour it. A browser with no authenticator gets the
          reason instead of a button that opens a prompt nothing can answer. */}
      {passkeysAvailable() ? (
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy}
          className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
        >
          {busy ? t('security.passkey.waiting') : t('settings.security.add')}
        </button>
      ) : (
        <p className="border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
          {t('security.passkey.unsupported')}
        </p>
      )}
    </section>
  );
}
