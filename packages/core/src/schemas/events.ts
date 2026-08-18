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

/**
 * Death (FR-105): the cause, and how the carcass was disposed of. Drives status → 'dead'.
 *
 * ⭐ `slaughtered` is a compliance-gated FLAG rather than a word in `cause`, and it is the whole
 * reason this schema is not just free text. An animal slaughtered on the farm goes into the food
 * chain exactly as a sale to an abattoir does, so FR-131's withdrawal guard has to fire for it — and
 * a guard cannot read "slaughtered for the workers' rations" out of a sentence someone typed. The
 * group path (`tally`) has had `slaughter` as a first-class reason since FR-102; without this the
 * individual path was the mirror image of the hole that closed.
 */
export const deathPayloadSchema = z.object({
  cause: z.string().min(1),
  disposal: z.string().min(1).optional(),
  /** True when the animal was slaughtered for consumption rather than found dead. */
  slaughtered: z.boolean().optional(),
  /**
   * True when the subject was inside an active MEAT WITHHOLDING on the day this was recorded.
   * Stamped server-side, never refused — see `recordDeath` in the livestock service.
   */
  withinWithdrawal: z.boolean().optional(),
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
/**
 * A bull window that runs backwards is not a window. The capture screen already refuses it, but the
 * screen is a preview of the rule and not the rule — the server is the boundary. `dateSchema` is a
 * lexicographically-sortable YYYY-MM-DD, so the comparison is a plain string one.
 */
export const bullWindowIsForward = (p: {
  readonly bullInAt?: string | undefined;
  readonly bullOutAt?: string | undefined;
}): boolean => p.bullInAt === undefined || p.bullOutAt === undefined || p.bullOutAt >= p.bullInAt;

/** The mating payload fields, without the cross-field window check — so request schemas can reuse the shape. */
export const matingPayloadShape = {
  method: z.enum(['natural', 'ai']),
  sireId: uuidSchema.optional(),
  sireCode: z.string().min(1).optional(),
  bullInAt: dateSchema.optional(),
  bullOutAt: dateSchema.optional(),
};

// The domain validates every payload through this schema (`buildBreedingEvent`), so the window
// order is enforced on write, not only at the screen.
export const matingPayloadSchema = z.object(matingPayloadShape).refine(bullWindowIsForward, {
  message: 'The bull-out date cannot be before the bull-in date',
  path: ['bullOutAt'],
});
export type MatingPayload = z.infer<typeof matingPayloadSchema>;

/**
 * Pregnancy diagnosis (FR-121): how it was checked, the result, and — when pregnant and a service
 * date is known — the projected due date. The due date is `matingDate + species gestation`, and the
 * gestation period is INJECTED reference data (not a magic number in code); the domain capture
 * computes and stores `dueDate` here so a report never re-derives it from a gestation that may have
 * been corrected later. A due date on an `open`/`uncertain` result is a contradiction and is absent.
 *
 * ⭐ The INPUTS to that arithmetic are stored alongside the output: `matingDate` (the service date)
 * and `gestationDays` (the figure used). A value used to compute a stored date and then thrown away
 * is one the next guard or report cannot check — the same defect `administeredOn` was added to the
 * health payload to close. It also means a species with no gestation figure keeps the honest fact
 * it CAN record — the service date and a positive result — without the projection it cannot.
 */
export const pregnancyTestPayloadSchema = z.object({
  method: z.enum(['palpation', 'ultrasound', 'blood', 'visual']),
  result: z.enum(['pregnant', 'open', 'uncertain']),
  /** The service date the due date was projected from. Stored only for a positive diagnosis. */
  matingDate: dateSchema.optional(),
  /** The injected species gestation used, in whole days. Present only when a due date was projected. */
  gestationDays: z.number().int().positive().optional(),
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
 *
 * ⭐ `administeredOn` — the farm-local day the dose was GIVEN — is stored alongside them, and it is
 * not a duplicate of the event's `occurred_at`. A dose is day-grained: the farmer knows the day and
 * nothing finer, so a back-dated capture FABRICATES an instant (midday) to fill `occurred_at`.
 * Every regulated question about this event is a question about the day — which withdrawal applied,
 * which mob the animal was in when it was dosed — and answering it by comparing a fabricated instant
 * against a real one is a coin flip dressed as logic. The day is the precision the data has, so the
 * day is what is recorded.
 */
const dosingFields = {
  /** The farm-local day the dose was given (YYYY-MM-DD). The base for every withdrawal comparison. */
  administeredOn: dateSchema,
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
  ...dosingFields,
});
export type TreatmentPayload = z.infer<typeof treatmentPayloadSchema>;

/** Vaccination (FR-132): the product, the programme it belongs to, batch, who gave it. */
export const vaccinationPayloadSchema = z.object({
  product: z.string().min(1),
  programme: z.string().min(1).optional(),
  batch: z.string().min(1).optional(),
  administeredBy: z.string().min(1).optional(),
  ...dosingFields,
});
export type VaccinationPayload = z.infer<typeof vaccinationPayloadSchema>;

/** Dip / tick treatment (FR-133): required in controlled areas (Animal Diseases Act 35 of 1984). */
export const dipPayloadSchema = z.object({
  product: z.string().min(1),
  method: z.enum(['plunge', 'spray', 'pour_on', 'hand']).optional(),
  reason: z.string().min(1).optional(),
  ...dosingFields,
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

/**
 * Why a mob's head count changed (FR-102). A group-only flock has no individual rows to record a
 * death or a sale against, so the count moves by a `tally` event — and it moves for a REASON, which
 * is the whole point: "297" with no history is a number a farmer cannot defend to an auditor, an
 * insurer, or the Stock Theft Unit.
 *
 * `theft` and `slaughter` are here because they are ordinary on a South African smallholding, not
 * because they are edge cases. A theft tally is a fact about the flock; it is NOT a theft REPORT
 * (FR-603), which is its own record with its own evidence — recording one here does not file the
 * other, and the screen says so.
 */
/**
 * ⭐ `transfer_in` / `transfer_out` are ONE action captured as TWO events, and the split is forced
 * by the sign rule rather than chosen.
 *
 * Splitting a dipped flock had to be expressed as a sale out and a purchase in, which trips the
 * food-chain guard on the way out — nothing was sold — and LAUNDERS the withholding on the way in,
 * because head arriving by `purchase` is unconditionally clear. Both halves are wrong, and the
 * second is the dangerous one.
 *
 * A single `transfer` reason cannot work here. A tally event has ONE subject mob and one delta, so
 * the same reason would have to mean "minus" on the source and "plus" on the destination — and the
 * sign is derived from the reason precisely so it is never the farmer's to type. Two reasons keep
 * that invariant intact: the capture screen writes both, so a farmer performs one action and the log
 * holds the two facts it consists of.
 *
 * ⭐ The two halves ARE linked, by the envelope's `batch_id` — and it is worth recording that this
 * comment CLAIMED that link for a year before it existed, while `recordMobTally` wrote `batchId:
 * null`. What the absence cost was real: the halves were two queue items with two ids, so a refused
 * `transfer_out` (the as-at fold finding the source short) did not hold back the `transfer_in`, and
 * the destination gained head that never left anywhere.
 *
 * The link is REQUIRED on both halves AT CAPTURE (`useRecordTallies` throws without it), because an
 * optional link is one a caller forgets and this one was forgotten. It is NOT required at the
 * server: it cannot verify a pair, and refusing a half would lose a real record. The outbox reads it
 * as the subject the second half is `guardedBy`, so the arrival is HELD, not refused, when the
 * departure did not land. ⛔ An orphaned half is therefore accepted and undetectable server-side —
 * a KNOWN GAP, stated in `recordMobTallyRequestSchema`.
 */
export const TALLY_INCREASES = ['birth', 'purchase', 'transfer_in'] as const;
export const TALLY_DECREASES = ['death', 'sale', 'theft', 'slaughter', 'transfer_out'] as const;
export const TALLY_REASONS = [...TALLY_INCREASES, ...TALLY_DECREASES, 'recount'] as const;
export const tallyReasonSchema = z.enum(TALLY_REASONS);
export type TallyReason = z.infer<typeof tallyReasonSchema>;

/** The two halves of a mob-to-mob move. Neither is a disposal; neither goes near the food chain. */
export const TALLY_TRANSFERS: readonly TallyReason[] = ['transfer_in', 'transfer_out'];

/**
 * A change to a mob's head count (FR-102).
 *
 * ⭐ The shape is split on purpose, and it is the sharp part of this event. A reason like `death` or
 * `birth` carries a signed `delta`, because deltas COMPOSE: two people each record three deaths on
 * their own phone in a dead zone, and 300 correctly becomes 294 when both land. An absolute count
 * in the same situation is last-write-wins and silently loses one of the two records — three animals
 * that died would still be in the count.
 *
 * A `recount` is the exception, and it is absolute for exactly the same reason it is trustworthy:
 * "I walked the camp and counted 297" supersedes whatever the running total believed, including
 * every adjustment before it. So it carries `countedHead` and no delta, and the projection RESETS
 * to it rather than adding. Encoding a recount as a delta would require the device to know the true
 * previous count, which is the thing the farmer has just discovered it did not know.
 */
export const tallyPayloadSchema = z
  .object({
    reason: tallyReasonSchema,
    /** Signed change in head. Present for every reason EXCEPT `recount`; never zero. */
    delta: z.number().int().optional(),
    /** The head physically counted. Present ONLY for `recount`; the projection resets to it. */
    countedHead: z.number().int().nonnegative().optional(),
    /** Who the animals went to or came from — a sale or a purchase (FR-106). */
    counterparty: z.string().min(1).optional(),
    /** Money as integer cents, never a float (CLAUDE.md § Money). The whole lot, not per head. */
    priceCents: moneySchema.nonnegative().optional(),
    /** True when the mob was inside an active meat withholding on the day of this tally. */
    withinWithdrawal: z.boolean().optional(),
    /** The OTHER mob in a mob-to-mob move. Required on both halves, absent on every other reason. */
    counterpartMobId: uuidSchema.optional(),
    /**
     * ⭐ The meat withholding the transferred head CARRY WITH THEM, computed server-side from the
     * SOURCE mob at the moment of the move and frozen onto both halves (ADR-0005, exactly as a
     * treatment's clear date is).
     *
     * This is what stops the laundering. A counted flock has no `animals` rows, so head moved out of
     * a dipped mob by tally leaves no per-head record anywhere — the destination's guard reads the
     * destination's doses and finds nothing, and forty dipped sheep become clear by walking through
     * a gate. Carrying the date on the event is the only place the fact can live when there are no
     * individual animals to hang it on.
     *
     * Absent means the source was carrying nothing, which is the ordinary case.
     */
    carriedWithholdUntil: dateSchema.optional(),
    /**
     * ⭐ The withdrawal the SELLER declared for bought-in head (a `purchase`), and it is optional on
     * purpose. Absent means UNKNOWN HISTORY — which is the honest answer for an animal whose
     * treatment nobody here witnessed.
     *
     * Inventing a period for stock we never saw dosed would be the same class of defect as
     * hardcoding a regulated number: a figure that looks authoritative and is made up. So an
     * undeclared purchase withholds nothing and claims nothing, and a declared one is recorded as
     * what it is — the seller's word, frozen at the moment of the deal.
     */
    declaredWithdrawalUntil: dateSchema.optional(),
  })
  .superRefine((payload, ctx) => {
    const isTransfer = (TALLY_TRANSFERS as readonly string[]).includes(payload.reason);
    if (isTransfer && payload.counterpartMobId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['counterpartMobId'],
        message: 'A transfer must name the other group',
      });
    }
    if (!isTransfer && payload.counterpartMobId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['counterpartMobId'],
        message: 'Only a transfer names another group',
      });
    }
    // A declared seller withdrawal is a fact about an ACQUISITION. On any other reason it would be
    // a number with nothing behind it, which is the defect the field exists to avoid.
    if (payload.declaredWithdrawalUntil !== undefined && payload.reason !== 'purchase') {
      ctx.addIssue({
        code: 'custom',
        path: ['declaredWithdrawalUntil'],
        message: 'Only a purchase can record a withdrawal declared by the seller',
      });
    }
    // ⛔ A COUNTERPARTY AND A PRICE BELONG TO A TRADE AND NOWHERE ELSE, and the sharp case is
    // `theft`: `.claude/rules/domain.md` bans a named third party on a theft record outright —
    // defamation exposure for the farmer, and processing data about suspected criminal behaviour
    // for us. Record facts. A stolen animal has no buyer, and the person a farmer suspects is not
    // a fact. (The statute and section live in `docs/00-business/legal-compliance.md` and the ZA
    // jurisdiction pack; `packages/core` is jurisdiction-neutral and names neither.)
    //
    // This lives at the BOUNDARY rather than only on the screen. The capture screen scopes both
    // fields to `sale`/`purchase`, which is where a farmer meets the rule — but a capture queued
    // before that screen existed still flushes through here, and the event log is append-only with
    // no edit path, so a name that lands is permanent. A guard only the client runs is not a
    // boundary; a guard only the server runs arrives after the truck has left. Both, always.
    //
    // ⭐ Enforced BEFORE the recount branch returns, so `recount` is covered too. The trade pair is
    // exactly the client's own `trade` gate in `AdjustMobScreen` — a schema that refused a reason
    // the screen still offers would queue a capture the device can never send, which reads as a
    // sync bug rather than as the mismatch it is.
    const isTrade = payload.reason === 'sale' || payload.reason === 'purchase';
    if (!isTrade) {
      if (payload.counterparty !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['counterparty'],
          message: 'Only a sale or a purchase names the other party',
        });
      }
      if (payload.priceCents !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['priceCents'],
          message: 'Only a sale or a purchase carries a price',
        });
      }
    }

    const isRecount = payload.reason === 'recount';
    if (isRecount) {
      if (payload.countedHead === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['countedHead'],
          message: 'A recount must carry the head actually counted',
        });
      }
      if (payload.delta !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['delta'],
          message: 'A recount is absolute and carries no delta',
        });
      }
      return;
    }
    if (payload.countedHead !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['countedHead'],
        message: 'Only a recount carries a counted head',
      });
    }
    if (payload.delta === undefined || payload.delta === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['delta'],
        message: 'A tally must change the head count',
      });
      return;
    }
    // The sign is not the farmer's to type — it follows from the reason, and a `death` that
    // ADDED head would be a corruption no later read could detect.
    const shouldIncrease = (TALLY_INCREASES as readonly string[]).includes(payload.reason);
    if (shouldIncrease !== payload.delta > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['delta'],
        message: `A '${payload.reason}' tally must ${shouldIncrease ? 'increase' : 'decrease'} the head count`,
      });
    }
  });
