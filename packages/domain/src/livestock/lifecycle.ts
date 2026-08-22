/**
 * Lifecycle event capture (FR-104/105/106/111): birth, death, sale, purchase, weaning. Each
 * function turns typed capture inputs into an append-only `events` row (a `NewEvent`) plus the
 * animal-status transition the event implies, enforcing the state machine in ./status.
 *
 * Pure (.claude/rules/domain.md): no I/O, no database, and — this is the sharp one — NO CLOCK.
 * The event id is a client-generated UUIDv7 and `occurredAt` is the farm-local instant the thing
 * happened; BOTH are injected by the caller at the I/O boundary. `occurredAt` is captured
 * separately from `created_at` (set server-side on write) because a farmer may record a calving
 * in a signal dead zone and sync a week later — reports read `occurredAt` (CLAUDE.md, § 5).
 *
 * These build the EVENT only. Minting the calf's `animals` row on a birth, and the herd-summary
 * that reads these events, are their own slices (the create-animal action is deferred too).
 */

import { type AnimalStatus, ValidationError, schemas } from '@werf/core';
import { canTransition } from './status';

/** A status transition an event implies. Absent when the event does not change the status. */
export interface StatusChange {
  readonly animalId: string;
  readonly status: AnimalStatus;
  readonly statusAt: Date;
}

/** The result of a capture: the event to append, and any status change to apply to the animal. */
export interface LifecycleCapture {
  readonly event: schemas.NewEvent;
  readonly statusChange?: StatusChange;
}

/** Fields every lifecycle capture carries. `animalId` is the subject — the dam, for a birth. */
export interface CaptureBase {
  /** Client-generated UUIDv7 for the event row (injected — a v7 embeds a clock this package can't read). */
  readonly id: string;
  readonly farmId: string;
  readonly animalId: string;
  /** When it happened on the farm (injected). Not `created_at`, which the server sets on write. */
  readonly occurredAt: Date;
  /** The animal's status right now — the FROM side of the transition guard. */
  readonly currentStatus: AnimalStatus;
  readonly createdBy?: string | null;
  readonly notes?: string | null;
  readonly locationGeojson?: string | null;
  /** Set when this capture is one of a batch applied to many animals in one action (FR-112). */
  readonly batchId?: string | null;
  /**
   * The herd this event is filed under (FR-113) — the animal's enterprise, resolved by the caller at
   * capture time and STAMPED here rather than joined on read. An animal can be moved between herds;
   * a report that joined events to the animal's CURRENT enterprise would quietly re-file last
   * season's dosing under the herd the animal is in today. The herd at the time of the event is the
   * fact worth keeping, for the same reason a withdrawal date is computed at capture (ADR-0005).
   */
  readonly enterpriseId?: string | null;
}

/**
 * Assemble a `NewEvent` from the common fields, a type, and a validated payload. The payload is
 * checked against its per-type schema here so a bad capture (a negative price, a zero weight)
 * fails loudly at the domain boundary with a typed error, not silently in the row.
 */
function buildEvent(
  base: CaptureBase,
  type: schemas.NewEvent['type'],
  payloadSchema: { safeParse: (v: unknown) => { success: boolean } },
  payload: Record<string, unknown>,
): schemas.NewEvent {
  if (!payloadSchema.safeParse(payload).success) {
    throw new ValidationError(`Invalid ${type} payload`);
  }
  return {
    id: base.id,
    farmId: base.farmId,
    type,
    occurredAt: base.occurredAt,
    payload,
    enterpriseId: base.enterpriseId ?? null,
    syncedAt: null,
    animalId: base.animalId,
    mobId: null,
    landUnitId: null,
    employeeId: null,
    batchId: base.batchId ?? null,
    inventoryLotId: null,
    locationGeojson: base.locationGeojson ?? null,
    notes: base.notes ?? null,
    createdBy: base.createdBy ?? null,
  };
}

/**
 * Guard and derive the status transition. Throws if the event would step the animal backwards to
 * a less-final status (you cannot sell a dead animal). Returns `undefined` when the status is
 * unchanged, so the caller writes a status row only when there is one to write.
 */
function transitionTo(base: CaptureBase, to: AnimalStatus): StatusChange | undefined {
  if (!canTransition(base.currentStatus, to)) {
    throw new ValidationError(
      `Cannot record this event on a '${base.currentStatus}' animal (would become '${to}')`,
    );
  }
  if (to === base.currentStatus) return undefined;
  return { animalId: base.animalId, status: to, statusAt: base.occurredAt };
}

/** Assemble the result, omitting `statusChange` entirely when the event does not change status. */
function capture(
  event: schemas.NewEvent,
  statusChange: StatusChange | undefined,
): LifecycleCapture {
  return statusChange === undefined ? { event } : { event, statusChange };
}

