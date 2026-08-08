import { useState } from 'react';
import { LOCALES, LOCALE_NAMES, type Locale } from '../i18n/dictionaries';
import { useTranslation } from '../i18n/LocaleProvider';
import { useAuth } from '../auth/AuthProvider';

/**
 * Settings → Language (FR-008). English and Afrikaans in v1, each shown in its own language so
 * a reader recognises their own. Switching is immediate and offline — no language pack to fetch.
 *
 * The change is applied to the running app FIRST and written back to the account second, in that
 * order and never the other way around: a farmer in a dead zone must still be able to read the app
 * in their own language. The write-back is what makes it stick to the PERSON — before it existed,
 * this screen worked until the next cold start, when the boot path re-adopted the account's stored
 * locale and silently undid it. A setting that quietly reverts is worse than one that is missing.
 *
 * When the write-back cannot happen there is no error, because nothing failed that the farmer asked
 * for: the app is in the language they chose. It says what is actually true — this phone is
 * switched, the account will catch up.
 */
export function LanguageSettings() {
  const { locale, setLocale, t } = useTranslation();
  const { saveLocale } = useAuth();
  const [deviceOnly, setDeviceOnly] = useState(false);

  const choose = (next: Locale) => {
    setLocale(next);
    setDeviceOnly(false);
    void saveLocale(next).then((saved) => setDeviceOnly(!saved));
  };

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('settings.language.title')}</h1>
      <fieldset className="flex flex-col gap-3 border-0 p-0">
        <legend className="mb-2 text-label uppercase text-soil-700">
          {t('settings.language.legend')}
        </legend>
        {LOCALES.map((l) => (
          <label
            key={l}
            className="flex min-h-touch-min cursor-pointer items-center gap-3 rounded border border-soil-200 bg-sand-100 p-4 text-soil-900"
          >
            <input
              type="radio"
              name="locale"
              value={l}
              checked={locale === l}
              onChange={() => choose(l)}
              className="h-5 w-5"
            />
            <span className="text-body">{LOCALE_NAMES[l]}</span>
          </label>
        ))}
      </fieldset>

      {deviceOnly && (
        <p
          role="status"
          className="mt-4 border-l-4 border-klei-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          {t('settings.language.deviceOnly')}
        </p>
      )}
    </section>
  );
}