export type TallyPayload = z.infer<typeof tallyPayloadSchema>;

/**
 * A boundary walked on the ground with a GPS (FR-150).
 *
 * ⭐ The RING and the CORNERS are both stored, and neither is a duplicate of the other. The ring is
 * what the boundary IS; the corners are the evidence it rests on, and they carry the fix accuracy
 * the ring cannot — a shape walked at 40 m accuracy under trees and one walked at 4 m in the open
 * are the same polygon and are not the same claim. Keeping only the ring would be the defect
 * `administeredOn` was added to the health payload to close: a value computed from inputs that were
 * then thrown away is one no later reader can check.
 *
 * `areaHectares` is what the DEVICE measured from the ring, and it is deliberately not the same
 * field as `land_units.hectares` — which is the farmer's own declared figure, often off a title
 * deed. A walk that clipped a corner must never silently overwrite that. The two are shown side by
 * side and the farmer decides; ADR-0005's preview/authoritative split, in a different domain.
 */
export const boundaryWalkPayloadSchema = z.object({
  /** The closed ring as GeoJSON Polygon text. Crosses the wire as GeoJSON, never PostGIS. */
  boundaryGeojson: geoJsonStringSchema,
  /** The fixes the ring was built from, in walk order, each with the accuracy it was taken at. */
  corners: z
    .array(
      z.object({
        lon: z.number().gte(-180).lte(180),
        lat: z.number().gte(-90).lte(90),
        /** The radius the phone reported around this fix, in metres. */
        accuracyM: z.number().nonnegative().finite(),
      }),
    )
    .min(3),
  /** The area the ring encloses as measured ON THE DEVICE, in hectares. */
  areaHectares: z.number().nonnegative().finite(),
});
export type BoundaryWalkPayload = z.infer<typeof boundaryWalkPayloadSchema>;

