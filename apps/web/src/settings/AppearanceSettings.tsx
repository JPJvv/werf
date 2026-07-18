import type { Appearance } from '@werf/ui';
import { useAppearance } from '../theme/useAppearance';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';

/**
 * Settings → Appearance (FR-016). Three choices. "Match my phone" is the only one that
 * follows the OS, and it is opt-in on purpose — the word "system" never reaches the farmer.
 * Copy comes from the dictionary so it switches with the language (FR-008).
 */
const CHOICES: { value: Appearance; labelKey: TranslationKey; hintKey: TranslationKey }[] = [
  {
    value: 'light',
    labelKey: 'settings.appearance.light',
    hintKey: 'settings.appearance.light.hint',
  },
  { value: 'dark', labelKey: 'settings.appearance.dark', hintKey: 'settings.appearance.dark.hint' },
  {
    value: 'system',
    labelKey: 'settings.appearance.system',
    hintKey: 'settings.appearance.system.hint',
  },
];

export function AppearanceSettings() {
  const { appearance, setAppearance } = useAppearance();
  const { t } = useTranslation();

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('settings.appearance.title')}</h1>
      <fieldset className="flex flex-col gap-3 border-0 p-0">
        <legend className="mb-2 text-label uppercase text-soil-700">
          {t('settings.appearance.theme')}
        </legend>
        {CHOICES.map((choice) => (
          <label
            key={choice.value}
            className="flex min-h-touch-min cursor-pointer items-center gap-3 rounded border border-soil-200 bg-sand-100 p-4 text-soil-900"
          >
            <input
              type="radio"
              name="appearance"
              value={choice.value}
              checked={appearance === choice.value}
              onChange={() => setAppearance(choice.value)}
              className="h-5 w-5"
            />
            <span className="flex flex-col">
              <span className="text-body">{t(choice.labelKey)}</span>
              <span className="text-body text-soil-700">{t(choice.hintKey)}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}
