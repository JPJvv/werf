/**
 * Branding register + stock-theft evidence-pack schemas (Phase 2, FR-601/603). The branding
 * register is the South African identification mark (Animal Identification Act 6 of 2002); the
 * evidence pack is the facts-only document a farmer hands the Stock Theft Unit (Stock Theft Act 57
 * of 1959). See legal-compliance.md § 3.
 *
 * ⭐ ADR-0006: the ≤3-character mark rule is South African and lives in the DB CHECK (and moves to
 * AnimalIdentityRules when a second jurisdiction arrives), NOT baked into this jurisdiction-neutral
 * schema — here `mark` is validated only as a non-empty string.
 *
 * ⭐ The evidence pack has NO `suspect` field, and never will (legal-compliance.md § 3.2): a farmer
 * naming a neighbour is a defamation exposure for them and a POPIA s26 criminal-behaviour processing
 * exposure for us. The pack records what was found, when, where, what was reported, and the case
 * number — facts only.
 */

import { z } from 'zod';
import {
  auditTimestampsSchema,
  dateSchema,
  jurisdictionSchema,
  timestampSchema,
  uuidSchema,
} from './primitives';

/** The marking method (Act 6 of 2002). Physical methods, not jurisdiction law. */
export const markTypeSchema = z.enum(['tattoo', 'freeze_brand', 'hot_brand']);
export type MarkType = z.infer<typeof markTypeSchema>;

export const brandingRegisterSchema = z.object({
  id: uuidSchema,
  farmId: uuidSchema,
  /** A mark registration is national — from the farm's jurisdiction, never the user's. */
  jurisdiction: jurisdictionSchema,
  /** The registered mark. The ≤3 rule is enforced in the DB (ZA); here it is a non-empty string. */
  mark: z.string().min(1),
  markType: markTypeSchema,
  /** The species this mark covers. */
  species: z.array(z.string().min(1)).min(1),
  bodyPosition: z.string().min(1).nullable(),
  certificateReference: z.string().min(1).nullable(),
  registeredAt: dateSchema.nullable(),
  ...auditTimestampsSchema,
});
export type BrandingRegister = z.infer<typeof brandingRegisterSchema>;

export const newBrandingRegisterSchema = brandingRegisterSchema
  .pick({ id: true, farmId: true, mark: true, markType: true, species: true })
  .extend({
    jurisdiction: brandingRegisterSchema.shape.jurisdiction.default('ZA'),
    bodyPosition: brandingRegisterSchema.shape.bodyPosition.default(null),
    certificateReference: brandingRegisterSchema.shape.certificateReference.default(null),
    registeredAt: brandingRegisterSchema.shape.registeredAt.default(null),
  });
export type NewBrandingRegister = z.infer<typeof newBrandingRegisterSchema>;

// ── Stock-theft evidence pack (FR-603) ──────────────────────────────────────────────
// The facts-only shape the server assembles into a single PDF. NO suspect field — see the header.

/** One identified animal in the pack: how it is identified and its ownership/movement/treatment trail. */
export const evidenceAnimalSchema = z.object({
  animalId: uuidSchema,
  identifiers: z.array(z.object({ type: z.string().min(1), value: z.string().min(1) })),
  mark: z.string().min(1).nullable(),
  photoKey: z.string().min(1).nullable(),
  /** Acquisition → current: the ownership chain establishing continuous possession. */
  acquiredAt: dateSchema.nullable(),
  source: z.string().min(1).nullable(),
});
export type EvidenceAnimal = z.infer<typeof evidenceAnimalSchema>;

export const evidencePackSchema = z.object({
  farmId: uuidSchema,
  /** When the loss was discovered, and the last time the stock was seen (GPS-anchored). */
  discoveredAt: timestampSchema,
  lastSeenAt: timestampSchema.nullable(),
  lastSeenLocationGeojson: z.string().min(1).nullable(),
  headCount: z.number().int().positive(),
  animals: z.array(evidenceAnimalSchema),
  /** The registered brand certificate reference for the ownership proof. */
  brandCertificateReference: z.string().min(1).nullable(),
  /** What was found and reported — facts only. */
  observations: z.string().min(1).nullable(),
  sapsCaseNumber: z.string().min(1).nullable(),
  sapsStation: z.string().min(1).nullable(),
  // ⛔ There is deliberately NO `suspect` field. Do not add one. See the module header.
});
export type EvidencePack = z.infer<typeof evidencePackSchema>;
