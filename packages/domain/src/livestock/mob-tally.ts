/**
 * Mob head-count tally (FR-102) — the capture that lets a group-only flock's number change.
 *
 * The hole this fills: a mob is "Flock A: 300 head" with no individual `animals` rows behind it,
 * which is the model most South African smallholders actually run. Every way the product had to
 * reduce a count — `recordDeath`, `recordSale` — is recorded against an `animals.id`, and a mob has
 * none. So a flock could be created at 300 and stay 300 forever while lambs were born, ewes died
 * and hoggets went to the abattoir. That is not a missing nicety; it is a number the farmer looks
 * at every day being wrong, and a count nobody can correct is a count nobody trusts.
 *
 * ⭐ The count is a PROJECTION of this append-only log, not a field that is edited. Two reasons,
 * and the second is the one that decides the design:
 *
 *   1. A head count with no history cannot be defended. "297" is a number; "300, less three that
 *      died on 14 March, less nothing since" is a record — for an auditor, an insurer, or the Stock
 *      Theft Unit asking how many were in the camp before the fence was cut.
 *   2. The device is offline and there may be more than one. Two people each record three deaths in
 *      a dead zone on their own phone. Deltas COMPOSE — 300 becomes 294 when both land, which is the
 *      truth. An edited field is last-write-wins and lands on 297, silently keeping three dead
 *      animals in the count with nothing anywhere to show what was lost.
 *
 * A `recount` is the deliberate exception: absolute, and it supersedes everything before it, because
 * "I walked the camp and counted 297" is a stronger fact than any arithmetic on top of a number that
 * has just been shown to be wrong.
 *
 * Pure (.claude/rules/domain.md): no I/O, no clock. The event id is a client-generated UUIDv7 and
 * `occurredAt` is the farm-local instant it happened; both are injected at the I/O boundary, as is
 * `currentHead` — the count this adjustment is applied to, read from the mob's row by the caller.
 */

import { ValidationError, schemas } from '@werf/core';

/** The result of a tally capture: the event to append, and the head count it projects to. */
export interface MobTallyCapture {
  readonly event: schemas.NewEvent;
  /** The mob's head count after this adjustment — what the caller writes to the denormalised row. */
  readonly headCount: number;
}

export interface MobTallyInput {
  /** Client-generated UUIDv7 for the event row (injected — a v7 embeds a clock this package can't read). */
  readonly id: string;
  readonly farmId: string;
  readonly mobId: string;
  /** When the animals were born / died / left, on the farm. Not when it was captured. */
  readonly occurredAt: Date;
  readonly reason: schemas.TallyReason;
  /**
   * How many, as the farmer typed it — always positive. "Five died" is `5`, never `-5`; the sign
   * follows from the reason and is applied here, in one place. For a `recount` this is how many
   * there ARE, and zero is a legitimate answer: an emptied camp is a real observation.
   */
  readonly count: number;
  /**
   * The mob's head count before this adjustment, read from its row by the caller.
   *
   * `null` means the mob is not managed by head count at all — it is a bag of individually-recorded
   * animals, and its number comes from counting those. Adjusting it here would create a second,
   * competing count of the same animals, so it is refused rather than started.
   */
  readonly currentHead: number | null;
  readonly counterparty?: string | undefined;
  /** Integer cents (Money), never a float. The price of the whole lot, not per head. */
  readonly priceCents?: number | undefined;
  /** The mob was inside an active meat withholding on the day. Recorded, never refused. */
  readonly withinWithdrawal?: boolean | undefined;
  /** The other mob in a mob-to-mob move. Required on `transfer_in` / `transfer_out`. */
  readonly counterpartMobId?: string | undefined;
  /**
   * ⭐ Ties the two halves of ONE mob-to-mob move together (FR-102/FR-112). Refused on every reason
   * that is not a transfer; required on a transfer half BY THE CAPTURING DEVICE ONLY — see the ⛔
   * paragraph below, which this line used to contradict. The summary is what a reader sees on
   * hover, so it has to carry the qualification rather than leave it ten lines down.
   *
   * The two halves are two events with two ids because a tally has one subject mob and one delta —
   * the sign is derived from the reason so it is never the farmer's to type. Without something
   * holding them together they are two unrelated captures, and the flush could land the `transfer_in`
   * after the `transfer_out` was refused: the destination gains forty head that never left anywhere,
   * and the source keeps head it no longer has. The shared id is what lets the outbox hold the second
   * half back, and what lets a later reader see one action rather than two coincidences.
   *
   * ⛔ REQUIRED OF THE CAPTURE, NOT ENFORCED HERE — and the distinction is the contract. This
   * function ACCEPTS an unlinked half on purpose: the server runs it too, and it receives the halves
   * as separate requests, possibly days apart, with nothing in the second identifying the first. A
   * rule it cannot check is a rule that only loses records. `useRecordTallies` (the device, which is
   * the one place the pairing is knowable) refuses one, and that is where the test for it lives.
   *
   * The residual gap is stated rather than implied closed: a half that reaches the server alone is
   * accepted and cannot be reconciled. Earlier this docstring claimed the opposite, which is how
   * `recordMobTally` came to write `batchId: null` for a year under a comment claiming the halves
   * were "tied by the envelope's `batch_id`".
   */
  readonly batchId?: string | null | undefined;
  /**
   * The withholding the transferred head carry with them, resolved from the SOURCE mob by the
   * caller. Injected rather than computed here: it is a regulated date read from the event log,
   * which this package has no I/O to reach.
   */
  readonly carriedWithholdUntil?: string | undefined;
  /** The withdrawal the seller declared for bought-in head. Absent = unknown history, never guessed. */
  readonly declaredWithdrawalUntil?: string | undefined;
  /** The herd this event files under (FR-113) — resolved from the mob by the caller. */
  readonly enterpriseId?: string | null | undefined;
  readonly notes?: string | null | undefined;
  readonly locationGeojson?: string | null | undefined;
  readonly createdBy?: string | null | undefined;
}

