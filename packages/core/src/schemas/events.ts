/**
 * Event entity schema (Phase 2, database-schema.md § 5) — the append-only heart. Record + new
 * shapes exactly as the other entities: the record is a persisted row; the new shape is what a
 * client composes offline with its own UUIDv7 id.
 *
 * ⭐ Three timestamps, three meanings, and confusing them is the classic bug this schema exists
 * to prevent (.claude/rules/db.md):
 *   • occurredAt — when it happened on the farm.  REPORTS USE THIS.
 *   • createdAt  — when the row was written (audit).  Differs from occurredAt by days when a
 *                  farmer captures in a signal dead zone and syncs a week later.
 *   • syncedAt   — when it reached the server.  Null until it has.
 * `updatedAt` (in auditTimestampsSchema) is a fourth, distinct clock: the sync LWW timestamp.
 * Events are append-only and never merged (db.md), so the only update is a soft-delete
 * correction — which is why there is a `createdBy` but no `updatedBy`.
 *
 * ⭐ `payload` is validated PER event type. The envelope is one shape; the payload shape depends
 * on `type`, and `eventSchema` dispatches to the right per-type schema in a single parse.
 */

import { z } from 'zod';
import { EVENT_TYPES, type EventType } from '../events';
import {
  auditTimestampsSchema,
  dateSchema,
  eventTypeSchema,
  geoJsonStringSchema,
  moneySchema,
  timestampSchema,
  uuidSchema,
} from './primitives';

// ── Per-type payloads ─────────────────────────────────────────────────────────
// Concrete for the lifecycle + weight + move + breeding + health captures Phase 2 owns (birth,
// weight, death, sale, purchase, weaning, move, mating, pregnancy_test, treatment, vaccination,
// dip) plus the cross-cutting rainfall. The remaining types carry an open payload until their phase — condition_score/missing/recovered;
// treatment/vaccination/dip with the health slice (compliance-gated: withdrawal dates are
// computed at capture and stored, never on read, and resolve through the regulatory_rates seam
// by occurredAt — FR-131); spray/harvest with crops; attendance/piece_work with labour. Making
// one concrete is a one-line change to CONCRETE_PAYLOADS.

/** Birth (FR-104): the calf, its parents, and how the calving went. */
export const birthPayloadSchema = z.object({
  calfId: uuidSchema,
  damId: uuidSchema,
  sireId: uuidSchema.optional(),
  birthWeightKg: z.number().positive().optional(),
  /** Calving-ease score, 1 (unassisted) … 5 (caesarean). */
  easeScore: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  /** Singles = 1, twins = 2, … */
  multiples: z.number().int().positive(),
});
export type BirthPayload = z.infer<typeof birthPayloadSchema>;

/** Weight (FR-140): the reading and how it was taken. */
export const weightPayloadSchema = z.object({
  kg: z.number().positive(),
  method: z.enum(['scale', 'tape', 'visual']),
});
export type WeightPayload = z.infer<typeof weightPayloadSchema>;

/** Death (FR-105): the cause, and how the carcass was disposed of. Drives status → 'dead'. */
export const deathPayloadSchema = z.object({
  cause: z.string().min(1),
  disposal: z.string().min(1).optional(),
});
export type DeathPayload = z.infer<typeof deathPayloadSchema>;

/**
 * Sale and purchase (FR-106) share a shape: who the other party is, the price, and the
 * liveweight the deal was struck on. `priceCents` is Money — integer cents, never a float
 * (CLAUDE.md § Money) — and non-negative. A sale drives status → 'sold'; a purchase does not
 * change status (the animal is alive in your herd), it records the acquisition for the audit
 * and financial trail.
 */
export const tradePayloadSchema = z.object({
  counterparty: z.string().min(1),
  priceCents: moneySchema.nonnegative(),
  weightKg: z.number().positive().optional(),
});
export type TradePayload = z.infer<typeof tradePayloadSchema>;

/** Weaning (FR-111): weight at weaning and, when the dob is known, age in days. */
export const weaningPayloadSchema = z.object({
  weightKg: z.number().positive(),
  ageDays: z.number().int().nonnegative().optional(),
});
export type WeaningPayload = z.infer<typeof weaningPayloadSchema>;

/**
 * Move (FR-103): an animal's location change kept as an append-only event — the camp (land_unit)
 * and/or mob it left and the one it joined. `null` is a real target (unassigned from a mob), so
 * all four ids are nullable; the rule that a move must actually change something is enforced at the
 * domain capture boundary, not in the shape.
 */