/**
 * Why an inventory lot's quantity on hand changed (Phase 4e, FR-501). The identical shape as
 * `tallyPayloadSchema`, one field over: `received` and `consumed` carry a signed `delta` because
 * deltas COMPOSE (two people recording stock use on two phones in a dead zone must land on the
 * same total), and `counted` is absolute and RESETS the running total, because "I counted the
 * shelf and there are 40kg left" supersedes whatever the log believed.
 *
 * ⛔ Unlike a tally, a `consumed` movement that would take the quantity below zero is NEVER
 * refused (`recordInventoryMovement`, @werf/domain): a stock figure that is wrong is not a reason
 * to block the capture of a real farm event (a spray that happened), it is a reason to recount.
 * The projection floors at zero and the capture reports the shortfall for the caller to surface.
 */
export const INVENTORY_MOVEMENT_INCREASES = ['received'] as const;
export const INVENTORY_MOVEMENT_DECREASES = ['consumed'] as const;
export const INVENTORY_MOVEMENT_REASONS = [
  ...INVENTORY_MOVEMENT_INCREASES,
  ...INVENTORY_MOVEMENT_DECREASES,
  'counted',
] as const;
export const inventoryMovementReasonSchema = z.enum(INVENTORY_MOVEMENT_REASONS);
export type InventoryMovementReason = z.infer<typeof inventoryMovementReasonSchema>;

