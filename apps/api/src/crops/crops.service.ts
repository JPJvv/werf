/**
 * Crop capture, Phase 4's own module — the server end of the offline flush for what happens ON a
 * block, as distinct from `LandService` (`land/`), which owns the ground itself (FR-150/FR-201/
 * FR-202: creating a block, walking its fence, splitting it). The same split `RainfallService`
 * already draws from `LandService`, for the same reason: a fact ABOUT a block and a fact about what
 * is grown IN it are different domains that happen to share a foreign key.
 *
 * The write discipline is the shared one (`common/event-capture`): everything runs through
 * `AppDb.asUser`, so RLS — not this file — is the tenancy boundary, and `insertEvent` is idempotent
 * on the client-generated id so an at-least-once flush never duplicates a planting. The block a
 * planting is pinned to is checked by `insertEvent` itself (`assertOwnedReferences`), the same as
 * rainfall's camp.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { AppDb } from '@werf/db';
import type { schemas } from '@werf/core';
import { recordPlanting } from '@werf/domain';
import { APP_DB } from '../db/db.module';
import { assertCanCapture, insertEvent, type CapturedEvent } from '../common/event-capture';

@Injectable()
export class CropsService {
  constructor(@Inject(APP_DB) private readonly app: AppDb) {}

  /**
   * Records a planting (FR-203) as an append-only `events` row. The pure domain function builds and
   * validates the event — the planted date IS `occurredAt`, there is no separate field for it — and
   * pins it to the block rather than a herd (FR-113's documented exception). This service supplies
   * only the I/O the domain cannot: the authenticated author and the RLS-bound insert.
   */
  async recordPlanting(
    userId: string,
    input: schemas.RecordPlantingRequest,
  ): Promise<CapturedEvent> {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);

      const event = recordPlanting({
        id: input.id,
        farmId: input.farmId,
        landUnitId: input.landUnitId,
        occurredAt: input.occurredAt,
        crop: input.crop,
        notes: input.notes,
        createdBy: userId,
        ...(input.cultivar === undefined ? {} : { cultivar: input.cultivar }),
        ...(input.density === undefined ? {} : { density: input.density }),
        ...(input.seedSource === undefined ? {} : { seedSource: input.seedSource }),
        ...(input.expectedHarvestDate === undefined
          ? {}
          : { expectedHarvestDate: input.expectedHarvestDate }),
      });

      return insertEvent(tx, event);
    });
  }
}