const INCREASES: readonly string[] = schemas.TALLY_INCREASES;
const TRANSFERS: readonly string[] = schemas.TALLY_TRANSFERS;

/**
 * Build the tally event and the head count it projects to.
 *
 * Throws a typed `ValidationError` rather than clamping in every case, because each of these is a
 * farmer having meant something the app cannot infer. In particular a decrease larger than the
 * count on file is NOT silently floored at zero: the count being wrong is itself the news, and the
 * message says what to do about it, since a recount is the honest repair and the farmer is standing
 * in the camp.
 */
export function recordMobTally(input: MobTallyInput): MobTallyCapture {
  if (!Number.isInteger(input.count) || input.count < 0) {
    throw new ValidationError('A head count must be a whole number of animals, and never negative');
  }
  if (input.currentHead === null) {
    throw new ValidationError(
      'This group is managed as individual animals, so its number comes from counting them — record the death, sale or birth against the animal itself',
    );
  }

  const payload: Record<string, unknown> = { reason: input.reason };
  let headCount: number;

  if (input.reason === 'recount') {
    payload.countedHead = input.count;
    headCount = input.count;
  } else {
    if (input.count === 0) {
      throw new ValidationError(
        'A tally must change the head count — nothing changed by zero head',
      );
    }
    const increases = INCREASES.includes(input.reason);
    const delta = increases ? input.count : -input.count;
    headCount = input.currentHead + delta;
    if (headCount < 0) {
      throw new ValidationError(
        `There are ${input.currentHead} head on file in this group, so ${input.count} cannot leave it. If the number on file is wrong, count the group and record what you find`,
      );
    }
    payload.delta = delta;
  }

  if (input.counterparty !== undefined) payload.counterparty = input.counterparty;
  if (input.priceCents !== undefined) payload.priceCents = input.priceCents;
  if (input.withinWithdrawal) payload.withinWithdrawal = true;
  if (input.counterpartMobId !== undefined) payload.counterpartMobId = input.counterpartMobId;
  // Stored on BOTH halves of the move, not just the destination. The source's copy is what lets a
  // later reader see that the head which left was under a withholding at the time — a value used
  // for a decision and then discarded is one the next guard cannot check.
  if (input.carriedWithholdUntil !== undefined) {
    payload.carriedWithholdUntil = input.carriedWithholdUntil;
  }
  if (input.declaredWithdrawalUntil !== undefined) {
    payload.declaredWithdrawalUntil = input.declaredWithdrawalUntil;
  }
  // A group cannot be transferred into itself: it is not a move, it is a typo that would double the
  // flock's own withholding back onto it and read as a real event forever.
  if (input.counterpartMobId !== undefined && input.counterpartMobId === input.mobId) {
    throw new ValidationError('A group cannot be transferred into itself');
  }

  // A batch id on any other reason would claim this capture is part of an action it is not part of,
  // and a later reader following the link finds a move that never happened. A tally is one fact
  // about one mob; only a transfer is half of something bigger. Safe to enforce on both sides.
  const isTransfer = TRANSFERS.includes(input.reason);
  if (!isTransfer && input.batchId !== undefined && input.batchId !== null) {
    throw new ValidationError('Only a group-to-group move is captured as two linked halves');
  }
  // ⛔ THE CONVERSE — "a transfer half MUST carry one" — is deliberately NOT enforced here, and the
  // reason is worth keeping. It is a CAPTURE-TIME rule: only the device performing the move knows
  // that these two events are one act, and the server cannot check it at all — the halves arrive as
  // separate requests, possibly days apart, and nothing in the second identifies the first. So the
  // rule lives on the capture path (`useRecordTallies`), where it is knowable.
  //
  // Enforcing it here as well cost two things and bought nothing. It made the SERVER refuse an
  // unlinked half — which `offline-sync.md` §6 forbids ("never tighten a constraint in the same
  // release that starts enforcing it"), because a half already queued by an older client would 400
  // forever with nothing the farmer could do. And a refusal that loses a real record is the class
  // this repo has ruled against everywhere else: flag, never refuse.
  //
  // ⚠️ WHAT THIS LEAVES OPEN, stated rather than implied: an unlinked or orphaned half is accepted
  // and is not detectable server-side. See `recordMobTallyRequestSchema`.

  // Re-checked against the payload schema so the two rules — this function's and the schema's —
  // cannot drift apart, exactly as every other capture in this package does it.
  if (!schemas.tallyPayloadSchema.safeParse(payload).success) {
    throw new ValidationError('Invalid tally payload');
  }

  return {
    headCount,
    event: {
      id: input.id,
      farmId: input.farmId,
      type: 'tally',
      occurredAt: input.occurredAt,
      payload,
      enterpriseId: input.enterpriseId ?? null,
      syncedAt: null,
      animalId: null,
      mobId: input.mobId,
      landUnitId: null,
      employeeId: null,
      batchId: input.batchId ?? null,
      locationGeojson: input.locationGeojson ?? null,
      notes: input.notes ?? null,
      createdBy: input.createdBy ?? null,
    },
  };
}

