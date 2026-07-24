/**
 * Livestock capture: the server-side write path for the things a farmer records in the field
 * (Phase 2). Four captures land here today — an animal (the herd row), and three append-only
 * `events`: a weight (FR-140), a death (FR-105) and a sale (FR-106). They are the server end of
 * the best-effort flush the client runs on reconnect, so the offline captures finally reach
 * Postgres ahead of the Phase 3 sync engine.
 *
 * Where the work actually happens: the pure domain functions (@werf/domain) build and validate
 * each event; this service only supplies the I/O they cannot — the authenticated author, the
 * RLS-bound insert, and the animal-status lookup a lifecycle guard needs. Everything runs
 * through `AppDb.asUser`, so a bug in this file still cannot write to another farm: the WITH
 * CHECK policy refuses an insert whose farm_id is not one of the caller's, exactly as the
 * tenancy tests prove. The membership check here is not the security boundary — RLS is — it
 * exists to turn "not your farm" into a clean 404 and "wrong role" into a 403.
 *
 * Every write is IDEMPOTENT on the client-generated id (`onConflictDoNothing`, then read the
 * existing row back). The flush is at-least-once — a POST whose 201 is lost on the way home is
 * retried on the next reconnect — and re-sending an already-stored capture must be a no-op, not
 * a duplicate row or a primary-key crash. The event log stays append-only; a re-flush changes
 * nothing.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { animals, events, farmUsers, type AppDb } from '@werf/db';
import { NotFoundError, TenancyError, type UserRole, type schemas } from '@werf/core';
import { recordDeath, recordSale, recordWeight } from '@werf/domain';
import { APP_DB } from '../db/db.module';

/**
 * Roles that may capture livestock events — the people who work stock. A bookkeeper (finance
 * only), a viewer (read only) and an external party (e.g. an auditor) cannot. The reference
 * user, a worker in the crush, is deliberately included: capture is the job.
 */
const CAPTURE_ROLES: readonly UserRole[] = ['owner', 'manager', 'worker'];

/** The `events` columns returned to the caller — every column EXCEPT the PostGIS `location`,
 *  which is geometry (neverSyncColumns), has no meaning to the client, and never goes on the wire. */
