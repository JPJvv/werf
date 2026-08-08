/**
 * Which farm am I looking at (FR-004).
 *
 * Rendered in the shell header on EVERY screen, and only when the account is on more than one farm.
 * Both halves of that are deliberate. Always visible, because "which farm is this?" is the question
 * behind every number on the screen, and an app that shows a head count without saying whose is an
 * app that will eventually be believed about the wrong farm. Hidden on a single-farm account,
 * because a picker with one option is not a choice — it is furniture, and the reference user has
 * four seconds.
 *
 * A `<select>` rather than a menu: it is a one-of-N choice, the platform already knows how to do it
 * with a thumb, and it needs no state of its own to be wrong about.
 *
 * The switch is instant and offline — `setActiveFarm` changes the device first and tells the server
 * afterwards, best-effort (see AuthProvider). Switching swaps every farm-scoped local store with it,
 * because they are all keyed by the active farm's id: one farm's animals can never appear under
 * another's, which is the client mirror of the RLS boundary.
 */

import { useAuth } from '../auth/AuthProvider';
import { useTranslation } from '../i18n/LocaleProvider';

export function FarmSwitcher() {
  const { t } = useTranslation();
  const { session, activeFarm, setActiveFarm } = useAuth();

  const farms = session?.farms ?? [];
  if (farms.length < 2 || !activeFarm) return null;

  return (
    <div className="flex items-center">
      {/* Named by `aria-label` rather than a visible one: the control needs a name for assistive
          tech, and a "Farm" label above a picker that already says the farm's name is noise for
          everyone else — and header space a phone does not have. */}
      <select
        id="farm-switcher"
        name="farm-switcher"
        aria-label={t('shell.farm')}
        value={activeFarm.id}
        onChange={(e) => setActiveFarm(e.target.value)}
        className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-2 text-body text-soil-900"
      >
        {farms.map((farm) => (
          <option key={farm.id} value={farm.id}>
            {farm.name}
          </option>
        ))}
      </select>
    </div>
  );
}