export const movePayloadSchema = z.object({
  fromLandUnitId: uuidSchema.nullable(),
  toLandUnitId: uuidSchema.nullable(),
  fromMobId: uuidSchema.nullable(),
  toMobId: uuidSchema.nullable(),
});
export type MovePayload = z.infer<typeof movePayloadSchema>;

/**
 * Mating / service (FR-120): natural service or AI, the sire if known, or a bull-in/bull-out
 * period for extensive herds where the exact service date is a window rather than a day. Recorded
 * against the DAM (like a birth). The sire is either an animal on this farm (`sireId`) or an
 * external bull / AI straw referenced by code (`sireCode`).
 */
export const matingPayloadSchema = z.object({
  method: z.enum(['natural', 'ai']),
  sireId: uuidSchema.optional(),
  sireCode: z.string().min(1).optional(),
  bullInAt: dateSchema.optional(),
  bullOutAt: dateSchema.optional(),
});
export type MatingPayload = z.infer<typeof matingPayloadSchema>;

/**
 * Pregnancy diagnosis (FR-121): how it was checked, the result, and — when pregnant and a service
 * date is known — the projected due date. The due date is `matingDate + species gestation`, and the
 * gestation period is INJECTED reference data (not a magic number in code); the domain capture
 * computes and stores `dueDate` here so a report never re-derives it from a gestation that may have
 * been corrected later. A due date on an `open`/`uncertain` result is a contradiction and is absent.
 */
export const pregnancyTestPayloadSchema = z.object({
  method: z.enum(['palpation', 'ultrasound', 'blood', 'visual']),
  result: z.enum(['pregnant', 'open', 'uncertain']),
  dueDate: dateSchema.optional(),
});
export type PregnancyTestPayload = z.infer<typeof pregnancyTestPayloadSchema>;

/**
 * ⭐ Compliance-gated (FR-131, legal-compliance.md § 3, .claude/rules/domain.md). `meatWithholdUntil`
 * / `milkWithholdUntil` are the calendar dates the animal's meat / milk become safe, COMPUTED AT
 * CAPTURE from the veterinary product's withdrawal period (product reference data, resolved by the
 * treatment date — never a number typed into code) and STORED on the event, so a later sale /
 * slaughter guard reads the rule that applied at treatment time, not on read. Absent when the
 * product carries no withdrawal (e.g. a zero-withdrawal vaccine).
 */
const withholdFields = {
  meatWithholdUntil: dateSchema.optional(),
  milkWithholdUntil: dateSchema.optional(),
} as const;

/** Route a medicine was given by. */
export const treatmentRouteSchema = z.enum([
  'oral',
  'injection_sc',
  'injection_im',
  'injection_iv',
  'topical',
  'intramammary',
  'other',
]);
export type TreatmentRoute = z.infer<typeof treatmentRouteSchema>;

/** Treatment (FR-130/131): the registered product, batch, dose, route, who gave it, why. */
export const treatmentPayloadSchema = z.object({
  product: z.string().min(1),
  batch: z.string().min(1).optional(),
  doseValue: z.number().positive().optional(),
  doseUnit: z.string().min(1).optional(),
  route: treatmentRouteSchema.optional(),
  administeredBy: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  ...withholdFields,
});
export type TreatmentPayload = z.infer<typeof treatmentPayloadSchema>;

/** Vaccination (FR-132): the product, the programme it belongs to, batch, who gave it. */
export const vaccinationPayloadSchema = z.object({
  product: z.string().min(1),
  programme: z.string().min(1).optional(),
  batch: z.string().min(1).optional(),
  administeredBy: z.string().min(1).optional(),
  ...withholdFields,
});
export type VaccinationPayload = z.infer<typeof vaccinationPayloadSchema>;

/** Dip / tick treatment (FR-133): required in controlled areas (Animal Diseases Act 35 of 1984). */
export const dipPayloadSchema = z.object({
  product: z.string().min(1),
  method: z.enum(['plunge', 'spray', 'pour_on', 'hand']).optional(),
  reason: z.string().min(1).optional(),
  ...withholdFields,
});
export type DipPayload = z.infer<typeof dipPayloadSchema>;

/**
 * Rainfall (FR-213): how much fell, and — when the farm reads more than one gauge — which gauge.
 * Cross-cutting, not livestock: grazing rest/rotation and cropping both read it, which is why the
 * event is scoped to the FARM (and optionally a land unit), never to a herd or an animal.
 *
 * `mm` is NON-NEGATIVE, not positive. A dry reading is a real observation: "I checked the gauge on
 * Tuesday and it was empty" is the fact that distinguishes a drought from a farmer who forgot to
 * look, and a rest-period calculation that cannot tell those apart is worthless. Zero is data.
 */
