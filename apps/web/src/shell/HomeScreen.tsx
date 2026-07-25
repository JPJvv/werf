import { Link } from 'react-router-dom';
import type { EnterpriseType } from '@werf/core';
import { useAuth } from '../auth/AuthProvider';
import { useTranslation } from '../i18n/LocaleProvider';
import { HomeGrid } from '../home/HomeGrid';
import { useHerdSummary, useWithholdingCount } from '../livestock/herd';
import { useLandUnits } from '../land/LocalLand';
import { useSeasonRainfall } from '../rainfall/LocalRainfall';
import { FirstRunGuide } from './FirstRunGuide';

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
      <FirstRunGuide enterpriseTypes={enterpriseTypes} />
    </>
  );
}
