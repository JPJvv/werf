/**
 * Wire contracts for livestock capture (Phase 2). These are the shapes a client composes
 * OFFLINE — id is its own UUIDv7, occurredAt is the farm-local instant it happened — and
 * posts to the API (or, in Phase 3, queues for sync). The server never invents an id or a
 * time here; it only stamps who (`created_by`, from the session) and when the row was
 * written (`created_at`). Both client and server validate against the identical schema.
 *
 * Two fields are deliberately ABSENT from every capture body:
 *   • createdBy — the author is the authenticated caller, read from the session, never the
 *     body. A body-supplied author would let a caller attribute a capture to someone else.
 *   • syncedAt  — server-owned; the client cannot assert when its own write reached the server.
 */

import { z } from 'zod';
import {
  uuidSchema,
  uuidV7Schema,
  geoJsonStringSchema,
  dateSchema,
  moneySchema,
  timestampSchema,
} from './primitives';
import {
  birthPayloadSchema,
  bullWindowIsForward,
  deathPayloadSchema,
  dipPayloadSchema,
  matingPayloadShape,
  pregnancyTestPayloadSchema,
  tallyReasonSchema,
  tradePayloadSchema,
  treatmentRouteSchema,
  weaningPayloadSchema,
  weightPayloadSchema,
} from './events';

export {
  newAnimalSchema as recordAnimalRequestSchema,
  type NewAnimal as RecordAnimalRequest,
} from './animals';

/**
 * Record a weight (FR-140). The reading (`kg` + `method`) is exactly the `weight` event
 * payload, reused so the two cannot drift. The subject is one of `animalId` (an individual)
 * or `mobId` (a whole group) — the "exactly one" rule is enforced once, in the `recordWeight`
 * domain function, so a bad capture fails with a typed ValidationError rather than being
 * duplicated as a schema refinement that could disagree with it.
 */
export const recordWeightRequestSchema = z.object({
  /** Client-generated UUIDv7 for the event row. */
  id: uuidV7Schema,
  farmId: uuidSchema,
  /** The individual animal weighed. Mutually exclusive with `mobId` (checked in the domain). */
  animalId: uuidSchema.nullable().default(null),
  /** The mob/flock weighed. Mutually exclusive with `animalId`. */
  mobId: uuidSchema.nullable().default(null),
  /** When the animal stepped on the scale, on the farm. Not `created_at` (set on write). */
  occurredAt: timestampSchema,
  /** Financial attribution — the enterprise this reading belongs to (FR-113 herd scoping). */
  enterpriseId: uuidSchema.nullable().default(null),
  /** Groups one weigh session across many animals (FR-112/142). */
  batchId: uuidSchema.nullable().default(null),
  /** GPS where it happened, as GeoJSON (never PostGIS on the wire). */
  locationGeojson: geoJsonStringSchema.nullable().default(null),
  notes: z.string().min(1).nullable().default(null),
  // The reading itself, reused from the `weight` event payload so the two cannot drift.
  ...weightPayloadSchema.shape,
});
export type RecordWeightRequest = z.infer<typeof recordWeightRequestSchema>;

/**
 * Record a death (FR-105). A death is always against an individual animal — the subject is
 * required here, not the animal-xor-mob of a weight — and drives its status to 'dead' through
 * the state machine (enforced in the `recordDeath` domain function, not duplicated here). The
 * cause (+ optional disposal) is exactly the `death` event payload, reused so the two cannot
 * drift.
 */
export const recordDeathRequestSchema = z.object({
  id: uuidV7Schema,
  farmId: uuidSchema,
  animalId: uuidSchema,
  /** When the animal died, on the farm. Not `created_at` (set on write). */
  occurredAt: timestampSchema,
  ...deathPayloadSchema.shape,
});
export type RecordDeathRequest = z.infer<typeof recordDeathRequestSchema>;

/**
 * Record a sale (FR-106) — an individual animal leaving the herd for a price. `priceCents` is
 * Money (integer cents, never a float) and non-negative; counterparty and the optional sale
 * weight are the `trade` event payload, reused so the wire and the stored event cannot drift.
 * A sale drives status → 'sold' via the state machine in the `recordSale` domain function.
 */
