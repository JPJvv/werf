import type { EnterpriseType } from '@werf/core';
import { homeTiles, type HomeTileKey } from './tiles';
import { Tile } from './Tile';

/**
 * The home screen: the whole product, visible at once, as a grid of doors GENERATED from
 * the farm's enterprise types (FR-017). Density, not difficulty, changes with screen size —
 * 2 columns on a phone, 3 on a tablet, 4 on a desktop — same tiles, same vocabulary.
 *
 * This component holds no tile list of its own; it asks homeTiles() what this farm should
 * see. A hardcoded array here would be the bug the frontend rules call out.
 */
export interface HomeGridProps {
  farmName: string;
  enterpriseTypes: readonly EnterpriseType[];
  /**
   * One live number per tile, by tile key — the FR-017 instrument readings. A tile with no
   * entry is a plain labelled door; the modules fill these in as they land.
   */
  metrics?: Partial<Record<HomeTileKey, string>>;
  /**
   * An ATTENTION count per tile — something needing action, not something being measured. Kept
   * separate from `metrics` because the two are different statements: "42 head" is the farm, and
   * "3 withholding" is a thing to do something about. A tile shows at most one of them (FR-017),
   * and the badge renders as a dot AND a number AND a word, never colour alone (NFR-411).
   */
  badges?: Partial<Record<HomeTileKey, { count: number; label: string }>>;
}

export function HomeGrid({ farmName, enterpriseTypes, metrics, badges }: HomeGridProps) {
  const tiles = homeTiles(enterpriseTypes);

  return (
    <section aria-label={`${farmName} home`} className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{farmName}</h1>
      <ul className="grid list-none grid-cols-2 gap-3 p-0 md:grid-cols-3 lg:grid-cols-4">
        {tiles.map((tile) => {
          const metric = metrics?.[tile.key];
          const badge = badges?.[tile.key];
          // Omit the props entirely when there is nothing to show (exactOptionalPropertyTypes):
          // a tile with neither is a plain door, not one carrying `undefined`.
          // A badge WINS over a metric where a tile has both, because something needing attention
          // outranks something being measured — that is what makes the grid an instrument panel.
          return (
            <li key={tile.key}>
              {badge ? (
                <Tile tile={tile} badge={badge} />
              ) : metric ? (
                <Tile tile={tile} metric={metric} />
              ) : (
                <Tile tile={tile} />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