const eventProjection = {
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

type CaptureTx = Parameters<Parameters<AppDb['asUser']>[1]>[0];

/** The persisted animal as returned to the caller. */
export type CapturedAnimal = Awaited<ReturnType<LivestockService['recordAnimal']>>;
/** The persisted event as returned to the caller — the PostGIS `location` column is never on the wire. */
export type CapturedEvent = Awaited<ReturnType<LivestockService['recordWeight']>>;

@Injectable()
export class LivestockService {
  constructor(@Inject(APP_DB) private readonly app: AppDb) {}

  /**
   * Creates an animal (FR-101) as a herd row. This is the FK root the flush sends FIRST: a
   * weight, death or sale event references `animals(id)`, so an event that arrived before its
   * animal would fail the foreign key against a row Postgres has never seen. The body is the
   * client's own `newAnimal` shape — its UUIDv7 id and every field it captured offline; the
   * author is the session, never the body.
   */
  async recordAnimal(
    userId: string,
    input: schemas.RecordAnimalRequest,
  ): Promise<typeof animals.$inferSelect> {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);

      const [row] = await tx
        .insert(animals)
        .values({
          id: input.id,
          farmId: input.farmId,
          enterpriseId: input.enterpriseId,
          species: input.species,
          breed: input.breed,
          sex: input.sex,
          dob: input.dob,
          dobEstimated: input.dobEstimated,
          status: input.status,
          statusAt: input.statusAt,
          damId: input.damId,
          sireId: input.sireId,
          mobId: input.mobId,
          landUnitId: input.landUnitId,
          source: input.source,
          acquiredAt: input.acquiredAt,
          brandId: input.brandId,
          brandAppliedAt: input.brandAppliedAt,
          attributes: input.attributes,
          photoKey: input.photoKey,
          createdBy: userId,
        })
        // Idempotent: a re-flush of an already-stored animal is a no-op, not a PK crash.
        .onConflictDoNothing({ target: animals.id })
        .returning();

      if (row) return row;

      // The row was already here (a retried flush). Read it back through the farm's RLS scope.
      const [existing] = await tx
        .select()
        .from(animals)
        .where(and(eq(animals.id, input.id), eq(animals.farmId, input.farmId)));
      return existing!;
    });
  }

  /**
   * Records a weight reading (FR-140) as an append-only `events` row. Returns the persisted
   * event; the caller reads `occurredAt` (farm time) and `createdAt` (row written) as the two
   * distinct clocks the schema keeps apart.
   */
  async recordWeight(userId: string, input: schemas.RecordWeightRequest) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);

      // Pure domain: builds the envelope, validates the payload, enforces animal-xor-mob.
      const event = recordWeight({
        id: input.id,
        farmId: input.farmId,
        animalId: input.animalId,
        mobId: input.mobId,
        occurredAt: input.occurredAt,
        kg: input.kg,
        method: input.method,
        enterpriseId: input.enterpriseId,
        batchId: input.batchId,
        locationGeojson: input.locationGeojson,
        notes: input.notes,
        createdBy: userId,
      });

      return insertEvent(tx, event);
    });
  }

  /**
   * Records a death (FR-105) as an append-only `events` row. The animal's current status is
   * read (RLS-scoped) so the domain state machine can guard the transition to 'dead'; a death
   * of an animal this farm cannot see is a 404. The event is the durable fact — materialising
   * the animal row's status from the event log is a Phase 3 read-model concern, exactly as the
   * client projects status rather than editing the append-only herd row.
   */
  async recordDeath(userId: string, input: schemas.RecordDeathRequest) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      const currentStatus = await animalStatus(tx, input.farmId, input.animalId);

      const base = {
        id: input.id,
        farmId: input.farmId,
        animalId: input.animalId,
        occurredAt: input.occurredAt,
        currentStatus,
        cause: input.cause,
        createdBy: userId,
      };
      const { event } = recordDeath(
        input.disposal === undefined ? base : { ...base, disposal: input.disposal },
      );

      return insertEvent(tx, event);
    });
  }

  /**
   * Records a sale (FR-106) as an append-only `events` row. As with a death, the animal's
   * current status is read so the state machine can guard the transition to 'sold'. `priceCents`
   * is Money — integer cents, validated by the domain, never a float.
   */
  async recordSale(userId: string, input: schemas.RecordSaleRequest) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      const currentStatus = await animalStatus(tx, input.farmId, input.animalId);

      const base = {
        id: input.id,
        farmId: input.farmId,
        animalId: input.animalId,
        occurredAt: input.occurredAt,
        currentStatus,
        counterparty: input.counterparty,
        priceCents: input.priceCents,
        createdBy: userId,
      };
      const { event } = recordSale(
        input.weightKg === undefined ? base : { ...base, weightKg: input.weightKg },
      );

      return insertEvent(tx, event);
    });
  }
}

/**
 * Insert an event append-only and return the projected row. Idempotent on the composite
 * primary key `(id, farm_id)`: a re-flushed event does not create a duplicate or crash on the
 * key — the existing row is read back through the same RLS-bound connection.
 */
async function insertEvent(tx: CaptureTx, event: schemas.NewEvent) {
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
 * The current status of an animal on this farm, through the RLS-bound connection — so an animal
 * on another farm is invisible and reads as "not found", indistinguishable from one that does
 * not exist. A lifecycle event needs it as the FROM side of the state-machine transition guard.
 */
async function animalStatus(
  tx: CaptureTx,
  farmId: string,
  animalId: string,
): Promise<schemas.Animal['status']> {
  const [row] = await tx
    .select({ status: animals.status })
    .from(animals)
    .where(and(eq(animals.id, animalId), eq(animals.farmId, farmId), isNull(animals.deletedAt)));
  if (!row) throw new NotFoundError('Animal not found');
  return row.status;
}

/**
 * Confirms the caller may capture on this farm, through the RLS-bound connection. The SELECT
 * only sees the caller's ACCEPTED memberships (a pending invitation is invisible to
 * `app_user_farm_ids`), so a non-member — and a not-yet-accepted invitee — arrives as
 * "no such farm", indistinguishable from a farm that does not exist. A genuine member whose
 * role does not permit capture gets a role refusal, which says so.
 */
async function assertCanCapture(tx: CaptureTx, userId: string, farmId: string): Promise<void> {
  const [membership] = await tx
    .select({ role: farmUsers.role })
    .from(farmUsers)
    .where(
      and(eq(farmUsers.farmId, farmId), eq(farmUsers.userId, userId), isNull(farmUsers.deletedAt)),
    );

  if (!membership) throw new NotFoundError('Farm not found');
  if (!CAPTURE_ROLES.includes(membership.role)) {
    throw new TenancyError(`Role ${membership.role} may not capture livestock events`);
  }
}