export const recordSaleRequestSchema = z.object({
  id: uuidV7Schema,
  farmId: uuidSchema,
  animalId: uuidSchema,
  /** When the animal was sold, on the farm. Not `created_at` (set on write). */
  occurredAt: timestampSchema,
  ...tradePayloadSchema.shape,
});
export type RecordSaleRequest = z.infer<typeof recordSaleRequestSchema>;

/**
 * Record a birth (FR-104). The event is filed against the DAM — her timeline is where a calving
 * belongs — and the calf is referenced by the id the client already minted for its `animals` row.
 * The flush sends animals before events, so the calf exists by the time this arrives.
 */
export const recordBirthRequestSchema = z.object({
  id: uuidV7Schema,
  farmId: uuidSchema,
  /** Shared by every calf from one calving; optional for older offline clients. */
  batchId: uuidV7Schema.optional(),
  /** The DAM. The event is hers; the calf is in the payload. */
  animalId: uuidSchema,
  /** When she calved, on the farm. Not `created_at` (set on write). */
  occurredAt: timestampSchema,
  ...birthPayloadSchema.omit({ damId: true }).shape,
});
export type RecordBirthRequest = z.infer<typeof recordBirthRequestSchema>;

/** Record a weaning (FR-111) — weight and, if known, age. No status change; the animal stays alive. */
export const recordWeaningRequestSchema = z.object({
  id: uuidV7Schema,
  farmId: uuidSchema,
  animalId: uuidSchema,
  occurredAt: timestampSchema,
  ...weaningPayloadSchema.shape,
});
export type RecordWeaningRequest = z.infer<typeof recordWeaningRequestSchema>;

/**
 * Record a mating / service (FR-120). Filed against the DAM, like a birth — the question asked in
 * September is "which cows were served, and by what", and it is her timeline that answers it.
 *
 * The sire is either an animal on this farm (`sireId`, checked to be on it) or an external bull /
 * AI straw named by code (`sireCode`). Both are optional: an extensive herd running a bull with the
 * cows often cannot say which cow he served on which day, which is what `bullInAt`/`bullOutAt` are
 * for — the service is a WINDOW, not a day, and recording it as a guessed day would fabricate a
 * precision the farmer never had.
 */
export const recordMatingRequestSchema = z
  .object({
    id: uuidV7Schema,
    farmId: uuidSchema,
    /** The DAM. */
    animalId: uuidSchema,
    /** When she was served, on the farm. Not `created_at` (set on write). */
    occurredAt: timestampSchema,
    ...matingPayloadShape,
  })
  // The same window-order check the payload carries, at the request boundary — a backwards window is
  // rejected as a 400 here as well as by the domain, so the farmer's client sees a clean refusal.
  .refine(bullWindowIsForward, {
    message: 'The bull-out date cannot be before the bull-in date',
    path: ['bullOutAt'],
  });
export type RecordMatingRequest = z.infer<typeof recordMatingRequestSchema>;

/**
 * Record a pregnancy diagnosis (FR-121). Filed against the DAM. No status change — a pregnancy is
 * not a state in the lifecycle machine, it is an observation about an animal that stays alive.
 *
 * ⭐ `dueDate` IS NOT ON THE WIRE, and its absence is the contract. The projection is
 * `matingDate + species gestation`, and gestation is reference data the SERVER holds
 * (`species_gestation`); letting a client post a due date would let a stale or edited device write
 * a date nothing on the server can check, into a field a calving report is planned from. So the
 * client sends the SERVICE DATE it knows and the server does the arithmetic — the same division of
 * labour as the withdrawal period (ADR-0005), where the device previews and the server decides.
 *
 * `matingDate` is optional because a diagnosis is a fact whether or not the service date is known.
 * Without it there is no due date, which is honest: a positive test on a cow of unknown service
 * date tells you she is in calf and genuinely does not tell you when.
 */
export const recordPregnancyTestRequestSchema = z.object({
  id: uuidV7Schema,
  farmId: uuidSchema,
  /** The DAM. */
  animalId: uuidSchema,
  /** When she was tested, on the farm. Not `created_at` (set on write). */
  occurredAt: timestampSchema,
  /**
   * The service date to project from (YYYY-MM-DD), when it is known. A calendar day, never an
   * instant: a due date is a day on the farm and never touches a timezone.
   */
  matingDate: dateSchema.optional(),
  // `dueDate` and `gestationDays` are STORED on the payload but never accepted from a client — both
  // are the server's to project (ADR-0005). `matingDate` is declared explicitly above, so it is
  // omitted here too rather than pulled in twice.
  ...pregnancyTestPayloadSchema.omit({ dueDate: true, matingDate: true, gestationDays: true })
    .shape,
});
export type RecordPregnancyTestRequest = z.infer<typeof recordPregnancyTestRequestSchema>;

