/**
 * Animal vocabulary (Phase 2). One species-agnostic model — cattle, sheep, goats, pigs,
 * poultry, game all live in one `animals` table (ADR-0004); species-specific data goes in
 * validated JSONB, never a column per species.
 *
 * `status`, `sex`, and identifier `type` are Postgres enums, so these arrays MUST match the
 * enum values exactly (the DB half is generated from them in @werf/db). `species` is
 * deliberately NOT an enum — it is `text` in the DB so a farm adding ostriches or bees needs
 * no migration — but we still validate it against the species we support, in one place.
 */

/**
 * Life status. Only 'alive' counts as live stock (FR-105); a dead/sold/culled/missing animal
 * is retained forever for audit and traceability but excluded from live counts and reports.
 * Conflict resolution treats this as a state machine (db.md): dead > sold > culled > missing >
 * alive, so an offline "sold" never overwrites a later, more-final "dead".
 */
export const ANIMAL_STATUSES = ['alive', 'sold', 'dead', 'missing', 'culled'] as const;
export type AnimalStatus = (typeof ANIMAL_STATUSES)[number];

export function isAnimalStatus(value: string): value is AnimalStatus {
  return (ANIMAL_STATUSES as readonly string[]).includes(value);
}

/** 'castrated' is a first-class value: an ox/wether/barrow is neither male nor female for herd purposes. */
export const ANIMAL_SEXES = ['male', 'female', 'castrated', 'unknown'] as const;
export type AnimalSex = (typeof ANIMAL_SEXES)[number];

export function isAnimalSex(value: string): value is AnimalSex {
  return (ANIMAL_SEXES as readonly string[]).includes(value);
}

/**
 * Identifier kinds an animal can carry at once (FR-109): a visual ear tag, an electronic id
 * (EID/RFID), a brand, a tattoo, a national LITS-SA id. Unique per farm per type.
 */
export const IDENTIFIER_TYPES = [
  'visual_tag',
  'eid',
  'brand',
  'tattoo',
  'national_id',
  'other',
] as const;
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];

export function isIdentifierType(value: string): value is IdentifierType {
  return (IDENTIFIER_TYPES as readonly string[]).includes(value);
}

/**
 * Species we support today. Stored as `text` (not a DB enum) so a new species is a code
 * release, not a migration across partitioned farms; validated here so a typo is still caught.
 */
export const SPECIES = ['cattle', 'sheep', 'goat', 'pig', 'poultry', 'game'] as const;
export type Species = (typeof SPECIES)[number];

export function isSpecies(value: string): value is Species {
  return (SPECIES as readonly string[]).includes(value);
}
