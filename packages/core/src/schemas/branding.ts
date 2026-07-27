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
  geoJsonStringSchema,
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
  /**
   * Every identifier this animal has EVER carried, retired ones included and marked as such.
   *
   * ⭐ Excluding tombstoned identifiers was exactly backwards for this document. A tag that was
   * replaced after the loss is the number the animal was WEARING when it walked off, and it is the
   * number on the recovered animal at a roadblock or a sale yard. It is stated as retired rather
   * than silently mixed in, because the pack's whole value is that every line in it is a fact.
   */
  identifiers: z.array(
    z.object({
      type: z.string().min(1),
      value: z.string().min(1),
      retired: z.boolean(),
    }),
  ),
  mark: z.string().min(1).nullable(),
  /**
   * The certificate for THIS animal's mark. Per-animal, because stock in one incident can carry
   * different marks and one certificate printed for the whole incident over-claims — it asserts
   * that every animal listed is covered by a registration that may cover only some of them.
   */
  certificateReference: z.string().min(1).nullable(),
  photoKey: z.string().min(1).nullable(),
  /** Acquisition → current: the ownership chain establishing continuous possession. */
  acquiredAt: dateSchema.nullable(),
  source: z.string().min(1).nullable(),
  /**
   * ⭐ The possession trail (legal-compliance.md § 3.2), and it is not decoration: under the Stock
   * Theft Act's reverse onus, continuous possession is the DEFENCE. A pack that identifies an
   * animal and cannot show it was on this farm, being kept and treated, week after week, has left
   * out the part that does the legal work. Camp codes and dates, in occurrence order.
   */
  movements: z.array(
    z.object({
      occurredAt: timestampSchema,
      from: z.string().min(1).nullable(),
      to: z.string().min(1).nullable(),
    }),
  ),
  /** Dosing history — the other half of the same trail. Husbandry nobody performs on stolen stock. */
  treatments: z.array(
    z.object({
      occurredAt: timestampSchema,
      kind: z.string().min(1),
      product: z.string().min(1),
    }),
  ),
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
  /**
   * The incident-level brand certificate — set ONLY when every marked animal in it carries the same
   * one, and null the moment they do not. The per-animal reference is the authoritative field; this
   * is a convenience for the ordinary case of a single farm mark, and it goes null rather than
   * picking a winner because a pack that names one certificate over mixed marks claims coverage it
   * does not have.
   */
  brandCertificateReference: z.string().min(1).nullable(),
  /** What was found and reported — facts only. */
  observations: z.string().min(1).nullable(),
  // Jurisdiction-neutral names (ADR-0006): a police case/station reference. In ZA this is the SAPS
  // case number and station — that word belongs in ZA user-facing copy, never in this shared contract.
  caseNumber: z.string().min(1).nullable(),
  reportingStation: z.string().min(1).nullable(),
  // ⛔ There is deliberately NO `suspect` field. Do not add one. See the module header.
});
export type EvidencePack = z.infer<typeof evidencePackSchema>;

/**
 * Create a stock-theft incident (FR-603/605) — the record a farmer captures in the field, at the
 * last-seen location, offline. It is what the evidence pack is later assembled FROM. Facts only:
 * what was found, when, where, what was reported, and the case number.
 *
 * ⛔ NO `suspect` field — same rule as the pack. A farmer naming a neighbour is a defamation
 * exposure for them and a POPIA s26 criminal-behaviour processing problem for us.
 */
export const newTheftIncidentSchema = z.object({
  /** Client-generated UUIDv7 for the incident row. */
  id: uuidSchema,
  farmId: uuidSchema,
  /** When the loss was discovered. */
  discoveredAt: timestampSchema,
  /** When the stock was last seen — the anchor of the possession timeline. */
  lastSeenAt: timestampSchema.nullable().default(null),
  /** Last-seen GPS as GeoJSON (never PostGIS on the wire). */
  lastSeenLocationGeojson: geoJsonStringSchema.nullable().default(null),
  landUnitId: uuidSchema.nullable().default(null),
  headCount: z.number().int().positive(),
  /** ZA copy: "SAPS case number". Neutral name (ADR-0006). */
  caseNumber: z.string().min(1).nullable().default(null),
  reportingStation: z.string().min(1).nullable().default(null),
  observations: z.string().min(1).nullable().default(null),
  /** The animals this incident concerns — the ownership chain the pack proves. */
  animalIds: z.array(uuidSchema).default([]),
});
export type NewTheftIncident = z.infer<typeof newTheftIncidentSchema>;
