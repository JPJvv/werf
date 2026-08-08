/**
 * Sign in (FR-006), including the second-factor step (FR-014).
 *
 * Two states in one screen rather than two routes: the challenge token lives in component
 * state and must not survive a navigation, a reload, or a back button. Putting the second
 * factor on its own URL would invite exactly that.
 */

import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { schemas } from '@werf/core';
import { useAuth } from './AuthProvider';
import { authApi, AuthApiError, NetworkUnavailableError } from './api';
import { passkeysAvailable, usePasskey } from './passkeys';
import { useTranslation } from '../i18n/LocaleProvider';
import { LanguagePicker } from '../i18n/LanguagePicker';
import type { TranslationKey } from '../i18n/dictionaries';
import { Field, FormError, PrimaryButton } from './form';

export function SignInScreen() {
  const { signIn, completeSecondFactor, completeSecondFactorWithPasskey, isAuthenticated } =
    useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<schemas.SecondFactorRequired | null>(null);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);

  const destination = (location.state as { from?: string } | null)?.from ?? '/';
  if (isAuthenticated) return <Navigate to={destination} replace />;

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await signIn({ email, password, deviceLabel: null });
      if ('secondFactorRequired' in result) {
        setChallenge(result);
        // The password is no longer needed and should not sit in memory through the
        // second step.
        setPassword('');
      } else {
        navigate(destination, { replace: true });
      }
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  };

  const submitSecondFactor = async (event: FormEvent) => {
    event.preventDefault();
    if (!challenge) return;
    setError(null);
    setBusy(true);
    try {
      await completeSecondFactor({
        challengeToken: challenge.challengeToken,
        method: useRecoveryCode ? 'recovery_code' : 'totp',
        code,
      });
      navigate(destination, { replace: true });
    } catch (caught) {
      // The challenge is spent on any attempt, right or wrong, so a failure sends the
      // farmer back to the password rather than letting them retype a code against a
      // token the server has already discarded.
      setChallenge(null);
      setCode('');
      setError(
        caught instanceof AuthApiError && caught.code === 'SESSION_INVALID'
          ? 'auth.secondFactor.expired'
          : 'auth.secondFactor.failed',
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * Satisfy the second factor with a passkey — the preferred route (ADR-0007), and the only one
   * that asks the farmer to read nothing off a second screen.
   *
   * A CANCELLED ceremony leaves the challenge intact and the form exactly as it was: the person
   * dismissed a prompt, which is not a failed attempt and must not cost them the token. Anything
   * else spends the challenge server-side, so it clears the same way a wrong code does.
   */
  const submitPasskey = async () => {
    if (!challenge) return;
    setError(null);
    setBusy(true);
    try {
      const options = await authApi.passkeyChallenge(challenge.challengeToken);
      const result = await usePasskey(options);
      if (!result.ok) {
        if (result.reason !== 'cancelled') {
          setError(`security.passkey.${result.reason}` as TranslationKey);
        }
        return;
      }
      await completeSecondFactorWithPasskey({
        challengeToken: challenge.challengeToken,
        credential: result.credential,
      });
      navigate(destination, { replace: true });
    } catch (caught) {
      setChallenge(null);
      setCode('');
      setError(
        caught instanceof AuthApiError && caught.code === 'SESSION_INVALID'
          ? 'auth.secondFactor.expired'
          : 'auth.secondFactor.failed',
      );
    } finally {
      setBusy(false);
    }
  };

  if (challenge) {
    const canPasskey = challenge.methods.includes('passkey') && passkeysAvailable();
    return (
      <Screen title={t('auth.secondFactor.title')}>
        <p className="mb-4 text-body text-soil-700">
          {t(useRecoveryCode ? 'auth.secondFactor.recoveryBody' : 'auth.secondFactor.body')}
        </p>

        {/* Offered ONLY when the account has a passkey enrolled AND this device can use one. The
            first half is the server's answer, the second is the browser's, and both have to be
            true — a button that opens a prompt nothing can answer is worse than no button. */}
        {canPasskey && (
          <>
            <button
              type="button"
              onClick={() => void submitPasskey()}
              disabled={busy}
              className="mb-2 min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
            >
              {busy ? t('security.passkey.waiting') : t('auth.secondFactor.usePasskey')}
            </button>
            <p className="mb-6 text-body text-soil-700">{t('auth.secondFactor.orCode')}</p>
          </>
        )}

        <form onSubmit={submitSecondFactor} noValidate>
          <FormError messageKey={error} />
          <Field
            label={t(
              useRecoveryCode ? 'auth.secondFactor.recoveryLabel' : 'auth.secondFactor.code',
            )}
            name="code"
            value={code}
            onChange={setCode}
            autoComplete="one-time-code"
            // A code is an identifier, so it gets the data font and tabular figures —
            // the signature rule in the frontend rules.
            className="font-data tabular-nums"
            required
          />
          <PrimaryButton busy={busy} label={t('auth.secondFactor.submit')} secondary={canPasskey} />
        </form>
        {challenge.methods.includes('recovery_code') && (
          <button
            type="button"
            onClick={() => {
              setUseRecoveryCode((current) => !current);
              setCode('');
            }}
            className="mt-4 flex min-h-touch-min items-center text-body text-soil-700 underline"
          >
            {t(useRecoveryCode ? 'auth.secondFactor.useCode' : 'auth.secondFactor.useRecovery')}
          </button>
        )}
      </Screen>
    );
  }

  return (
    <Screen title={t('auth.signIn.title')}>
      <form onSubmit={submitPassword} noValidate>
        <FormError messageKey={error} />
        <Field
          label={t('auth.signIn.email')}
          name="email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="username"
          required
        />
        <Field
          label={t('auth.signIn.password')}
          name="password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
        />
        <PrimaryButton
          busy={busy}
          label={busy ? t('auth.signIn.working') : t('auth.signIn.submit')}
        />
      </form>
      <p className="mt-6 text-body text-soil-700">
        {t('auth.signIn.noAccount')}{' '}
        <Link to="/register" className="text-soil-900 underline">
          {t('auth.signIn.register')}
        </Link>
      </p>
    </Screen>
  );
}

function messageFor(caught: unknown): TranslationKey {
  if (caught instanceof NetworkUnavailableError) return 'auth.signIn.offline';
  if (caught instanceof AuthApiError && caught.code === 'INVALID_CREDENTIALS') {
    return 'auth.signIn.failed';
  }
  return 'auth.signIn.problem';
}

/** The shared frame for the signed-out screens: centred, single column, nothing else. */
/**
 * The frame every signed-out screen shares. The language picker lives HERE, so it is on sign-in,
 * on registration and on the second-factor step without any of them having to remember it — and so
 * a farmer can switch the language of the very first screen they ever see (FR-008).
 */
export function Screen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-sand-50 px-4 py-8 text-soil-900">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-6 flex items-center justify-between">
          <p className="font-ui text-h2 text-soil-900">Werf</p>
          <LanguagePicker />
        </div>
        <h1 className="mb-4 font-ui text-h1 text-soil-900">{title}</h1>
        {children}
      </div>
    </main>
  );
}
