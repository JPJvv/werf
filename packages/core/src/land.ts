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

/**
 * How a block is watered (FR-201). A closed set, not free text: a gloved farmer taps a choice
 * rather than typing one, and a fixed vocabulary is what makes "irrigated blocks" a countable,
 * reportable fact later. Stored in the same `irrigation` `text` column `soil_type` uses — this is
 * an application-level closed set, not a Postgres enum type, so it carries no migration.
 */
export const IRRIGATION_TYPES = [
  'dryland',
  'flood',
  'drip',
  'micro',
  'sprinkler',
  'pivot',
] as const;

export type IrrigationType = (typeof IRRIGATION_TYPES)[number];

export function isIrrigationType(value: string): value is IrrigationType {
  return (IRRIGATION_TYPES as readonly string[]).includes(value);
}
