/**
 * The shared server end of an offline capture: who may write, and how an append-only `events` row
 * is inserted. Extracted here because capture is not a livestock concern — rainfall (FR-213) is a
 * farm fact both grazing and cropping read, and the crop and labour modules will write to the same
 * append-only log in their phases. One implementation of the write discipline, used by all of them,
 * so a later module cannot quietly get the idempotency or the tenancy check subtly wrong.
 *
 * Nothing here opens a connection. Every function takes the RLS-bound transaction its caller
 * already has from `AppDb.asUser`, which is what makes RLS — not this code — the real tenancy
 * boundary: a bug in a caller still cannot write to another farm, because the WITH CHECK policy
 * refuses an insert whose farm_id is not one of the caller's.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { animals, events, farmUsers, landUnits, mobs, type AppDb } from '@werf/db';
import { NotFoundError, TenancyError, type UserRole, type schemas } from '@werf/core';
import { assertHerdScoped } from '@werf/domain';

/** The RLS-bound transaction handle a capture runs inside (from `AppDb.asUser`). */
export type CaptureTx = Parameters<Parameters<AppDb['asUser']>[1]>[0];

/**
 * Roles that may capture events — the people who work the farm. A bookkeeper (finance only), a
 * viewer (read only) and an external party (e.g. an auditor) cannot. The reference user, a worker
 * in the crush, is deliberately included: capture is the job.
 */
export const CAPTURE_ROLES: readonly UserRole[] = ['owner', 'manager', 'worker'];

/** The `events` columns returned to a caller — every column EXCEPT the PostGIS `location`, which is
 *  geometry (neverSyncColumns), has no meaning to the client, and never goes on the wire. */
export const eventProjection = {
  id: events.id,
  farmId: events.farmId,
  enterpriseId: events.enterpriseId,
  type: events.type,
  occurredAt: events.occurredAt,
  syncedAt: events.syncedAt,
  animalId: events.animalId,
  mobId: events.mobId,
  landUnitId: events.landUnitId,
  employeeId: events.employeeId,
  batchId: events.batchId,
  payload: events.payload,
  locationGeojson: events.locationGeojson,
  notes: events.notes,
  createdBy: events.createdBy,
  createdAt: events.createdAt,
  updatedAt: events.updatedAt,
  deletedAt: events.deletedAt,
} as const;

/** The persisted event as returned to a caller — the PostGIS `location` column is never on the wire. */
export type CapturedEvent = Awaited<ReturnType<typeof insertEvent>>;

/**
 * Insert an event append-only and return the projected row. Idempotent on the composite primary
 * key `(id, farm_id)`: the client flush is at-least-once — a 201 lost on the way home is retried on
 * the next reconnect — so a re-flushed event must be a no-op, not a duplicate row or a key crash.
 * The existing row is read back through the same RLS-bound connection.
 */
export async function insertEvent(tx: CaptureTx, event: schemas.NewEvent) {
  // FR-113: nothing enters the log unfiled. Checked HERE rather than in each capture so a capture
  // added in a later phase cannot skip it — the only way into `events` is through this function.
  assertHerdScoped(event);

  const [row] = await tx
    .insert(events)
    .values({
      id: event.id,
      farmId: event.farmId,
      enterpriseId: event.enterpriseId,
      type: event.type,
      occurredAt: event.occurredAt,
      syncedAt: event.syncedAt,
      animalId: event.animalId,
      mobId: event.mobId,
      landUnitId: event.landUnitId,
      employeeId: event.employeeId,
      batchId: event.batchId,
      payload: event.payload,
      locationGeojson: event.locationGeojson,
      notes: event.notes,
      createdBy: event.createdBy,
    })
    .onConflictDoNothing()
    .returning(eventProjection);

  if (row) return row;

  const [existing] = await tx
    .select(eventProjection)
    .from(events)
    .where(and(eq(events.id, event.id), eq(events.farmId, event.farmId)));
  return existing!;
}

/**
 * The herd (enterprise) an animal- or mob-scoped event belongs to, read from the SUBJECT's own row
 * through the RLS-bound connection (FR-113).
 *
 * Derived, never taken from the request. An animal is already filed under one herd, so asking the
 * client to restate it only creates a way for the two to disagree: a weight filed under the sheep
 * flock for a cow would corrupt exactly the per-herd history FR-113 exists to produce. It also means
 * a capture composed by an older client — which never knew about herd scoping — still files itself
 * correctly on arrival, which matters when a farmer syncs a fortnight of work after an app update.
 *
 * A subject this farm cannot see reads as "not found", indistinguishable from one that does not
 * exist. Returns null when the subject genuinely has no enterprise yet (an animal captured before
 * the farm split its herds); the FR-113 guard still passes, because the event names the animal.
 */
