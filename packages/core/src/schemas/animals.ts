/**
 * Animal, Mob and AnimalIdentifier entity schemas (Phase 2, FR-101/102/109). Record + new
 * shapes exactly as entities.ts: the record is a persisted row with server-owned audit
 * timestamps; the new shape is what a client composes offline with its own UUIDv7 id.
 *
 * One `animals` table for every species (ADR-0004); species-specific data lives in the
 * `attributes` JSONB, validated per species by AnimalIdentityRules (ADR-0006) in a later
 * slice — this schema validates the shared shape and leaves attributes an open record for now.
 *
 * A mob is the group-only model (FR-102): a smallholder with 300 sheep records "Flock A:
 * 300 head", not 300 rows. Both models coexist; an individual animal may point at a mob.
 */

import { z } from 'zod';
import type { Species } from '../animals';
import {
  animalSexSchema,
  animalStatusSchema,
  auditTimestampsSchema,
  dateSchema,
  identifierTypeSchema,
  speciesSchema,
  timestampSchema,
  uuidSchema,
  uuidV7Schema,
} from './primitives';

// ── Animal ──────────────────────────────────────────────────────────────────
export const animalSchema = z.object({
  id: uuidSchema,
  farmId: uuidSchema,
  /** Financial attribution — which enterprise this animal belongs to (e.g. "Beef cattle"). */
  enterpriseId: uuidSchema.nullable(),
  species: speciesSchema,
  breed: z.string().min(1).nullable(),
  sex: animalSexSchema,
  dob: dateSchema.nullable(),
  /** DOB is often an estimate on extensive farms; the flag keeps "guessed" honest. */
  dobEstimated: z.boolean(),
  status: animalStatusSchema,
  /** When the animal reached its current status (death, sale, cull). Separate from created_at. */
  statusAt: timestampSchema.nullable(),
  damId: uuidSchema.nullable(),
  sireId: uuidSchema.nullable(),
  mobId: uuidSchema.nullable(),
  /** Denormalised current location; movement history is the append-only event log, not this. */
  landUnitId: uuidSchema.nullable(),
  source: z.string().min(1).nullable(),
  acquiredAt: dateSchema.nullable(),
  /** The registered mark this animal carries (FR-602). Null = unmarked. */
  brandId: uuidSchema.nullable(),
  brandAppliedAt: dateSchema.nullable(),
  /** Species-specific attributes; validated per species in a later slice (ADR-0006). */
  attributes: z.record(z.string(), z.unknown()),
  /** Local photo key; the image uploads on sync and never blocks a write (FR-108). */
  photoKey: z.string().min(1).nullable(),
  ...auditTimestampsSchema,
});
export type Animal = z.infer<typeof animalSchema>;

export const newAnimalSchema = animalSchema
  .pick({ id: true, farmId: true, species: true, sex: true })
  .extend({
    /** Client-generated UUIDv7 for the animal row (P2.9) — not merely a well-formed UUID. */
    id: uuidV7Schema,
    enterpriseId: animalSchema.shape.enterpriseId.default(null),
    breed: animalSchema.shape.breed.default(null),
    dob: animalSchema.shape.dob.default(null),
    dobEstimated: z.boolean().default(false),
    status: animalStatusSchema.default('alive'),
    statusAt: animalSchema.shape.statusAt.default(null),
    damId: animalSchema.shape.damId.default(null),
    sireId: animalSchema.shape.sireId.default(null),
    mobId: animalSchema.shape.mobId.default(null),
    landUnitId: animalSchema.shape.landUnitId.default(null),
    source: animalSchema.shape.source.default(null),
    acquiredAt: animalSchema.shape.acquiredAt.default(null),
    brandId: animalSchema.shape.brandId.default(null),
    brandAppliedAt: animalSchema.shape.brandAppliedAt.default(null),
    attributes: z.record(z.string(), z.unknown()).default({}),
    photoKey: animalSchema.shape.photoKey.default(null),
  })
  .superRefine((animal, context) => {
    // A mark link without its application day cannot support the FR-602 overdue check; a day
    // without a mark claims an application nobody can identify. The pair is one fact.
    if ((animal.brandId === null) !== (animal.brandAppliedAt === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: animal.brandId === null ? ['brandId'] : ['brandAppliedAt'],
        message: 'A registered mark and the day it was applied must be recorded together',
      });
    }
  });
