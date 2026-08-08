/**
 * Batch capture (FR-112): apply one event to a selected group in a single action, tying the whole
 * group together with ONE `batch_id` — a dosing run, a weigh session, a mob walked to a new camp.
 * The shared id lets the group be reviewed, filtered, or corrected as a unit downstream.
 *
 * Pure (.claude/rules/domain.md): the `batchId` (a client UUIDv7) is injected and `record` is one
 * of the capture functions in this package. Each animal keeps its own event id and subject; only
 * the batch id is shared, and it OVERRIDES any id on the individual input so the group is coherent.
 */

import { ValidationError } from '@werf/core';

export function recordBatch<I extends { batchId?: string | null }, R>(
  batchId: string,
  inputs: readonly I[],
  record: (input: I) => R,
): R[] {
  if (inputs.length === 0) {
    throw new ValidationError('A batch operation needs at least one animal');
  }
  return inputs.map((input) => record({ ...input, batchId }));
}
