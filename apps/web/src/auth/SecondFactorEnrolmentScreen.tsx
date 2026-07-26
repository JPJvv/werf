/**
 * Enrolling the second factor (FR-014, FR-014a) — where an owner or bookkeeper lands
 * because the server refuses every other route until they have one.
 *
 * ⭐ The PASSKEY is offered first, and that ordering is ADR-0007 rather than fashion. A passkey is
 * held by this device, so it works with no signal — which on this product is the ordinary state,
 * not the failure state. It cannot be SIM-swapped, and SIM swap is industrialised in South Africa.
 * And there is nothing to type: a farmer in a crush, in gloves, is not reading a six-digit code off
 * a second phone. TOTP remains the universal fallback and is one tap away, because a great many
 * devices in this market still cannot do WebAuthn — but it is the fallback, not the default.
 *
 * The choice is offered only when the device can actually honour it. Putting a passkey button in
 * front of someone whose browser has no authenticator, and only saying so after they commit, turns
 * a mandatory 2FA screen into a dead end for a user with no other way into their own account.
 *
 * Whichever factor is chosen, the errand ends the same way: the recovery codes, shown exactly once,
 * in the same screen. Splitting that across routes would let someone navigate away between minting
 * the codes and reading them, and we store argon2id hashes and genuinely cannot show them again.
 * A passkey-only owner whose phone drowns has NO other way back in, which is precisely why the
 * codes are minted on this path too and not only alongside TOTP (FR-014a).
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { schemas } from '@werf/core';
import { useAuth } from './AuthProvider';
import { authApi, AuthApiError, NetworkUnavailableError } from './api';
import { createPasskey, deviceLabel, passkeysAvailable } from './passkeys';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { Field, FormError, PrimaryButton } from './form';
import { Screen } from './SignInScreen';

type Stage =
  /** Passkey or authenticator app. Skipped entirely when the device cannot do a passkey. */
  | { name: 'choose' }
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

  // Asked once, before anything is rendered: the answer decides whether there is a choice at all.
  const [canPasskey] = useState(passkeysAvailable);
  const [stage, setStage] = useState<Stage>(() =>
    passkeysAvailable() ? { name: 'choose' } : { name: 'loading' },
  );
  const [code, setCode] = useState('');
  const [error, setError] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);

  const accessToken = session?.accessToken;

  /** A stale cached session that already has a factor: send them on rather than stranding them. */
  const alreadyEnrolled = useCallback(async (): Promise<void> => {
    await refreshSession().catch(() => undefined);
    navigate('/', { replace: true });
  }, [navigate, refreshSession]);

  useEffect(() => {
    if (!accessToken || stage.name !== 'loading') return;
    let cancelled = false;

    void (async () => {
      try {
        const enrolment = await authApi.beginTotpEnrolment(accessToken);
        if (!cancelled) setStage({ name: 'confirm', enrolment });
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof AuthApiError && caught.code === 'CONFLICT') {
          await alreadyEnrolled();
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
    // Keyed on `stage.name`, not on `stage`: the effect SETS the stage when it resolves, so
    // depending on the object would restart the fetch it just finished, forever.
  }, [accessToken, stage.name, alreadyEnrolled]);

  /**
   * The passkey path, end to end: the server's creation options, the device's ceremony, the
   * attestation back for verification. Three failures and only one of them is an error — a
   * cancelled prompt leaves the choice exactly as it was, because someone who tapped the wrong
   * thing has not done anything wrong.
   */
  const enrolPasskey = async () => {
    if (!accessToken) return;
    setError(null);
    setBusy(true);
    try {
      const options = await authApi.beginPasskeyEnrolment(accessToken);
      const result = await createPasskey(options);

      if (!result.ok) {
        if (result.reason === 'cancelled') return; // not an error; the button is still there
        setError(`security.passkey.${result.reason}` as TranslationKey);
        return;
      }

      const { recoveryCodes } = await authApi.confirmPasskeyEnrolment(accessToken, {
        credential: result.credential,
        deviceLabel: deviceLabel(),
      });
      setStage({ name: 'recovery', codes: recoveryCodes });
    } catch (caught) {
      if (caught instanceof AuthApiError && caught.code === 'CONFLICT') {
        await alreadyEnrolled();
        return;
      }
      setError(
        caught instanceof NetworkUnavailableError ? 'auth.signIn.offline' : 'security.enrol.failed',
      );
    } finally {
      setBusy(false);
    }
  };

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

      {stage.name === 'choose' && (
        <>
          {/* The one ochre action on the screen. A passkey is the preferred factor, so it is the
              one that looks like the answer; the app route below it is a border, not a colour. */}
          <button
            type="button"
            onClick={() => void enrolPasskey()}
            disabled={busy}
            className="mb-2 min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
          >
            {busy ? t('security.passkey.waiting') : t('security.passkey.use')}
          </button>
          <p className="mb-6 text-body text-soil-700">{t('security.passkey.why')}</p>

          <button
            type="button"
            onClick={() => setStage({ name: 'loading' })}
            className="flex min-h-touch-min w-full items-center justify-center rounded border border-soil-200 bg-sand-100 px-4 text-body text-soil-900"
          >
            {t('security.passkey.useApp')}
          </button>
        </>
      )}

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

          {/* Back to the choice, but only when there WAS one. A device that cannot do a passkey
              must not be offered a route to a screen with nothing on it. */}
          {canPasskey && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStage({ name: 'choose' });
              }}
              className="mt-4 flex min-h-touch-min w-full items-center justify-center rounded border border-soil-200 bg-sand-100 px-4 text-body text-soil-900"
            >
              {t('security.passkey.back')}
            </button>
          )}
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