// ── Birth (FR-104) ─────────────────────────────────────────────────────────────
// The event is recorded against the DAM (its timeline shows the calving); the calf is referenced
// by id in the payload and its `animals` row is created by the caller. Requires a live dam.
export interface BirthInput extends CaptureBase {
  readonly calfId: string;
  readonly sireId?: string;
  readonly birthWeightKg?: number;
  readonly easeScore: 1 | 2 | 3 | 4 | 5;
  readonly multiples: number;
}

export function recordBirth(input: BirthInput): LifecycleCapture {
  const statusChange = transitionTo(input, 'alive'); // a dam must be alive to calve
  const payload: Record<string, unknown> = {
    calfId: input.calfId,
    damId: input.animalId,
    easeScore: input.easeScore,
    multiples: input.multiples,
  };
  if (input.sireId !== undefined) payload.sireId = input.sireId;
  if (input.birthWeightKg !== undefined) payload.birthWeightKg = input.birthWeightKg;
  return capture(buildEvent(input, 'birth', schemas.birthPayloadSchema, payload), statusChange);
}

// ── Death (FR-105) ─────────────────────────────────────────────────────────────
// Status → 'dead'. The animal is retained forever (soft-delete tombstone is a different thing);
// it is simply excluded from live counts. 'dead' is the most final status, so this is always
// a legal transition from any state.
export interface DeathInput extends CaptureBase {
  readonly cause: string;
  readonly disposal?: string;
  /**
   * Slaughtered for consumption rather than found dead. Carried as a stable flag so reports and
   * private reminders do not have to infer the fact from farmer-written cause text.
   */
  readonly slaughtered?: boolean;
  /** The animal was inside an active meat withholding on the day. Recorded, never refused. */
  readonly withinWithdrawal?: boolean;
}

export function recordDeath(input: DeathInput): LifecycleCapture {
  const statusChange = transitionTo(input, 'dead');
  const payload: Record<string, unknown> = { cause: input.cause };
  if (input.disposal !== undefined) payload.disposal = input.disposal;
  if (input.slaughtered) payload.slaughtered = true;
  if (input.withinWithdrawal) payload.withinWithdrawal = true;
  return capture(buildEvent(input, 'death', schemas.deathPayloadSchema, payload), statusChange);
}

// ── Sale / purchase (FR-106) ─────────────────────────────────────────────────────
export interface TradeInput extends CaptureBase {
  readonly counterparty: string;
  /** Integer cents (Money), never a float; non-negative. */
  readonly priceCents: number;
  readonly weightKg?: number;
}

function tradePayload(input: TradeInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    counterparty: input.counterparty,
    priceCents: input.priceCents,
  };
  if (input.weightKg !== undefined) payload.weightKg = input.weightKg;
  return payload;
}

/** A sale sends the animal out of the herd: status → 'sold'. */
export function recordSale(input: TradeInput): LifecycleCapture {
  const statusChange = transitionTo(input, 'sold');
  return capture(
    buildEvent(input, 'sale', schemas.tradePayloadSchema, tradePayload(input)),
    statusChange,
  );
}

/**
 * A purchase records an acquisition against an animal already in the herd (created via the
 * create-animal path with source/acquired_at set). It does not change status — the animal is
 * alive — so it requires a live animal and returns no status change.
 */
export function recordPurchase(input: TradeInput): LifecycleCapture {
  const statusChange = transitionTo(input, 'alive');
  return capture(
    buildEvent(input, 'purchase', schemas.tradePayloadSchema, tradePayload(input)),
    statusChange,
  );
}

// ── Weaning (FR-111) ─────────────────────────────────────────────────────────────
// No status change (the animal stays alive), but it must BE alive to be weaned.
export interface WeaningInput extends CaptureBase {
  readonly weightKg: number;
  readonly ageDays?: number;
}

export function recordWeaning(input: WeaningInput): LifecycleCapture {
  const statusChange = transitionTo(input, 'alive');
  const payload: Record<string, unknown> = { weightKg: input.weightKg };
  if (input.ageDays !== undefined) payload.ageDays = input.ageDays;
  return capture(buildEvent(input, 'weaning', schemas.weaningPayloadSchema, payload), statusChange);
}

// ── Missing (FR-605, stock theft) ───────────────────────────────────────────────────
// Mark an animal missing: status → 'missing' and timestamped (occurredAt). A last-seen point is a
// useful farmer-entered detail, not a condition for recording the fact. 'missing' is more final
// than 'alive' but less than sold/dead, so a sold or dead animal cannot be marked missing.
export interface MissingInput extends CaptureBase {
  /** The last-seen GPS location as GeoJSON, when available. */
  readonly lastSeenGeojson?: string;
  readonly cause?: string;
}

export function recordMissing(input: MissingInput): LifecycleCapture {
  const statusChange = transitionTo(input, 'missing');
  const payload: Record<string, unknown> = {};
  if (input.cause !== undefined) payload.cause = input.cause;
  const event = buildEvent(
    input.lastSeenGeojson === undefined
      ? input
      : { ...input, locationGeojson: input.lastSeenGeojson },
    'missing',
    schemas.eventPayloadSchemaFor('missing'),
    payload,
  );
  return capture(event, statusChange);
}
