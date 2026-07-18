import type { Appearance } from '@werf/ui';
import { useAppearance } from '../theme/useAppearance';

/**
 * Settings → Appearance (FR-016). Three choices. "Match my phone" is the only one that
 * follows the OS, and it is opt-in on purpose — the word "system" never reaches the farmer.
 */
const CHOICES: { value: Appearance; label: string; hint: string }[] = [
  { value: 'light', label: 'Light', hint: 'Best in the sun. The default.' },
  { value: 'dark', label: 'Dark', hint: 'Easier on the eyes at night.' },
  { value: 'system', label: 'Match my phone', hint: 'Follow your phone’s day/night setting.' },
];

export function AppearanceSettings() {
  const { appearance, setAppearance } = useAppearance();

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">Appearance</h1>
      <fieldset className="flex flex-col gap-3 border-0 p-0">
        <legend className="mb-2 text-label uppercase text-soil-700">Theme</legend>
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
              <span className="text-body">{choice.label}</span>
              <span className="text-body text-soil-700">{choice.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}