/**
 * Record a purchase (FR-106) — an acquisition against an animal already in the herd. Unlike a sale
 * it does NOT change status: the animal arrives alive and stays alive. Same `trade` payload, so the
 * money side of buying and selling cannot drift apart.
 */
export const recordPurchaseRequestSchema = z.object({
  id: uuidV7Schema,
  farmId: uuidSchema,
  animalId: uuidSchema,
  occurredAt: timestampSchema,
  ...tradePayloadSchema.shape,
});
export type RecordPurchaseRequest = z.infer<typeof recordPurchaseRequestSchema>;

/** Mark an animal missing (FR-605). A GPS point makes the private record more useful but is optional. */
export const recordMissingRequestSchema = z.object({
  id: uuidV7Schema,
  farmId: uuidSchema,
  animalId: uuidSchema,
  /** When it was last seen, on the farm — days before this is captured, typically. */
  occurredAt: timestampSchema,
  /** Where it was last seen, as GeoJSON, when the farmer chooses to capture it. */
  lastSeenGeojson: geoJsonStringSchema.optional(),
  cause: z.string().min(1).optional(),
});
export type RecordMissingRequest = z.infer<typeof recordMissingRequestSchema>;

/**
 * Record a move (FR-103) — an animal walked to another camp and/or another mob.
 *
 * ⭐ Only the DESTINATION crosses the wire. The FROM side is read from the animal's own row
 * server-side, exactly as the herd is stamped from the subject (FR-113): the animal already knows
 * where it is, so asking the client to restate it only creates a way for the two to disagree, and a
 * `move` event whose "from" is wrong corrupts the movement history that a grazing rotation and a
 * stock-theft trail are both read from.
 *
 * The two destination fields are `.optional()` rather than defaulted, and the distinction is
 * load-bearing: OMITTING one leaves that dimension unchanged, while sending `null` is a real target
 * — taken off a mapped camp, or unassigned from its mob. A default of null would silently turn
 * "move it to Camp 4" into "move it to Camp 4 and take it out of its mob".
 */
export const recordMoveRequestSchema = z.object({
  id: uuidV7Schema,
  farmId: uuidSchema,
  animalId: uuidSchema,
  /** When the animal was walked, on the farm. Not `created_at` (set on write). */
  occurredAt: timestampSchema,
  /** Destination camp. Omit to leave the camp unchanged; `null` to take it off a mapped camp. */
  toLandUnitId: uuidSchema.nullable().optional(),
  /** Destination mob. Omit to leave the mob unchanged; `null` to unassign it from its mob. */
  toMobId: uuidSchema.nullable().optional(),
  /** Ties one walk across many animals together as a single action (FR-112). */
  batchId: uuidSchema.nullable().default(null),
  locationGeojson: geoJsonStringSchema.nullable().default(null),
  notes: z.string().min(1).nullable().default(null),
});
export type RecordMoveRequest = z.infer<typeof recordMoveRequestSchema>;

/**
 * Record a mob-level move (FR-151) — the whole group walks to another camp, with no individual
 * `animals` rows behind it to carry a destination. Reuses `recordMoveRequestSchema`'s own "only the
 * destination crosses the wire" shape: the FROM side is read server-side off the mob's own row, for
 * the identical reason (asking the client to restate it only creates a way for the two to disagree).
 *
 * `toLandUnitId` is required here, unlike the animal move's optional one — this capture has exactly
 * one purpose, so there is no "leave this dimension unchanged" case to distinguish from omission.
 * `null` is still a real target: the mob is taken off a mapped camp.
 */
export const recordMobMoveRequestSchema = z.object({
  id: uuidV7Schema,
  farmId: uuidSchema,
  mobId: uuidSchema,
  /** When the mob was walked, on the farm. Not `created_at` (set on write). */
  occurredAt: timestampSchema,
  toLandUnitId: uuidSchema.nullable(),
  locationGeojson: geoJsonStringSchema.nullable().default(null),
  notes: z.string().min(1).nullable().default(null),
});
export type RecordMobMoveRequest = z.infer<typeof recordMobMoveRequestSchema>;