export const rainfallPayloadSchema = z.object({
  mm: z.number().nonnegative().finite(),
  gauge: z.string().min(1).optional(),
});
export type RainfallPayload = z.infer<typeof rainfallPayloadSchema>;

/** A type whose payload is not yet pinned down: an open record until its phase defines it. */
const openPayloadSchema = z.record(z.string(), z.unknown());

const CONCRETE_PAYLOADS = {
  birth: birthPayloadSchema,
  weight: weightPayloadSchema,
  death: deathPayloadSchema,
  sale: tradePayloadSchema,
  purchase: tradePayloadSchema,
  weaning: weaningPayloadSchema,
  move: movePayloadSchema,
  mating: matingPayloadSchema,
  pregnancy_test: pregnancyTestPayloadSchema,
  treatment: treatmentPayloadSchema,
  vaccination: vaccinationPayloadSchema,
  dip: dipPayloadSchema,
  rainfall: rainfallPayloadSchema,
} satisfies Partial<Record<EventType, z.ZodType>>;

/**
 * Every event type mapped to the schema its payload must satisfy. Built from EVENT_TYPES so a
 * newly added type cannot silently miss the registry — it defaults to an open payload, and the
 * `satisfies Partial<Record<EventType, …>>` above catches a typo'd concrete key at build time.
 */
export const eventPayloadSchemas: Record<EventType, z.ZodType> = Object.fromEntries(
  EVENT_TYPES.map((type) => [
    type,
    (CONCRETE_PAYLOADS as Partial<Record<EventType, z.ZodType>>)[type] ?? openPayloadSchema,
  ]),
) as Record<EventType, z.ZodType>;

/** The payload schema for a given event type. */
export function eventPayloadSchemaFor(type: EventType): z.ZodType {
  return eventPayloadSchemas[type];
}

// ── Envelope ──────────────────────────────────────────────────────────────────
const eventObjectSchema = z.object({
  id: uuidSchema,
  farmId: uuidSchema,
  /** Financial attribution — which enterprise this event belongs to. */
  enterpriseId: uuidSchema.nullable(),
  type: eventTypeSchema,
  /** ⭐ When it happened on the farm. REPORTS USE THIS, never createdAt. */
  occurredAt: timestampSchema,
  /** When it reached the server. Null until it has. */
  syncedAt: timestampSchema.nullable(),
  animalId: uuidSchema.nullable(),
  mobId: uuidSchema.nullable(),
  landUnitId: uuidSchema.nullable(),
  /** The employees table arrives with the labour phase; the DB column's FK is added then. */
  employeeId: uuidSchema.nullable(),
  /** Groups one action (a dosing run, a weigh session) across many animals (FR-112). */
  batchId: uuidSchema.nullable(),
  payload: z.record(z.string(), z.unknown()),
  /** GPS where it happened. Crosses the wire as GeoJSON, never PostGIS (like land boundaries). */
  locationGeojson: geoJsonStringSchema.nullable(),
  notes: z.string().min(1).nullable(),
  createdBy: uuidSchema.nullable(),
  ...auditTimestampsSchema,
});

/** Re-run the payload check against the per-type schema; used by both record and new shapes. */
const checkPayload = (
  event: { type: EventType; payload: Record<string, unknown> },
  ctx: z.RefinementCtx,
): void => {
  const result = eventPayloadSchemas[event.type].safeParse(event.payload);
  if (!result.success) {
    for (const issue of result.error.issues) {
      ctx.addIssue({ ...issue, path: ['payload', ...issue.path] });
    }
  }
};

export const eventSchema = eventObjectSchema.superRefine(checkPayload);
export type Event = z.infer<typeof eventSchema>;

export const newEventSchema = eventObjectSchema
  .pick({ id: true, farmId: true, type: true, occurredAt: true, payload: true })
  .extend({
    enterpriseId: eventObjectSchema.shape.enterpriseId.default(null),
    syncedAt: eventObjectSchema.shape.syncedAt.default(null),
    animalId: eventObjectSchema.shape.animalId.default(null),
    mobId: eventObjectSchema.shape.mobId.default(null),
    landUnitId: eventObjectSchema.shape.landUnitId.default(null),
    employeeId: eventObjectSchema.shape.employeeId.default(null),
    batchId: eventObjectSchema.shape.batchId.default(null),
    locationGeojson: eventObjectSchema.shape.locationGeojson.default(null),
    notes: eventObjectSchema.shape.notes.default(null),
    createdBy: eventObjectSchema.shape.createdBy.default(null),
  })
  .superRefine(checkPayload);
export type NewEvent = z.infer<typeof newEventSchema>;