export async function herdOfSubject(
  tx: CaptureTx,
  farmId: string,
  subject: { animalId?: string | null; mobId?: string | null },
): Promise<string | null> {
  const animalId = subject.animalId ?? null;
  if (animalId !== null) {
    const [row] = await tx
      .select({ enterpriseId: animals.enterpriseId })
      .from(animals)
      .where(and(eq(animals.id, animalId), eq(animals.farmId, farmId), isNull(animals.deletedAt)));
    if (!row) throw new NotFoundError('Animal not found');
    return row.enterpriseId;
  }

  const mobId = subject.mobId ?? null;
  if (mobId !== null) {
    const [row] = await tx
      .select({ enterpriseId: mobs.enterpriseId })
      .from(mobs)
      .where(and(eq(mobs.id, mobId), eq(mobs.farmId, farmId), isNull(mobs.deletedAt)));
    if (!row) throw new NotFoundError('Mob not found');
    return row.enterpriseId;
  }

  // No subject to derive from. The caller supplies the enterprise itself (a herd-wide event), and
  // the FR-113 guard in `insertEvent` refuses the event if it names no herd at all.
  return null;
}

/**
 * The rows a capture may point AT, checked to be on the SAME farm.
 *
 * ⭐ This closes a hole that neither RLS nor the foreign keys catch. `animals.land_unit_id`
 * references `land_units(id)` with no farm qualifier, and Postgres performs referential-integrity
 * checks as the system rather than as the querying role — so RLS does not filter them. A WITH CHECK
 * policy validates the ROW's own `farm_id` and says nothing about what its columns reference. The
 * result is that a client could put its own animal in a NEIGHBOUR'S camp, or into their mob: the
 * insert is on the right farm, the FK target genuinely exists, and every policy is satisfied.
 *
 * Nothing leaks outward from that — the neighbour still cannot see the animal — but it corrupts
 * exactly the per-camp head counts and movement history the grazing and theft features are built on,
 * and a foreign key pointing across a tenancy boundary is the kind of thing that becomes unfixable
 * once there is data on it. So every reference is resolved through the RLS-bound connection with an
 * explicit farm match: a row on another farm is invisible and reads as "not found", the same answer
 * as one that does not exist.
 */
export async function assertOwnedReferences(
  tx: CaptureTx,
  farmId: string,
  refs: {
    landUnitId?: string | null;
    mobId?: string | null;
    damId?: string | null;
    sireId?: string | null;
  },
): Promise<void> {
  const checks: Array<[string | null | undefined, () => Promise<unknown[]>, string]> = [
    [
      refs.landUnitId,
      () =>
        tx
          .select({ id: landUnits.id })
          .from(landUnits)
          .where(
            and(
              eq(landUnits.id, refs.landUnitId!),
              eq(landUnits.farmId, farmId),
              isNull(landUnits.deletedAt),
            ),
          ),
      'Camp not found',
    ],
    [
      refs.mobId,
      () =>
        tx
          .select({ id: mobs.id })
          .from(mobs)
          .where(and(eq(mobs.id, refs.mobId!), eq(mobs.farmId, farmId), isNull(mobs.deletedAt))),
      'Mob not found',
    ],
    [refs.damId, () => animalOnFarm(tx, farmId, refs.damId!), 'Dam not found'],
    [refs.sireId, () => animalOnFarm(tx, farmId, refs.sireId!), 'Sire not found'],
  ];

  for (const [id, query, message] of checks) {
    if (id === null || id === undefined) continue;
    const rows = await query();
    if (rows.length === 0) throw new NotFoundError(message);
  }
}

function animalOnFarm(tx: CaptureTx, farmId: string, animalId: string) {
  return tx
    .select({ id: animals.id })
    .from(animals)
    .where(and(eq(animals.id, animalId), eq(animals.farmId, farmId), isNull(animals.deletedAt)));
}

/**
 * Confirms the caller may capture on this farm, through the RLS-bound connection. The SELECT only
 * sees the caller's ACCEPTED memberships (a pending invitation is invisible to
 * `app_user_farm_ids`), so a non-member — and a not-yet-accepted invitee — arrives as "no such
 * farm", indistinguishable from a farm that does not exist. A genuine member whose role does not
 * permit capture gets a role refusal, which says so.
 */
export async function assertCanCapture(
  tx: CaptureTx,
  userId: string,
  farmId: string,
): Promise<void> {
  const [membership] = await tx
    .select({ role: farmUsers.role })
    .from(farmUsers)
    .where(
      and(eq(farmUsers.farmId, farmId), eq(farmUsers.userId, userId), isNull(farmUsers.deletedAt)),
    );

  if (!membership) throw new NotFoundError('Farm not found');
  if (!CAPTURE_ROLES.includes(membership.role)) {
    throw new TenancyError(`Role ${membership.role} may not capture farm events`);
  }
}