export type NewAnimal = z.infer<typeof newAnimalSchema>;

// ── Mob ─────────────────────────────────────────────────────────────────────
export const mobSchema = z.object({
  id: uuidSchema,
  farmId: uuidSchema,
  enterpriseId: uuidSchema.nullable(),
  name: z.string().min(1),
  species: speciesSchema,
  landUnitId: uuidSchema.nullable(),
  /**
   * The CURRENT count (FR-102); null when the mob is a bag of individuals rather than a head count.
   *
   * ⭐ Derived, never edited. It is `initialHeadCount` folded over the mob's whole tally log, and
   * both sides run that same fold from that same baseline (`@werf/domain projectHeadCount`). Reading
   * this is fine; writing to it — or folding a delta onto it — is the bug migration 0018 exists to
   * make impossible, because two devices syncing out of order then land on two different numbers.
   */
  headCount: z.number().int().nonnegative().nullable(),
  /**
   * ⭐ The count the mob was CREATED with, and the ONLY correct baseline for the tally fold.
   *
   * Immutable, which is what makes it usable: `headCount` moves every time a tally lands, so folding
   * the log over it counts every tally twice. Today a device gets away with folding over `headCount`
   * only because nothing writes back into the local store — the moment the mob table is hydrated
   * from the server, that accident stops holding and every counted mob is silently wrong.
   */
  initialHeadCount: z.number().int().nonnegative().nullable(),
  ...auditTimestampsSchema,
});
export type Mob = z.infer<typeof mobSchema>;

/**
 * A mob as a device composes it offline, and as it is held in the local register.
 *
 * `initialHeadCount` is on this shape and it is NOT redundant with `headCount`. At creation the two
 * are equal — which is exactly why the distinction is easy to lose and worth stating: one of them is
 * a running total and the other is a fixed point, and only the fixed one may be folded over.
 *
 * It is not read from the body server-side; `recordMob` sets the baseline from the count that was
 * captured, so the two cannot disagree even if a client sent something else.
 */
export const newMobSchema = mobSchema
  .pick({ id: true, farmId: true, name: true, species: true })
  .extend({
    /** Client-generated UUIDv7 for the mob row (P2.9) — not merely a well-formed UUID. */
    id: uuidV7Schema,
    enterpriseId: mobSchema.shape.enterpriseId.default(null),
    landUnitId: mobSchema.shape.landUnitId.default(null),
    headCount: mobSchema.shape.headCount.default(null),
    initialHeadCount: mobSchema.shape.initialHeadCount.default(null),
  });
export type NewMob = z.infer<typeof newMobSchema>;

// ── Species-specific attributes (FR-107) ────────────────────────────────────
/**
 * What each species may carry in the `attributes` JSONB, and nothing else.
 *
 * ADR-0004 keeps ONE `animals` table for every species, which is right: a mixed farm's cattle and
 * sheep share a herd count, a movement history, a treatment register and a theft trail, and six
 * tables would mean six of everything. What one table cannot do is say that a cow has a horn status
 * and a sheep has a wool class. That is what the JSONB column is for — and an unvalidated JSONB
 * column is where typos accumulate quietly for a year, which is what these schemas exist to stop.
 *
 * ⭐ Every one is `.strict()`, so an attribute this species does not have is REFUSED rather than
 * stored. A `woolClass` on a cow is not a harmless extra key; it is a capture screen or an importer
 * that has gone wrong, and finding it in the data six months later is finding it too late to know
 * what was meant.
 *
 * ⭐ These are NOT behind the ADR-0006 `AnimalIdentityRules` seam, though the Phase 2 checklist line
 * assumed they would be. That seam is for what the LAW varies — the Animal Identification Act's mark
 * rules, which genuinely differ across the border. A horn is a horn in Namibia. Putting a husbandry
 * vocabulary behind a jurisdiction interface would make every future country restate that cattle can
 * be polled: the mirror image of the mistake ADR-0006 warns about. Species vary by species.
 *
 * Keys are camelCase like every other JSONB payload here (`events.payload` names a calf `calfId`);
 * FR-107's `horn_status` names the concept, not the key.
 */

