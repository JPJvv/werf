/**
 * Enrolling the second factor (FR-014, FR-014a) — where an owner or bookkeeper lands
 * because the server refuses every other route until they have one.
 *
 * Three steps in one screen, because it is one errand: get the seed into an authenticator
 * app, prove it arrived, write the recovery codes down. Splitting it across routes would
 * let a farmer navigate away between generating recovery codes and reading them, and those
 * codes are shown exactly once — we store argon2id hashes and genuinely cannot show them
 * again.
 *
 * No QR code yet. Rendering one needs either a library (bundle) or a hand-rolled encoder,
 * and the `otpauth://` link below does the same job on the device that actually matters:
 * tapping it on the phone opens the authenticator app directly, no camera involved. The
 * secret is also shown in groups for anyone typing it into a desktop app. A scannable QR
 * is a genuine improvement for the office-desktop case and is noted as follow-up.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { schemas } from '@werf/core';
import { useAuth } from './AuthProvider';
import { authApi, AuthApiError, NetworkUnavailableError } from './api';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { Field, FormError, PrimaryButton } from './form';
import { Screen } from './SignInScreen';

type Stage =
  | { name: 'loading' }
  | { name: 'confirm'; enrolment: schemas.TotpEnrolmentStartResponse }
  // `codes: null` is the account that already had recovery codes from an earlier factor.
  // The distinction is the whole point: showing an empty list would read as "you have
  // none", when in fact the page in the safe is still the live one.
  | { name: 'recovery'; codes: string[] | null };

export function SecondFactorEnrolmentScreen() {
  const { session, signOut, refreshSession } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [stage, setStage] = useState<Stage>({ name: 'loading' });
  const [code, setCode] = useState('');
  const [error, setError] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);

  const accessToken = session?.accessToken;

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    void (async () => {
      try {
        const enrolment = await authApi.beginTotpEnrolment(accessToken);
        if (!cancelled) setStage({ name: 'confirm', enrolment });
      } catch (caught) {
        if (cancelled) return;
        // A CONFLICT means a factor is already enrolled — the cached session was simply
        // stale. Re-reading it sends them on rather than stranding them here.
        if (caught instanceof AuthApiError && caught.code === 'CONFLICT') {
          await refreshSession().catch(() => undefined);
          navigate('/', { replace: true });
          return;
        }
        setError(
          caught instanceof NetworkUnavailableError
            ? 'auth.signIn.offline'
            : 'security.enrol.failed',
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken, navigate, refreshSession]);

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken || stage.name !== 'confirm') return;

    setError(null);
    setBusy(true);
    try {
      const { recoveryCodes } = await authApi.confirmTotpEnrolment(accessToken, code);
      setStage({ name: 'recovery', codes: recoveryCodes });
    } catch (caught) {
      setError(
        caught instanceof NetworkUnavailableError
          ? 'auth.signIn.offline'
          : 'auth.secondFactor.failed',
      );
    } finally {
      setBusy(false);
    }
  };

  /** Only reachable once the codes have been shown. Re-reads the now-satisfied session. */
  const finish = async () => {
    setBusy(true);
    try {
      await refreshSession();
      navigate('/', { replace: true });
    } catch {
      setError('security.enrol.failed');
    } finally {
      setBusy(false);
    }
  };

  if (stage.name === 'recovery') {
    const codes = stage.codes;
    return (
      <Screen title={t(codes ? 'security.recovery.title' : 'security.recovery.keptTitle')}>
        <p className="mb-4 text-body text-soil-900">
          {t(codes ? 'security.recovery.body' : 'security.recovery.keptBody')}
        </p>
        {codes && (
          <ul className="mb-4 grid list-none grid-cols-2 gap-2 p-0">
            {codes.map((recoveryCode) => (
              <li
                key={recoveryCode}
                className="rounded border border-soil-200 bg-sand-100 p-3 text-center font-data text-data tabular-nums text-soil-900"
              >
                {recoveryCode}
              </li>
            ))}
          </ul>
        )}
        <p className="mb-6 border-l-4 border-klei-700 bg-sand-100 p-3 text-body text-soil-900">
          {t(codes ? 'security.recovery.warning' : 'security.recovery.keptWarning')}
        </p>
        <button
          type="button"
          onClick={() => void finish()}
          disabled={busy}
          className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
        >
          {t(codes ? 'security.recovery.done' : 'security.recovery.keptDone')}
        </button>
      </Screen>
    );
  }

  return (
    <Screen title={t('security.enrol.title')}>
      <p className="mb-4 text-body text-soil-900">{t('security.enrol.body')}</p>
      <FormError messageKey={error} />

      {stage.name === 'confirm' && (
        <>
          <ol className="mb-4 flex list-decimal flex-col gap-2 pl-5 text-body text-soil-900">
            <li>{t('security.enrol.step1')}</li>
            <li>{t('security.enrol.step2')}</li>
          </ol>

          <a
            href={stage.enrolment.uri}
            className="mb-4 flex min-h-touch-min items-center justify-center rounded border border-soil-200 bg-sand-100 px-4 text-body text-soil-900 no-underline"
          >
            {t('security.enrol.openApp')}
          </a>

          <p className="mb-1 text-label uppercase text-soil-700">{t('security.enrol.secret')}</p>
          <p className="mb-6 select-all break-all rounded border border-soil-200 bg-sand-100 p-3 font-data text-data tabular-nums text-soil-900">
            {groupSecret(stage.enrolment.secret)}
          </p>

          <form onSubmit={confirm} noValidate>
            <Field
              label={t('auth.secondFactor.code')}
              name="code"
              value={code}
              onChange={setCode}
              autoComplete="one-time-code"
              className="font-data tabular-nums"
              required
            />
            <PrimaryButton busy={busy} label={t('security.enrol.confirm')} />
          </form>
        </>
      )}

      <button
        type="button"
        onClick={() => void signOut()}
        className="mt-6 flex min-h-touch-min w-full items-center justify-center rounded border border-soil-200 bg-sand-100 px-4 text-body text-soil-900"
      >
        {t('security.signOut')}
      </button>
    </Screen>
  );
}

/**
 * Base32 in groups of four. A 32-character run of letters is unreadable and mistyped;
 * the grouping is the same reason a bank card is printed in fours.
 */
function groupSecret(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? [secret]).join(' ');
}