export const inventoryMovementPayloadSchema = z
  .object({
    reason: inventoryMovementReasonSchema,
    /** Signed change in quantity. Present for every reason EXCEPT `counted`; never zero. */
    delta: z.number().finite().optional(),
    /** The quantity physically counted. Present ONLY for `counted`; the projection resets to it. */
    countedQuantity: z.number().nonnegative().finite().optional(),
    /** Money as integer cents, never a float. What the delivery cost — only a receipt carries one. */
    unitCostCents: moneySchema.nonnegative().optional(),
  })
  .superRefine((payload, ctx) => {
    const isCounted = payload.reason === 'counted';
    if (isCounted) {
      if (payload.countedQuantity === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['countedQuantity'],
          message: 'A stock count must carry the quantity actually counted',
        });
      }
      if (payload.delta !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['delta'],
          message: 'A stock count is absolute and carries no delta',
        });
      }
      if (payload.unitCostCents !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['unitCostCents'],
          message: 'Only a receipt carries a cost',
        });
      }
      return;
    }
    if (payload.countedQuantity !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['countedQuantity'],
        message: 'Only a stock count carries a counted quantity',
      });
    }
    if (payload.delta === undefined || payload.delta === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['delta'],
        message: 'A movement must change the quantity on hand',
      });
      return;
    }
    if (payload.reason !== 'received' && payload.unitCostCents !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['unitCostCents'],
        message: 'Only a receipt carries a cost',
      });
    }
    const shouldIncrease = (INVENTORY_MOVEMENT_INCREASES as readonly string[]).includes(
      payload.reason,
    );
    const shouldDecrease = (INVENTORY_MOVEMENT_DECREASES as readonly string[]).includes(
      payload.reason,
    );
    if (shouldIncrease && !(payload.delta > 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['delta'],
        message: `A '${payload.reason}' movement must increase the quantity on hand`,
      });
    }
    if (shouldDecrease && !(payload.delta < 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['delta'],
        message: `A '${payload.reason}' movement must decrease the quantity on hand`,
      });
    }
  });
