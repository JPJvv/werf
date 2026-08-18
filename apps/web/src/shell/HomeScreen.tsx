import { Link } from 'react-router-dom';
import type { EnterpriseType } from '@werf/core';
import { useAuth } from '../auth/AuthProvider';
import { useTranslation } from '../i18n/LocaleProvider';
import { HomeGrid } from '../home/HomeGrid';
import { useHerdSummary, useWithholdingCount } from '../livestock/herd';
import { useResidueRegister } from '../livestock/LocalResidueRegister';
import { useLocalResidueFlags } from '../livestock/residue';
import { usePhiRegister } from '../crops/LocalPhiRegister';
import { useLocalPhiFlags } from '../crops/phiRegister';
import { useLandUnits } from '../land/LocalLand';
import { useSeasonRainfall } from '../rainfall/LocalRainfall';
import { FirstRunGuide } from './FirstRunGuide';
import { useConflictReviews } from '../livestock/LocalConflictReviews';

/**
 * The home screen: the enterprise-adaptive grid for the farm this session is looking at
 * (FR-004, FR-017).
 *
 * The farm comes from the signed-in session, which the auth provider read out of the local
 * store during its first render — so this renders on a cold start with no signal, which is
 * exactly why the farm list is cached alongside the tokens (FR-006).
 */
export function HomeScreen() {
  const { activeFarm } = useAuth();
  const { t } = useTranslation();
  // Live head from the local herd (FR-017/705). Called unconditionally to satisfy the rules of
  // hooks; it reads the farm-scoped store the shell provides and updates the instant an animal
  // is captured. Zero on a new farm is the honest number, not a blank.
  const herd = useHerdSummary();
  // FR-017: every tile that CAN carry a true number does. The ones that cannot yet carry none —
  // an empty tile is honest, and a tile carrying a number the app cannot actually compute is the
  // failure the requirement exists to prevent. See `useWithholdingCount`.
  const withholding = useWithholdingCount();
  const camps = useLandUnits();
  const seasonRain = useSeasonRainfall();
  // FR-131. The register is deliberately not a tile: the grid is generated from the farm's
  // enterprise types and its order is fixed, and this belongs to no enterprise — everything that
  // left the herd is in scope. It is counted across BOTH sources for the same reason the screen
  // renders both: the server knows about the other phone's dip, and only this device knows about
  // the capture it made twenty minutes ago in a dead zone. Deduplicated on the event id, because a
  // row present in both is one thing that happened, not two.
  const server = useResidueRegister();
  const localFlags = useLocalResidueFlags();
  const conflictReviews = useConflictReviews();
  const residueAttention = new Set([
    ...server.map((f) => f.eventId),
    ...localFlags.map((f) => f.eventId),
  ]).size;
  // 4d·6, the identical shape one food-safety register over — see `AttentionScreen.tsx`'s own note.
  const phiServer = usePhiRegister();
  const phiLocal = useLocalPhiFlags();
  const phiAttention = new Set([
    ...phiServer.map((f) => f.eventId),
    ...phiLocal.map((f) => f.eventId),
  ]).size;
  const needsAttention = residueAttention + phiAttention + conflictReviews.length;

  // A signed-in user with no farm is not a state the product can reach: registration
  // creates a business and its first farm in one transaction, and Phase 1 cannot delete a
  // farm. Rendering nothing is the honest answer to an impossible state — better than
  // inventing a placeholder that looks like a real farm.
  if (!activeFarm) return null;

  const enterpriseTypes = activeFarm.enterpriseTypes as EnterpriseType[];

  return (
    <>
      <HomeGrid
        farmName={activeFarm.name}
        enterpriseTypes={enterpriseTypes}
        metrics={{
          animals: String(herd.liveTotal),
          land: String(camps.length),
        }}
        // A badge, not a metric: animals inside a withholding are an ATTENTION state, not a
        // measurement, and the form has to say so on its own (NFR-411 — never colour alone).
        badges={
          withholding > 0 ? { health: { count: withholding, label: t('tile.withholding') } } : {}
        }
      />
      {/* Rainfall (FR-213) is reached from here, as a SECONDARY link and never as a tile. The
          grid's tile set and order are fixed — muscle memory is its entire value — and rain is a
          farm fact that belongs to no enterprise, so it has no tile to live in. A plain link keeps
          the ochre action budget (one per screen) intact too. */}
      <p className="px-4 pb-2">
        <Link to="/rainfall" className="text-body text-dam-700">
          {t('rain.record')}
        </Link>
        {/* The season total, beside the link rather than on a tile: rain belongs to no enterprise
            so it has no tile, but "how much have we had this season" is the question a farmer asks
            every time they think about it, and a number they have to open a screen to see is a
            number they stop checking. */}
        {seasonRain > 0 && (
          <span className="ml-3 text-body text-soil-700">
            <span className="font-data tabular-nums text-soil-900">{seasonRain}</span>{' '}
            {t('rain.mmUnit')} {t('rain.season')}
          </span>
        )}
      </p>

      {/* Shown ONLY when there is something on it. A permanent link reading "Needs your attention"
          next to a zero teaches people it never means anything, and then the one week it does mean
          something they walk past it. Absent is the honest state for an empty register. */}
      {needsAttention > 0 && (
        <p className="px-4 pb-2">
          <Link to="/attention" className="text-body text-dam-700">
            {t('residue.link')}
          </Link>
          <span className="ml-3 text-body text-soil-700">
            <span className="font-data tabular-nums text-soil-900">{needsAttention}</span>
          </span>
        </p>
      )}
      <FirstRunGuide enterpriseTypes={enterpriseTypes} />
    </>
  );
}
