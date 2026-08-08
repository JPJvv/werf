/**
 * Rainfall capture (FR-213), the server end of the offline flush.
 *
 * Its own module rather than a livestock endpoint, because rain is not a livestock fact: grazing
 * rest and rotation read it, and so will cropping in Phase 4. Filing it under `/livestock` would
 * mean the crop side of a mixed farm reaching into the livestock module for its own rainfall — the
 * same mistake at the API layer that scoping the event to an enterprise would be at the data layer.
 *
 * The write discipline is the shared one (`common/event-capture`): everything runs through
 * `AppDb.asUser`, so RLS — not this file — is the tenancy boundary, and the insert is idempotent on
 * the client-generated id so an at-least-once flush never duplicates a reading.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { AppDb } from '@werf/db';
import type { schemas } from '@werf/core';
import { recordRainfall } from '@werf/domain';
import { APP_DB } from '../db/db.module';
import { assertCanCapture, insertEvent, type CapturedEvent } from '../common/event-capture';

@Injectable()
export class RainfallService {
  constructor(@Inject(APP_DB) private readonly app: AppDb) {}

  /**
   * Records a gauge reading (FR-213) as an append-only `events` row. The pure domain function
   * builds and validates the event — including that a 0 mm reading is kept, because a dry gauge is
   * data — and pins it to the farm rather than a herd. This service supplies only the I/O the
   * domain cannot: the authenticated author and the RLS-bound insert.
   */
  async recordRainfall(
    userId: string,
    input: schemas.RecordRainfallRequest,
  ): Promise<CapturedEvent> {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      // The camp a reading is pinned to is checked by `insertEvent`, which every capture funnels
      // through — see `assertOwnedReferences`.

      const event = recordRainfall({
        id: input.id,
        farmId: input.farmId,
        occurredAt: input.occurredAt,
        mm: input.mm,
        landUnitId: input.landUnitId,
        notes: input.notes,
        createdBy: userId,
        ...(input.gauge === undefined ? {} : { gauge: input.gauge }),
      });

      return insertEvent(tx, event);
    });
  }
}