export type InventoryMovementPayload = z.infer<typeof inventoryMovementPayloadSchema>;

/**
 * A crop planted in a block (FR-203): what, from what seed, and how thick. `landUnitId` is not part
 * of this payload — like every event, it is a field on the envelope (`eventObjectSchema`), never
 * duplicated into the type-specific shape.
 *
 * Every field but `crop` is optional: a farmer noting "planted maize in B12 today" while walking the
 * row knows what and where before they know the cultivar or the seed source, and refusing the
 * capture until all five are typed would cost the record, not just the extra detail.
 */
export const plantingPayloadSchema = z.object({
  crop: z.string().min(1),
  cultivar: z.string().min(1).optional(),
  /** Units vary too widely across crops (plants/ha for an orchard, kg/ha for a broadcast seed rate)
   *  for a closed set — the same reasoning FR-201 applied to `soilType`. */
  density: z
    .object({
      value: z.number().positive().finite(),
      unit: z.string().min(1),
    })
    .optional(),
  seedSource: z.string().min(1).optional(),
  /** A farming estimate, not a computed one — no regulated figure resolves it (ADR-0005 does not
   *  apply here). */
  expectedHarvestDate: dateSchema.optional(),
});
export type PlantingPayload = z.infer<typeof plantingPayloadSchema>;

