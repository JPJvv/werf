/**
 * Onboarding: register a business, its first farm, and what it farms (FR-001, FR-002).
 *
 * One screen, not a wizard. It is a single decision by the farmer — "this is my business,
 * this is my farm, this is what I do" — and every intermediate state is invalid anyway: a
 * business with no farm has no jurisdiction, a farm with no owner is a farm nobody can log
 * into. The API takes it as one call for the same reason.
 *
 * The enterprise choice is the most consequential control in the product. It is what makes
 * the home grid adapt (FR-017) — a cattle farm never renders a Sprays tile — so the copy
 * says plainly that it can be changed later, and nothing here is presented as permanent.
 */

import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ENTERPRISE_TYPES, type EnterpriseType } from '@werf/core';
import { ENTERPRISE_LABELS, PROVINCES } from './farmOptions';
import { useAuth } from './AuthProvider';
import { AuthApiError, NetworkUnavailableError } from './api';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { Field, FieldSet, FormError, PrimaryButton } from './form';
import { Screen } from './SignInScreen';

const MINIMUM_PASSWORD_LENGTH = 12;

export function RegisterScreen() {
  const { register, isAuthenticated } = useAuth();
  // The account's locale is whatever language they onboarded in — it belongs to the USER,
  // never the browser or the farm (a Free State farm is ZA law whatever language its owner
  // reads).
  const { t, locale } = useTranslation();
  const navigate = useNavigate();

  const [businessName, setBusinessName] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [farmName, setFarmName] = useState('');
  const [province, setProvince] = useState(PROVINCES[1]!);
  const [district, setDistrict] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [enterpriseTypes, setEnterpriseTypes] = useState<EnterpriseType[]>([]);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);

  if (isAuthenticated) return <Navigate to="/" replace />;

  const toggleEnterprise = (type: EnterpriseType) => {
    setEnterpriseTypes((current) =>
      current.includes(type) ? current.filter((t2) => t2 !== type) : [...current, type],
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    // Checked here as well as on the server so the farmer is told before a round trip,
    // not because the client is trusted — the same Zod schema rejects both.
    if (enterpriseTypes.length === 0) return setError('onboarding.needEnterprise');
    if (password.length < MINIMUM_PASSWORD_LENGTH) return setError('onboarding.passwordTooShort');

    setError(null);
    setBusy(true);
    try {
      await register({
        business: { name: businessName, registrationNumber: registrationNumber || null },
        farm: {
          name: farmName,
          province,
          district: district || null,
          enterpriseTypes,
        },
        owner: { fullName, email, password, locale, theme: 'light' },
      });
      navigate('/', { replace: true });
    } catch (caught) {
      if (caught instanceof NetworkUnavailableError) setError('auth.signIn.offline');
      else if (caught instanceof AuthApiError && caught.code === 'CONFLICT') {
        setError('onboarding.emailTaken');
      } else setError('auth.signIn.problem');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('onboarding.title')}>
      <form onSubmit={submit} noValidate>
        <FormError messageKey={error} />

        <FieldSet legend={t('onboarding.business.legend')}>
          <Field
            label={t('onboarding.business.name')}
            name="businessName"
            value={businessName}
            onChange={setBusinessName}
            autoComplete="organization"
            required
          />
          <Field
            label={t('onboarding.business.registration')}
            name="registrationNumber"
            value={registrationNumber}
            onChange={setRegistrationNumber}
            className="font-data tabular-nums"
          />
        </FieldSet>

        <FieldSet legend={t('onboarding.farm.legend')}>
          <Field
            label={t('onboarding.farm.name')}
            name="farmName"
            value={farmName}
            onChange={setFarmName}
            required
          />
          <div className="mb-4 flex flex-col">
            <label htmlFor="province" className="mb-1 text-label uppercase text-soil-700">
              {t('onboarding.farm.province')}
            </label>
            <select
              id="province"
              name="province"
              value={province}
              onChange={(event) => setProvince(event.target.value)}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
            >
              {PROVINCES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <Field
            label={t('onboarding.farm.district')}
            name="district"
            value={district}
            onChange={setDistrict}
          />
        </FieldSet>

        <FieldSet legend={t('onboarding.enterprises.legend')}>
          <p className="mb-3 text-body text-soil-700">{t('onboarding.enterprises.hint')}</p>
          <div className="flex flex-col gap-2">
            {ENTERPRISE_TYPES.map((type) => (
              <label
                key={type}
                className="flex min-h-touch-min cursor-pointer items-center gap-3 rounded border border-soil-200 bg-sand-100 p-3 text-soil-900"
              >
                <input
                  type="checkbox"
                  name="enterpriseTypes"
                  value={type}
                  checked={enterpriseTypes.includes(type)}
                  onChange={() => toggleEnterprise(type)}
                  className="h-5 w-5"
                />
                <span className="text-body">{ENTERPRISE_LABELS[type]}</span>
              </label>
            ))}
          </div>
        </FieldSet>

        <FieldSet legend={t('onboarding.owner.legend')}>
          <Field
            label={t('onboarding.owner.name')}
            name="fullName"
            value={fullName}
            onChange={setFullName}
            autoComplete="name"
            required
          />
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
            autoComplete="new-password"
            hint={t('onboarding.passwordTooShort')}
            required
          />
        </FieldSet>

        <PrimaryButton
          busy={busy}
          label={busy ? t('onboarding.working') : t('onboarding.submit')}
        />
      </form>

      <p className="mt-6 text-body text-soil-700">
        {t('onboarding.haveAccount')}{' '}
        <Link to="/sign-in" className="text-soil-900 underline">
          {t('auth.signIn.title')}
        </Link>
      </p>
    </Screen>
  );
}
