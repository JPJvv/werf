/**
 * Livestock capture: the server-side write path for the events the farmer records in the
 * field (Phase 2). The first capture is a weight (FR-140); treatments, moves, breeding and
 * the rest follow the identical shape.
 *
 * Where the work actually happens: the pure `recordWeight` domain function (@werf/domain)
 * builds and validates the `weight` event; this service only supplies the I/O it cannot —
 * the authenticated author, and the RLS-bound insert. Everything runs through `AppDb.asUser`,
 * so a bug in this file still cannot write to another farm: the events WITH CHECK policy
 * refuses an insert whose farm_id is not one of the caller's, exactly as the tenancy tests
 * prove. The membership check here is not the security boundary — RLS is — it exists to turn
 * "not your farm" into a clean 404 and "wrong role" into a 403, rather than a raw RLS throw.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { events, farmUsers, type AppDb } from '@werf/db';
import { NotFoundError, TenancyError, type UserRole, type schemas } from '@werf/core';
import { recordWeight } from '@werf/domain';
import { APP_DB } from '../db/db.module';

/**
 * Roles that may capture livestock events — the people who work stock. A bookkeeper (finance
 * only), a viewer (read only) and an external party (e.g. an auditor) cannot. The reference
 * user, a worker in the crush, is deliberately included: capture is the job.
 */
const CAPTURE_ROLES: readonly UserRole[] = ['owner', 'manager', 'worker'];

/** The persisted event as returned to the caller — the PostGIS `location` column is never on the wire. */
export type CapturedEvent = Awaited<ReturnType<LivestockService['recordWeight']>>;

@Injectable()
export class LivestockService {
  constructor(@Inject(APP_DB) private readonly app: AppDb) {}

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
        // Project every column EXCEPT `location`: it is PostGIS geometry (neverSyncColumns),
        // has no meaning to the client, and does not belong on the wire.
        .returning({
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
        });

      return row!;
    });
  }
}

/**
 * Confirms the caller may capture on this farm, through the RLS-bound connection. The SELECT
 * only sees the caller's ACCEPTED memberships (a pending invitation is invisible to
 * `app_user_farm_ids`), so a non-member — and a not-yet-accepted invitee — arrives as
 * "no such farm", indistinguishable from a farm that does not exist. A genuine member whose
 * role does not permit capture gets a role refusal, which says so.
 */
async function assertCanCapture(
  tx: Parameters<Parameters<AppDb['asUser']>[1]>[0],
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
    throw new TenancyError(`Role ${membership.role} may not capture livestock events`);
  }
}