/**
 * A fertiliser application (FR-206), including fertigation. `method` is not optional — it is the
 * field FR-206 itself names as the thing that distinguishes fertigation (through the irrigation
 * system) from broadcast/band (spread or placed on the ground), and a record that does not say
 * which is not the record FR-206 asks for. `rate` mirrors `planting.density`'s generic
 * `{ value, unit }` shape for the identical reason: kg/ha for a broadcast application and L/ha for
 * a fertigation run are both real, and a closed unit set would refuse one of them.
 */
export const fertiliserPayloadSchema = z.object({
  product: z.string().min(1),
  method: z.enum(['broadcast', 'band', 'fertigation', 'foliar']),
  rate: z
    .object({
      value: z.number().positive().finite(),
      unit: z.string().min(1),
    })
    .optional(),
  operator: z.string().min(1).optional(),
});
export type FertiliserPayload = z.infer<typeof fertiliserPayloadSchema>;

/**
 * A spray to GlobalGAP standard (FR-204) — COMPLIANCE-GATED (legal-compliance.md § 4,
 * .claude/rules/domain.md). The registered product, active ingredients, rate, water volume,
 * operator, equipment and weather at application, plus the pre-harvest interval computed AT
 * CAPTURE and stored (ADR-0005) — the exact discipline `dosingFields` below already proves for a
 * treatment's withdrawal, one field over.
 *
 * `productId` is stored, not a bare PHI number: the server resolves BOTH `activeIngredients` and
 * `phiDays` from the registered `chemical_products` row in force on `sprayedOn` and writes them
 * here, so a client can never claim a shorter PHI, or a different active ingredient, by relabelling
 * (the same property `treatmentPayloadSchema`'s `product` name-snapshot protects, applied here to
 * the FK itself so 4c·4's report and 4d's future guard can both resolve back to the exact
 * registration version that applied).
 *
 * `phiDays`/`earliestHarvestDate` are OPTIONAL and OMITTED — never zero — when the resolved
 * product carries no PHI on record. A null `phi_days` and a zero-day PHI are different facts
 * (`chemical_products.ts`'s module note), and the same "omit, don't zero" discipline
 * `attachDosing` already applies to a zero-withdrawal vaccine.
 *
 * `phiOverride` mirrors `harvestPayloadSchema`'s field of the same name exactly, one guard over
 * (`phi-guard.ts`'s `sprayPhiGuardFor`, legal-compliance.md § 4.3's spray-capture block): present
 * only when the spray-capture guard was blocked and the farmer overrode it. `by` is the acting
 * user id, resolved server-side from the session — never client input.
 */
