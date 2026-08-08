/**
 * The small form vocabulary the signed-out screens share.
 *
 * Local to `auth/` rather than promoted into `@werf/ui`: two screens is not yet a pattern,
 * and a component library assembled from one use case tends to encode that use case's
 * accidents. It moves up when a third screen wants it.
 *
 * Every control here is at least the minimum touch target and every label is a real
 * `<label>` bound to its input — the reference user is wearing gloves in the sun, and
 * placeholder-as-label disappears the moment they start typing.
 */

import type { ReactNode } from 'react';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';

export interface FieldProps {
  label: string;
  name: string;
  value: string;
  onChange(value: string): void;
  type?: 'text' | 'email' | 'password';
  autoComplete?: string;
  required?: boolean;
  className?: string;
  hint?: string;
}

export function Field({
  label,
  name,
  value,
  onChange,
  type = 'text',
  autoComplete,
  required,
  className = '',
  hint,
}: FieldProps) {
  const hintId = hint ? `${name}-hint` : undefined;

  return (
    <div className="mb-4 flex flex-col">
      <label htmlFor={name} className="mb-1 text-label uppercase text-soil-700">
        {label}
      </label>
      {hint && (
        <span id={hintId} className="mb-2 text-body text-soil-700">
          {hint}
        </span>
      )}
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        aria-describedby={hintId}
        onChange={(event) => onChange(event.target.value)}
        className={`min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900 ${className}`}
      />
    </div>
  );
}

/**
 * The one primary action on the screen. Ochre, because ochre IS the primary action colour
 * — the frontend rules allow exactly one per view, which is why this component exists
 * rather than a `variant` prop that would make two easy to write by accident.
 */
export function PrimaryButton({
  busy,
  label,
  /**
   * Render as a bordered action rather than the filled ochre one.
   *
   * For the screen that offers TWO ways to do the same thing — sign in with a passkey, or type a
   * code — where the ochre budget is one per screen (frontend rules) and it belongs to the
   * preferred route. Two ochre buttons would say both are the answer, which is the state the rule
   * exists to prevent.
   */
  secondary = false,
}: {
  busy: boolean;
  label: string;
  secondary?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={busy}
      className={
        secondary
          ? 'min-h-touch-min w-full rounded border border-soil-200 bg-sand-100 px-4 font-ui text-body text-soil-900 disabled:opacity-60'
          : 'min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60'
      }
    >
      {label}
    </button>
  );
}

/**
 * An error the farmer can act on. `role="alert"` so a screen reader announces it without
 * being asked, and it is a tinted panel with a left rule rather than red text — colour
 * alone is defeated by sun glare (NFR-411).
 */
export function FormError({ messageKey }: { messageKey: TranslationKey | null }) {
  const { t } = useTranslation();
  if (!messageKey) return null;

  return (
    <p
      role="alert"
      className="mb-4 border-l-4 border-rooigrond-600 bg-sand-100 p-3 text-body text-soil-900"
    >
      {t(messageKey)}
    </p>
  );
}

/** A labelled group of related inputs. A real fieldset, so the grouping is announced. */
export function FieldSet({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="mb-6 border-0 p-0">
      <legend className="mb-3 font-ui text-h2 text-soil-900">{legend}</legend>
      {children}
    </fieldset>
  );
}
