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
import {
  animalSexSchema,
  animalStatusSchema,
  auditTimestampsSchema,
  dateSchema,
  identifierTypeSchema,
  speciesSchema,
  timestampSchema,
  uuidSchema,
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
    attributes: z.record(z.string(), z.unknown()).default({}),
    photoKey: animalSchema.shape.photoKey.default(null),
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
  /** Present for group-only management (FR-102); null when the mob is a bag of individuals. */
  headCount: z.number().int().nonnegative().nullable(),
  ...auditTimestampsSchema,
});
export type Mob = z.infer<typeof mobSchema>;

export const newMobSchema = mobSchema
  .pick({ id: true, farmId: true, name: true, species: true })
  .extend({
    enterpriseId: mobSchema.shape.enterpriseId.default(null),
    landUnitId: mobSchema.shape.landUnitId.default(null),
    headCount: mobSchema.shape.headCount.default(null),
  });
export type NewMob = z.infer<typeof newMobSchema>;

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
    isPrimary: z.boolean().default(false),
    appliedAt: animalIdentifierSchema.shape.appliedAt.default(null),
  });
export type NewAnimalIdentifier = z.infer<typeof newAnimalIdentifierSchema>;