export const sprayPayloadSchema = z.object({
  productId: uuidSchema,
  activeIngredients: z.array(z.string().min(1)).min(1),
  /** The farm-local day the spray was applied (YYYY-MM-DD) — the base for the PHI arithmetic, the
   *  same role `administeredOn` plays for a treatment (`dosingFields` below). */
  sprayedOn: dateSchema,
  rateLPerHa: z.number().positive().finite().optional(),
  waterLPerHa: z.number().positive().finite().optional(),
  operator: z.string().min(1).optional(),
  equipment: z.string().min(1).optional(),
  windKph: z.number().nonnegative().finite().optional(),
  tempC: z.number().finite().optional(),
  targetPest: z.string().min(1).optional(),
  /** Pre-harvest interval in whole days, resolved server-side. Absent = the registered product
   *  carries no PHI on record — never stored as 0. */
  phiDays: z.number().int().nonnegative().optional(),
  /** `sprayedOn` + `phiDays`, computed server-side and stored — never recomputed on read. Absent
   *  exactly when `phiDays` is absent. */
  earliestHarvestDate: dateSchema.optional(),
  phiOverride: z
    .object({
      reason: z.string().min(1),
      by: uuidSchema.optional(),
    })
    .optional(),
});
export type SprayPayload = z.infer<typeof sprayPayloadSchema>;

/**
 * A harvest (FR-207) — COMPLIANCE-GATED (legal-compliance.md § 4.3, US-030): 4d's PHI guard blocks
 * this at capture unless `phiOverride` is present. `quantity`/`unit` mirror `planting.density`'s
 * generic `{ value, unit }` shape one field flatter (a harvest has no second numeric field to pair a
 * unit with), because the unit varies by crop (kg for grain, bins for grapes, bags for potatoes) the
 * same way a fertiliser rate's does.
 *
 * `phiOverride.by` is the acting user id, resolved server-side from the authenticated session —
 * never client input (the same property `recordHarvestRequestSchema`'s own enumerated shape
 * protects, one layer out). Its presence is what distinguishes a deliberate, audited override
 * (FR-205's own words: "a written reason... is audited") from an ordinary harvest that happened to
 * clear its PHI on its own.
 */
export const harvestPayloadSchema = z.object({
  /** The farm-local day harvested (YYYY-MM-DD) — the day 4d's PHI guard judges, the same role
   *  `sprayedOn` plays for a spray, one field over. */
  harvestedOn: dateSchema,
  quantity: z.number().positive().finite(),
  unit: z.string().min(1),
  grade: z.string().min(1).optional(),
  destination: z.string().min(1).optional(),
  phiOverride: z
    .object({
      reason: z.string().min(1),
      /** Optional here for the identical reason `createdBy` is never client-set anywhere in this
       *  codebase: a LOCAL, not-yet-sent capture has a reason (the farmer just typed it) but no
       *  authoritative acting user to give — the server injects it from the session before this
       *  event is ever inserted (`crops.service.ts`). Present, always, on anything actually stored. */
      by: uuidSchema.optional(),
    })
    .optional(),
});
export type HarvestPayload = z.infer<typeof harvestPayloadSchema>;

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
  tally: tallyPayloadSchema,
  boundary_walk: boundaryWalkPayloadSchema,
  planting: plantingPayloadSchema,
  fertiliser: fertiliserPayloadSchema,
  spray: sprayPayloadSchema,
  harvest: harvestPayloadSchema,
  inventory_movement: inventoryMovementPayloadSchema,
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
  /** The inventory lot an `inventory_movement` concerns (Phase 4e, FR-501). Null on every other type. */
  inventoryLotId: uuidSchema.nullable(),
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
    inventoryLotId: eventObjectSchema.shape.inventoryLotId.default(null),
    locationGeojson: eventObjectSchema.shape.locationGeojson.default(null),
    notes: eventObjectSchema.shape.notes.default(null),
    createdBy: eventObjectSchema.shape.createdBy.default(null),
  })
  .superRefine(checkPayload);
export type NewEvent = z.infer<typeof newEventSchema>;