/** One captured tally, as the projection reads it. The envelope's `id`, `mobId` and `occurredAt`. */
export interface TallyRecord {
  /**
   * The event's client-generated UUIDv7. Present for ORDERING, not for identity.
   *
   * ⭐ `occurredAt` alone is not a total order and cannot be. The capture screen asks for the DAY
   * something happened and stamps every tally on that day with the same instant, so two tallies
   * sharing an `occurredAt` is the normal case here rather than an edge one. Sorting by a key with
   * ties leaves the result dependent on the order the rows arrived in — which on the device is the
   * capture-store append order and on the server is whatever the query plan returned. Deltas
   * commute so pure deltas survive that; a recount does not, because it RESETS rather than adds.
   * The id breaks the tie identically on both sides, which is what makes the two projections the
   * same function. A v7 is time-ordered, so it also breaks it in capture order.
   */
  readonly id: string;
  readonly mobId: string;
  /** ISO instant. Sorted as a string, which is correct for ISO-8601 in a fixed zone. */
  readonly occurredAt: string;
  readonly reason: schemas.TallyReason;
  readonly delta?: number | undefined;
  readonly countedHead?: number | undefined;
}

/**
 * Fold a mob's tallies onto the head count it was created with (FR-102).
 *
 * The rule is the one the payload shape already implies: a delta ADDS to the running count, and a
 * recount RESETS it. Deltas after a recount still apply — three lambs born the day after the count
 * are three lambs — so this is a single forward pass in `occurredAt` order rather than "find the
 * last recount and add what follows", which would be the same thing written twice.
 *
 * The floor at zero is defensive, not a rule: `recordMobTally` already refuses a decrease that would
 * go negative. But this reads rows the DEVICE persisted, possibly written by an older client or
 * arriving out of order from two phones, and an offline-first read model that produced "-2 sheep"
 * would put a nonsense number on the home tile with no way for the farmer to clear it.
 *
 * ⭐ The order is TOTAL — `(occurredAt, id)`, never `occurredAt` alone. See `TallyRecord.id`: the
 * capture screen gives every tally on a day the same instant, so ties are ordinary, and a fold
 * containing a recount is not commutative. With only `occurredAt` the server and the device
 * genuinely could derive different counts for the same flock from the same log, because a stable
 * sort resolves ties to input order and the two sides receive the rows in different orders. The
 * caller must supply the same total order — the server's query orders by `(occurred_at, id)` for
 * exactly this reason.
 */
/** Byte order, the same order Postgres gives a timestamptz or a uuid. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function projectHeadCount(
  createdWith: number | null,
  tallies: readonly TallyRecord[],
): number | null {
  if (createdWith === null) return null;
  // ⭐ Plain `<`/`>`, never `localeCompare`. The invariant this projection defends is that the
  // server and an offline device cannot derive different counts from the same log — and the server
  // sorts in Postgres, on a `timestamptz` and a `uuid`, which is a byte comparison. `localeCompare`
  // is locale-sensitive by contract; it happens to agree for ISO timestamps and lowercase hex, but
  // "happens to agree" is not what an invariant is made of.
  const ordered = [...tallies].sort((a, b) => cmp(a.occurredAt, b.occurredAt) || cmp(a.id, b.id));
  let head = createdWith;
  for (const tally of ordered) {
    if (tally.reason === 'recount') {
      if (typeof tally.countedHead === 'number') head = tally.countedHead;
      continue;
    }
    if (typeof tally.delta === 'number') head += tally.delta;
  }
  return Math.max(0, head);
}