/**
 * Whether an animal carries horns, and how it came not to.
 *
 * `polled` and `dehorned` are separate values and the difference is the point: polled is genetic
 * and heritable, dehorned is something that was done to the animal. A breeder selecting for polled
 * stock needs to tell them apart, and a buyer looking at a hornless animal cannot.
 */
export const HORN_STATUSES = ['horned', 'polled', 'dehorned', 'scurred'] as const;
export const hornStatusSchema = z.enum(HORN_STATUSES);
export type HornStatus = z.infer<typeof hornStatusSchema>;

/**
 * The classer's wool code — a SHORT uppercase code, and deliberately NOT an enum.
 *
 * South African wool is classed to an industry standard administered by Cape Wools, and that code
 * list is not in this repository. Writing out a plausible-looking enum from memory would put a
 * picker of wrong codes in front of a wool farmer, who would spot it immediately and stop trusting
 * the screen — and every animal captured against a fabricated code would need re-classing. That is
 * the same defect as inventing a regulated number, so the SHAPE is validated and the vocabulary is
 * left to the classer until the real list is reference data this app can look up.
 */
export const woolClassSchema = z
  .string()
  .trim()
  .min(1)
  .max(8)
  .regex(/^[A-Z0-9]+$/, 'A wool class is the classer’s code — letters and digits, in capitals');

/** No species-specific attributes defined yet. Strict, so a stray key is still refused. */
const noAttributes = z.object({}).strict();
const hornedOnly = z.object({ hornStatus: hornStatusSchema.optional() }).strict();

/**
 * Adding a species to `SPECIES` without adding it here is a compile error rather than a silent
 * pass-through — `satisfies Record<Species, …>` does that work, exactly as the event payload
 * registry does for a new event type.
 */
export const speciesAttributeSchemas = {
  cattle: hornedOnly,
  // A sheep can be horned too — Dorper rams are, Merinos vary — so both apply.
  sheep: z
    .object({ hornStatus: hornStatusSchema.optional(), woolClass: woolClassSchema.optional() })
    .strict(),
  goat: hornedOnly,
  pig: noAttributes,
  poultry: noAttributes,
  game: hornedOnly,
} satisfies Record<Species, z.ZodType>;

/** The attribute schema for a species — what a capture screen may offer, and nothing else. */
export function attributeSchemaFor(species: Species): z.ZodType {
  return speciesAttributeSchemas[species];
}

/** Which attributes this species has, for a screen deciding what to render. */
export function attributeKeysFor(species: Species): readonly string[] {
  const schema = speciesAttributeSchemas[species] as unknown as {
    shape?: Record<string, unknown>;
  };
  return schema.shape === undefined ? [] : Object.keys(schema.shape);
}

// ── AnimalIdentifier ──────────────────────────────────────────────────────────
// Many per animal (FR-109), unique per farm per type (enforced in the DB). One is primary.
export const animalIdentifierSchema = z.object({
  id: uuidSchema,
  farmId: uuidSchema,
  animalId: uuidSchema,
  type: identifierTypeSchema,
  value: z.string().min(1),
  isPrimary: z.boolean(),
  appliedAt: dateSchema.nullable(),
  ...auditTimestampsSchema,
});
export type AnimalIdentifier = z.infer<typeof animalIdentifierSchema>;

export const newAnimalIdentifierSchema = animalIdentifierSchema
  .pick({ id: true, farmId: true, animalId: true, type: true, value: true })
  .extend({
    /** Client-generated UUIDv7 for the identifier row (P2.9) — not merely a well-formed UUID. */
    id: uuidV7Schema,
    isPrimary: z.boolean().default(false),
    appliedAt: animalIdentifierSchema.shape.appliedAt.default(null),
  });
export type NewAnimalIdentifier = z.infer<typeof newAnimalIdentifierSchema>;
