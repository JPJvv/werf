/**
 * The language control for the SIGNED-OUT screens (FR-008).
 *
 * It exists because Settings sits behind the auth guard, which left a farmer onboarding on a fresh
 * device able to submit only the default language — an Afrikaans farmer could not create an
 * Afrikaans account, and the first thing the product ever said to them was in the wrong language.
 * Registration submits the live UI locale, so choosing here is what makes the account Afrikaans.
 *
 * Compact by design: two words in a corner, not a settings panel in front of a sign-in form. Each
 * language is named in ITSELF ("Afrikaans", not "Afrikaans (AF)"), because someone who cannot read
 * the current language cannot read a label describing theirs either.
 */

import { LOCALES, LOCALE_NAMES } from './dictionaries';
import { useTranslation } from './LocaleProvider';

export function LanguagePicker() {
  const { locale, setLocale, t } = useTranslation();

  return (
    <nav aria-label={t('settings.language.legend')} className="flex gap-2">
      {LOCALES.map((option) => {
        const active = option === locale;
        return (
          <button
            key={option}
            type="button"
            // The current language is announced, not just shown in a different colour — meaning is
            // never carried by colour alone (NFR-411), and this is a control a farmer uses once.
            aria-current={active ? 'true' : undefined}
            onClick={() => setLocale(option)}
            className={`flex min-h-touch-min items-center rounded px-3 text-body ${
              active ? 'bg-soil-100 font-semibold text-soil-900' : 'text-dam-700'
            }`}
          >
            {LOCALE_NAMES[option]}
          </button>
        );
      })}
    </nav>
  );
}
