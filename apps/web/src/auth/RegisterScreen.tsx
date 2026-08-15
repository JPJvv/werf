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
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [addressLocality, setAddressLocality] = useState('');
  const [addressProvince, setAddressProvince] = useState(PROVINCES[1]!);
  const [addressPostalCode, setAddressPostalCode] = useState('');
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
    if (!contactEmail.trim() && !contactPhone.trim()) {
      return setError('onboarding.needBusinessContact');
    }
    if (!addressLine1.trim() || !addressLocality.trim() || !addressPostalCode.trim()) {
      return setError('onboarding.needBusinessAddress');
    }

    setError(null);
    setBusy(true);
    try {
      await register({
        business: {
          name: businessName,
          registrationNumber: registrationNumber || null,
          contact: {
            email: contactEmail || null,
            phone: contactPhone || null,
          },
          physicalAddress: {
            line1: addressLine1,
            line2: addressLine2 || null,
            locality: addressLocality,
            province: addressProvince,
            postalCode: addressPostalCode,
          },
        },
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
          <Field
            label={t('onboarding.business.contactEmail')}
            name="businessContactEmail"
            type="email"
            value={contactEmail}
            onChange={setContactEmail}
            autoComplete="email"
          />
          <Field
            label={t('onboarding.business.contactPhone')}
            name="businessContactPhone"
            type="tel"
            value={contactPhone}
            onChange={setContactPhone}
            autoComplete="tel"
            className="font-data tabular-nums"
            hint={t('onboarding.business.contactHint')}
          />
          <Field
            label={t('onboarding.business.addressLine1')}
            name="businessAddressLine1"
            value={addressLine1}
            onChange={setAddressLine1}
            autoComplete="address-line1"
            required
          />
          <Field
            label={t('onboarding.business.addressLine2')}
            name="businessAddressLine2"
            value={addressLine2}
            onChange={setAddressLine2}
            autoComplete="address-line2"
          />
          <Field
            label={t('onboarding.business.addressLocality')}
            name="businessAddressLocality"
            value={addressLocality}
            onChange={setAddressLocality}
            autoComplete="address-level2"
            required
          />
          <div className="mb-4 flex flex-col">
            <label
              htmlFor="businessAddressProvince"
              className="mb-1 text-label uppercase text-soil-700"
            >
              {t('onboarding.business.addressProvince')}
            </label>
            <select
              id="businessAddressProvince"
              name="businessAddressProvince"
              value={addressProvince}
              autoComplete="address-level1"
              onChange={(event) => setAddressProvince(event.target.value)}
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
            label={t('onboarding.business.addressPostalCode')}
            name="businessAddressPostalCode"
            value={addressPostalCode}
            onChange={setAddressPostalCode}
            autoComplete="postal-code"
            required
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
