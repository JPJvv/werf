import { LOCALES, LOCALE_NAMES } from '../i18n/dictionaries';
import { useTranslation } from '../i18n/LocaleProvider';

/**
 * Settings → Language (FR-008). English and Afrikaans in v1, each shown in its own language so
 * a reader recognises their own. Switching is immediate and offline — no language pack to fetch.
 */
export function LanguageSettings() {
  const { locale, setLocale, t } = useTranslation();

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
              onChange={() => setLocale(l)}
              className="h-5 w-5"
            />
            <span className="text-body">{LOCALE_NAMES[l]}</span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}
