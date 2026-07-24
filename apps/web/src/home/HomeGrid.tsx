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
}

export function HomeGrid({ farmName, enterpriseTypes, metrics }: HomeGridProps) {
  const tiles = homeTiles(enterpriseTypes);

  return (
    <section aria-label={`${farmName} home`} className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{farmName}</h1>
      <ul className="grid list-none grid-cols-2 gap-3 p-0 md:grid-cols-3 lg:grid-cols-4">
        {tiles.map((tile) => {
          const metric = metrics?.[tile.key];
          // Omit the prop entirely when there is no number (exactOptionalPropertyTypes):
          // a tile with no metric is a plain door, not one carrying `undefined`.
          return (
            <li key={tile.key}>
              {metric ? <Tile tile={tile} metric={metric} /> : <Tile tile={tile} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