/**
 * Record a feed-out (Phase 4e, FR-153): how much of a tracked feed lot went to a mob or a camp.
 * Mob XOR camp is not enforced HERE — both are nullable and either or both may be sent — because
 * the rule is enforced once, at the domain capture boundary (`recordFeedOut`, @werf/domain), the
 * same posture `recordMoveRequestSchema` takes for its own cross-field rule.
 *
 * `landUnitId`/`enterpriseId` are only ever TRUSTED from the client when `mobId` is absent: with a
 * mob named, the server DERIVES both from the mob's own current row (`livestock.service.ts`), the
 * identical reasoning `herdOfSubject` already applies to every other mob-scoped capture — feeding
 * mob X is meaningless if the event disagrees with mob X's actual camp. A camp-only feed-out (no
 * mob) has no subject to derive from, so `enterpriseId` is required THEN — enforced by FR-113's
 * existing `assertHerdScoped` guard at `insertEvent`, not duplicated here.
 *
 * There is no farmer-typed cost anywhere on this wire contract — see `feedPayloadSchema`'s own note.
 */
export const recordFeedRequestSchema = z.object({
  id: uuidV7Schema,
  farmId: uuidSchema,
  mobId: uuidSchema.nullable().default(null),
  landUnitId: uuidSchema.nullable().default(null),
  enterpriseId: uuidSchema.nullable().default(null),
  occurredAt: timestampSchema,
  inventoryLotId: uuidSchema,
  quantity: z.number().positive().finite(),
  notes: z.string().min(1).nullable().default(null),
});
export type RecordFeedRequest = z.infer<typeof recordFeedRequestSchema>;

/** Health capture (FR-130/131/132/133). Product and withdrawal facts are copied from the farmer's
 * own inventory entry. Werf preserves the snapshot and calculates reminder dates; it neither
 * verifies the label nor authorises the farmer's decision. */
const healthCaptureBase = {
  /** Client-generated UUIDv7 for the event row. */
  id: uuidV7Schema,
  farmId: uuidSchema,
  /** Exactly one of the two is the subject (a dip/vaccination is often a whole mob) — the rule is
   *  enforced in the domain fn, not duplicated here. */
  animalId: uuidSchema.nullable().default(null),
  mobId: uuidSchema.nullable().default(null),
  /** When it happened on the farm. Not `created_at` (set on write). */
  occurredAt: timestampSchema,
  /** The farm-local treatment DAY (YYYY-MM-DD) — the base for the withdrawal clear-date arithmetic. */
  administeredOn: dateSchema,
  /** The farm-owned medicine inventory item selected by the farmer. */
  productId: uuidSchema,
  productName: z.string().min(1),
  registrationNumber: z.string().min(1).nullable().default(null),
  meatWithdrawalDays: z.number().int().nonnegative().nullable().default(null),
  milkWithdrawalHours: z.number().int().nonnegative().nullable().default(null),
  /** Which herd/enterprise this event belongs to (FR-113). */
  enterpriseId: uuidSchema.nullable().default(null),
  /** Groups one dosing run across many animals (FR-112). */
  batchId: uuidSchema.nullable().default(null),
  locationGeojson: geoJsonStringSchema.nullable().default(null),
  notes: z.string().min(1).nullable().default(null),
} as const;

/** Record a treatment (FR-130/131): farmer product snapshot, batch, dose, route, giver and reason. */
export const recordTreatmentRequestSchema = z.object({
  ...healthCaptureBase,
  batch: z.string().min(1).optional(),
  doseValue: z.number().positive().optional(),
  doseUnit: z.string().min(1).optional(),
  // Reused from the treatment payload so the route vocabulary cannot drift between wire and event.
  route: treatmentRouteSchema.optional(),
  administeredBy: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
});
export type RecordTreatmentRequest = z.infer<typeof recordTreatmentRequestSchema>;

/** Record a vaccination (FR-132): the product, the programme it belongs to, batch, who gave it. */
export const recordVaccinationRequestSchema = z.object({
  ...healthCaptureBase,
  programme: z.string().min(1).optional(),
  batch: z.string().min(1).optional(),
  administeredBy: z.string().min(1).optional(),
});
export type RecordVaccinationRequest = z.infer<typeof recordVaccinationRequestSchema>;

