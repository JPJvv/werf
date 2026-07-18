import type { HomeTile } from './tiles';

/**
 * One door in the home grid. ≥96px tall (min-h-tile-min), a 1px rule for elevation (no
 * shadows), tokens only. The label is the accessible name; the glyph is decorative and
 * hidden from assistive tech. A tile carries at most ONE live number OR ONE badge — an
 * instrument reading, not a chart. Meaning is never in colour alone, so a badge shows its
 * count as text next to the dot (NFR-411).
 *
 * Live numbers arrive with each module; until then a tile is a labelled door.
 */
export interface TileProps {
  tile: HomeTile;
  /** A single live number, e.g. head of stock. Omitted until the module lands. */
  metric?: string;
  /** An attention count, e.g. treatments due. Rendered as a dot AND the number AND a word. */
  badge?: { count: number; label: string };
}

export function Tile({ tile, metric, badge }: TileProps) {
  return (
    <a
      href={tile.to}
      className="flex min-h-tile-min flex-col items-center justify-center gap-2 rounded border border-soil-200 bg-sand-100 p-4 text-center text-soil-900 no-underline transition-colors duration-fast ease-werf hover:bg-soil-100"
    >
      <span aria-hidden="true" className="text-h1 leading-none">
        {tile.icon}
      </span>
      <span className="text-tile uppercase">{tile.label}</span>
      {metric !== undefined && (
        <span className="font-data text-data-lg tabular-nums text-soil-900">{metric}</span>
      )}
      {metric === undefined && badge !== undefined && (
        <span className="flex items-center gap-2 text-body text-rooigrond-600">
          <span aria-hidden="true">●</span>
          <span className="font-data tabular-nums">{badge.count}</span>
          <span>{badge.label}</span>
        </span>
      )}
    </a>
  );
}
