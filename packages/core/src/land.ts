/**
 * Land unit kinds. A camp (livestock) and a block (crops) are one concept wearing two
 * words — the same fenced piece of ground — and the terminology layer decides which word
 * the farmer sees (FR-150, ADR-0004). 'other' is land that is neither grazing nor cropping:
 * a shed, a dam, a homestead.
 *
 * Values match the Postgres `land_unit_kind` enum exactly. Order here is the canonical DB
 * order, not a display order.
 */

export const LAND_UNIT_KINDS = ['camp', 'block', 'other'] as const;

export type LandUnitKind = (typeof LAND_UNIT_KINDS)[number];

export function isLandUnitKind(value: string): value is LandUnitKind {
  return (LAND_UNIT_KINDS as readonly string[]).includes(value);
}