/** Record a dip / tick treatment (FR-133): required in controlled areas (Animal Diseases Act). */
export const recordDipRequestSchema = z.object({
  ...healthCaptureBase,
  // Reused from the dip payload so the method vocabulary cannot drift between wire and event.
  method: dipPayloadSchema.shape.method,
  reason: z.string().min(1).optional(),
});
export type RecordDipRequest = z.infer<typeof recordDipRequestSchema>;

/**
 * Change a mob's head count, and say why (FR-102).
 *
 * A group-only flock has no individual `animals` rows, so there is nothing to record a death or a
 * sale against — which is why, before this capture existed, a 300-head flock could never become
 * 297 by any path in the product. The count moves by an append-only `tally` event; the mob row's
 * `head_count` is the denormalised current value, exactly as `animals.land_unit_id` is denormalised
 * while the move log is the history.
 *
 * `count` is what the farmer types, and it is always POSITIVE: "how many died", "how many were
 * born", and for a recount "how many there are". The SIGN is derived from the reason in the domain,
 * never sent — a client that could send a negative birth could corrupt a count in a way no later
 * read would catch.
 */
export const recordMobTallyRequestSchema = z
  .object({
    /** Client-generated UUIDv7 for the event row. */
    id: uuidV7Schema,
    farmId: uuidSchema,
    /** The mob whose head count is changing. Required — a tally with no mob has no subject. */
    mobId: uuidSchema,
    /** When it happened on the farm, not when it was captured. Reports read this. */
    occurredAt: timestampSchema,
    reason: tallyReasonSchema,
    /**
     * How many. Non-negative because a recount of an emptied camp is legitimately zero; a `death` of
     * zero is not, and the `tally` payload's own rule refuses it once the sign has been applied.
     */
    count: z.number().int().nonnegative(),
    /** Who the animals went to or came from. Meaningful on a sale or a purchase. */
    counterparty: z.string().min(1).optional(),
    /** Money as integer cents, never a float. The price of the whole lot, not per head. */
    priceCents: moneySchema.nonnegative().optional(),
    /**
     * The other group in a mob-to-mob move. Required on `transfer_in` / `transfer_out` and refused
     * on every other reason. Checked to be on THIS farm server-side, like every client-settable
     * reference — a transfer naming a neighbour's mob would carry a withholding across a boundary
     * that does not exist.
     */
    counterpartMobId: uuidSchema.optional(),
    /**
     * ⭐ The withdrawal the SELLER declared, on a `purchase` only, and it is the farmer's to send —
     * unlike every other regulated date in this product, which the server computes.
     *
     * That asymmetry is the point rather than an oversight. A treatment's clear date is derived from
     * a registered product and a treatment day the server can see; this one is a thing a seller SAID
     * about an animal nobody here watched being dosed. There is no reference row to resolve it from,
     * so the only honest options are to record what was said or to record nothing. Absent means
     * UNKNOWN HISTORY, and unknown is a legitimate answer for bought-in stock — inventing a period
     * would be the fabricated-regulated-number defect with extra steps.
     */
    declaredWithdrawalUntil: dateSchema.optional(),
    /**
     * ⭐ Ties the two halves of one group-to-group move together. A batch id on a NON-transfer reason
     * is refused by `recordMobTally` on both sides; the converse — that a transfer half must carry one
     * — is enforced only on the CAPTURING DEVICE (`useRecordTallies`), because that is the only place
     * it is knowable.
     *
     * ⛔ KNOWN GAP, stated rather than implied. The server cannot verify a pair: the halves arrive as
     * separate requests, possibly days apart, and nothing in the second identifies the first. So an
     * UNLINKED half, or an ORPHANED one whose sibling was refused or never sent, is accepted and is
     * not detectable server-side. Nothing reads `batch_id` anywhere yet.
     *
     * The consequence is a count that cannot be reconciled: head leave the source and arrive nowhere,
     * or arrive somewhere having left nowhere. The client outbox closes the common case — the halves
     * are one act on one device, the departure is sent first, and a refused departure holds the
     * arrival — but that is a device guarantee, not a boundary one. Closing it properly means either
     * accepting the pair as ONE request (atomic server-side) or an orphan-half reader on `/attention`,
     * which is where a count that cannot be reconciled belongs. Neither is built.
     *
     * A tally has one subject mob and one delta, so a move must be written as two events. This is the
     * only thing that says they are one action: without it a `transfer_in` can land after its
     * `transfer_out` was refused, and the destination gains head that never left anywhere.
     */
    batchId: uuidSchema.nullable().default(null),
    /** Herd attribution (FR-113). Derived from the mob server-side; this is the fallback. */
    enterpriseId: uuidSchema.nullable().default(null),
    locationGeojson: geoJsonStringSchema.nullable().default(null),
    notes: z.string().min(1).nullable().default(null),
  })
  .superRefine((request, ctx) => {
    // ⛔ Mirrors `tallyPayloadSchema`'s rule at the WIRE, so the refusal names the offending field
    // instead of surfacing as a generic "Invalid tally payload" from the domain one layer in. The
    // rule itself is stated once, where it is enforced on both sides — see `events.ts`. The reason
    // it matters most is `theft`: a named third party on a theft record is banned outright by
    // `.claude/rules/domain.md`.
    const isTrade = request.reason === 'sale' || request.reason === 'purchase';
    if (isTrade) return;
    if (request.counterparty !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['counterparty'],
        message: 'Only a sale or a purchase names the other party',
      });
    }
    if (request.priceCents !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['priceCents'],
        message: 'Only a sale or a purchase carries a price',
      });
    }
  });
export type RecordMobTallyRequest = z.infer<typeof recordMobTallyRequestSchema>;

/**
 * One entry in the farm's private interval-reminder history (FR-131). It compares a disposal with
 * farmer-entered withdrawal facts without judging or blocking the disposal.
 * It is re-derived across synced devices. `knownAtCapture` distinguishes a reminder available on
 * the recording device from a comparison discovered after another device's records arrived.
 */
export const residueFlagSchema = z.object({
  /** The stored disposal event this concerns. */
  eventId: uuidSchema,
  /** `sale`, `death` or `tally` — the three ways head leaves in Phase 2. */
  eventType: z.enum(['sale', 'death', 'tally']),
  /** The individual it happened to, or null for a group-only tally. */
  animalId: uuidSchema.nullable(),
  /** The mob it happened to, or null for an individual disposal. */
  mobId: uuidSchema.nullable(),
  /** Why the head left, for a tally. Absent on an individual sale or death. */
  reason: tallyReasonSchema.optional(),
  occurredAt: timestampSchema,
  /** The FARM-LOCAL day the disposal happened. Every withdrawal comparison is made on this. */
  occurredOn: dateSchema,
  /**
   * True when the head went into the FOOD CHAIN — a sale, a slaughter. A death or a theft reduces
   * the count identically and is on the register for the record, but it is not a residue event and
   * is still kept as a useful historic comparison.
   */
  intoFoodChain: z.boolean(),
  /**
   * The day the subject clears its withholding, as the server now knows it. Null when the stored
   * event carries the flag but no dose now backs it — a dose soft-deleted as a correction since.
   * The row stays on the register: a stamped circumstance that has stopped being derivable is
   * itself a fact, and dropping it silently would erase an audit trail rather than explain it.
   */
  clearFrom: dateSchema.nullable(),
  /** True when the disposal day falls inside that withholding — re-derived, not read off the row. */
  withinWithdrawal: z.boolean(),
  /**
   * True when the stored event already carried the flag, i.e. the server could see the dose when
   * the disposal was written. False means a later-arriving dose proved this after the fact — the
   * cross-device case, and the one nothing in the product could have caught at capture.
   */
  knownAtCapture: z.boolean(),
});
export type ResidueFlag = z.infer<typeof residueFlagSchema>;

/**
 * ⭐ The same contract as it exists ON THE WIRE and in a device's cache — `occurredAt` an ISO
 * string, not a `Date`.
 *
 * `timestampSchema` parses a string INTO a Date, so `ResidueFlag` describes the shape only after a
 * parse. A client that fetched this list and typed it as `ResidueFlag` would be holding strings and
 * calling Date methods on them, and the crash would arrive on a COLD START — the register survives
 * in `localStorage`, JSON has no Date, and the round-trip hands back exactly what it was given.
 * That is the same reason every capture store in this app keeps `occurredAt` as a string.
 *
 * Derived with `z.input` rather than hand-written, so it cannot drift from the schema it mirrors.
 */
export type ResidueFlagJson = z.input<typeof residueFlagSchema>;
