/**
 * Inventory stock movement (Phase 4e, FR-501), tested as a pure function and a pure fold. The
 * behaviour under test is the one a farmer observes: after recording what happened, does the lot
 * say the right quantity, and does the app never lose a real capture just because the shed card
 * was wrong?
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '@werf/core';
import {
  estimatedUnitCostCents,
  projectQuantityOnHand,
  recordInventoryMovement,
  type CostedReceipt,
  type InventoryMovementInput,
  type InventoryMovementRecord,
} from './stock';

const EVENT_ID = '01900000-0000-7000-8000-0000000000e1';
const FARM_ID = '01900000-0000-7000-8000-000000000f01';
const LOT_ID = '01900000-0000-7000-8000-0000000000l1';
const HERD_ID = '01900000-0000-7000-8000-000000000e01';
const USER_ID = '01900000-0000-7000-8000-000000000901';
const OCCURRED = new Date('2026-07-14T05:30:00Z'); // out at the shed; synced days later

function input(overrides: Partial<InventoryMovementInput> = {}): InventoryMovementInput {
  return {
    id: EVENT_ID,
    farmId: FARM_ID,
    inventoryLotId: LOT_ID,
    occurredAt: OCCURRED,
    reason: 'received',
    quantity: 40,
    currentQuantity: 0,
    enterpriseId: HERD_ID,
    createdBy: USER_ID,
    ...overrides,
  };
}

describe('recordInventoryMovement (FR-501) — the quantity moves, and says why', () => {
  it('receives 40kg into an empty lot', () => {
    const { event, quantityOnHand } = recordInventoryMovement(input());

    expect(quantityOnHand).toBe(40);
    expect(event.payload).toEqual({ reason: 'received', delta: 40 });
  });

  it('takes consumed stock off the quantity on hand', () => {
    const { quantityOnHand, event } = recordInventoryMovement(
      input({ reason: 'consumed', quantity: 12, currentQuantity: 40 }),
    );

    expect(quantityOnHand).toBe(28);
    expect(event.payload).toMatchObject({ reason: 'consumed', delta: -12 });
  });

  it('derives the sign from the reason, so a receipt can never decrease stock', () => {
    // The farmer types "10" for both. Nothing on the wire carries a sign for a client to get wrong.
    const received = recordInventoryMovement(
      input({ reason: 'received', quantity: 10, currentQuantity: 5 }),
    );
    const consumed = recordInventoryMovement(
      input({ reason: 'consumed', quantity: 10, currentQuantity: 15 }),
    );

    expect(received.quantityOnHand).toBe(15);
    expect(consumed.quantityOnHand).toBe(5);
  });

  it('keeps a receipt cost as integer cents', () => {
    const { event } = recordInventoryMovement(
      input({ reason: 'received', quantity: 40, unitCostCents: 128_000 }),
    );

    expect(event.payload).toMatchObject({ unitCostCents: 128_000 });
  });

  it('files the event under the lot and the herd, never against a mob or animal (FR-113)', () => {
    const { event } = recordInventoryMovement(input());

    expect(event.inventoryLotId).toBe(LOT_ID);
    expect(event.mobId).toBeNull();
    expect(event.animalId).toBeNull();
    expect(event.enterpriseId).toBe(HERD_ID);
    expect(event.type).toBe('inventory_movement');
  });

  it('keeps occurredAt as the day it happened, not the day it was captured', () => {
    const { event } = recordInventoryMovement(input());

    expect(event.occurredAt).toEqual(OCCURRED);
    expect(event.syncedAt).toBeNull();
  });
});

describe('recordInventoryMovement — a stock count is absolute', () => {
  it('sets the quantity to what was actually counted, ignoring what was on file', () => {
    const { quantityOnHand, event } = recordInventoryMovement(
      input({ reason: 'counted', quantity: 31, currentQuantity: 40 }),
    );

    expect(quantityOnHand).toBe(31);
    expect(event.payload).toEqual({ reason: 'counted', countedQuantity: 31 });
  });

  it('accepts a count of zero — an emptied shelf is a real observation', () => {
    const { quantityOnHand } = recordInventoryMovement(
      input({ reason: 'counted', quantity: 0, currentQuantity: 40 }),
    );

    expect(quantityOnHand).toBe(0);
  });

  it('can count a lot UP, which no delta reason could do for a shortfall that was over-recorded', () => {
    const { quantityOnHand } = recordInventoryMovement(
      input({ reason: 'counted', quantity: 60, currentQuantity: 40 }),
    );

    expect(quantityOnHand).toBe(60);
  });
});

describe('recordInventoryMovement — ⛔ a shortfall is recorded, never refused', () => {
  it('records a consume larger than the quantity on file, flags the shortfall, and floors at zero', () => {
    // The spray happened whether or not the shed card was accurate. Refusing here would lose the
    // record of a real farm event over a bookkeeping figure — the inverse of offline-first.
    const { quantityOnHand, shortfall, event } = recordInventoryMovement(
      input({ reason: 'consumed', quantity: 15, currentQuantity: 10 }),
    );

    expect(quantityOnHand).toBe(0);
    expect(shortfall).toBe(true);
    expect(event.payload).toMatchObject({ reason: 'consumed', delta: -15 });
  });

  it('reports no shortfall when there is enough on hand', () => {
    const { shortfall } = recordInventoryMovement(
      input({ reason: 'consumed', quantity: 10, currentQuantity: 10 }),
    );

    expect(shortfall).toBe(false);
  });
});

describe('recordInventoryMovement — what it refuses, and what it never refuses', () => {
  it('refuses a change of zero quantity, which records nothing while looking like work', () => {
    expect(() => recordInventoryMovement(input({ quantity: 0 }))).toThrow(ValidationError);
  });

  it('refuses a negative or non-finite quantity', () => {
    expect(() => recordInventoryMovement(input({ quantity: -3 }))).toThrow(ValidationError);
    expect(() => recordInventoryMovement(input({ quantity: Number.NaN }))).toThrow(ValidationError);
  });

  it('accepts a fractional quantity — kg and litres are not whole numbers', () => {
    expect(recordInventoryMovement(input({ quantity: 2.5 })).quantityOnHand).toBe(2.5);
  });

  it('refuses a cost on anything that is not a receipt', () => {
    expect(() =>
      recordInventoryMovement(
        input({ reason: 'consumed', quantity: 5, currentQuantity: 10, unitCostCents: 100 }),
      ),
    ).toThrow(ValidationError);
    expect(() =>
      recordInventoryMovement(
        input({ reason: 'counted', quantity: 5, currentQuantity: 10, unitCostCents: 100 }),
      ),
    ).toThrow(ValidationError);
  });
});

describe('projectQuantityOnHand (FR-501) — the fold two offline phones depend on', () => {
  const movement = (overrides: Partial<InventoryMovementRecord>): InventoryMovementRecord => ({
    id: EVENT_ID,
    inventoryLotId: LOT_ID,
    occurredAt: '2026-07-14T05:30:00.000Z',
    reason: 'received',
    delta: 40,
    ...overrides,
  });

  it('is zero for a lot with no movements yet — a lot has no baseline to start from', () => {
    expect(projectQuantityOnHand([])).toBe(0);
  });

  it('⭐ composes two independent offline captures instead of losing one', () => {
    // Two people, two phones, no signal, each records 12kg used. 24kg is gone; 16kg remains. An
    // edited quantity field would land on 28 and quietly keep 12kg that no longer exists.
    const quantity = projectQuantityOnHand([
      movement({ occurredAt: '2026-07-14T05:00:00.000Z', reason: 'received', delta: 40 }),
      movement({ occurredAt: '2026-07-14T06:00:00.000Z', reason: 'consumed', delta: -12 }),
      movement({ occurredAt: '2026-07-14T09:00:00.000Z', reason: 'consumed', delta: -12 }),
    ]);

    expect(quantity).toBe(16);
  });

  it('lets a stock count supersede every adjustment before it', () => {
    const quantity = projectQuantityOnHand([
      movement({ occurredAt: '2026-07-01T06:00:00.000Z', reason: 'received', delta: 40 }),
      movement({ occurredAt: '2026-07-02T06:00:00.000Z', reason: 'consumed', delta: -10 }),
      movement({
        occurredAt: '2026-07-03T06:00:00.000Z',
        reason: 'counted',
        countedQuantity: 25,
        delta: undefined,
      }),
    ]);

    expect(quantity).toBe(25);
  });

  it('still applies what happened AFTER a stock count', () => {
    const quantity = projectQuantityOnHand([
      movement({
        occurredAt: '2026-07-03T06:00:00.000Z',
        reason: 'counted',
        countedQuantity: 25,
        delta: undefined,
      }),
      movement({ occurredAt: '2026-07-05T06:00:00.000Z', reason: 'received', delta: 10 }),
    ]);

    expect(quantity).toBe(35);
  });

  it('folds in occurredAt order, not the order the captures arrived', () => {
    // A phone that was in a dead zone syncs a week late; its capture is OLDER than one already held.
    const late = movement({
      occurredAt: '2026-07-01T06:00:00.000Z',
      reason: 'received',
      delta: 10,
    });
    const count = movement({
      occurredAt: '2026-07-02T06:00:00.000Z',
      reason: 'counted',
      countedQuantity: 8,
      delta: undefined,
    });

    // Arriving in either order, the count is still the later fact and still wins.
    expect(projectQuantityOnHand([count, late])).toBe(8);
    expect(projectQuantityOnHand([late, count])).toBe(8);
  });

  /**
   * ⭐ The same regression `projectHeadCount`'s own test file documents, one domain over. A capture
   * screen that asks for the DAY something happened stamps every movement on that day with one
   * instant, so two movements sharing an `occurredAt` is the ORDINARY case, not an edge one.
   */
  describe('a total order, so the server and the phone cannot fold the same log differently', () => {
    const SAME_DAY = '2026-07-14T12:00:00.000Z';
    // Client UUIDv7s, so the ids sort in the order the captures were made.
    const FIRST = '01900000-0000-7000-8000-00000000aa01';
    const SECOND = '01900000-0000-7000-8000-00000000aa02';

    it('folds a count and a delta captured on the same day identically in either input order', () => {
      const used = movement({ id: FIRST, occurredAt: SAME_DAY, reason: 'consumed', delta: -3 });
      const count = movement({
        id: SECOND,
        occurredAt: SAME_DAY,
        reason: 'counted',
        countedQuantity: 27,
        delta: undefined,
      });

      // The count was captured second, so it is the later fact and it wins — whichever order the
      // rows are handed to the projection.
      expect(projectQuantityOnHand([used, count])).toBe(27);
      expect(projectQuantityOnHand([count, used])).toBe(27);
    });

    it('orders by occurredAt FIRST, so a later day still beats a smaller id', () => {
      const olderDayBiggerId = movement({
        id: SECOND,
        occurredAt: '2026-07-01T12:00:00.000Z',
        reason: 'counted',
        countedQuantity: 100,
        delta: undefined,
      });
      const laterDaySmallerId = movement({
        id: FIRST,
        occurredAt: '2026-07-20T12:00:00.000Z',
        reason: 'counted',
        countedQuantity: 25,
        delta: undefined,
      });

      expect(projectQuantityOnHand([olderDayBiggerId, laterDaySmallerId])).toBe(25);
      expect(projectQuantityOnHand([laterDaySmallerId, olderDayBiggerId])).toBe(25);
    });
  });

  it('never reports a negative quantity, whatever the device happens to hold', () => {
    const quantity = projectQuantityOnHand([movement({ reason: 'consumed', delta: -50 })]);

    expect(quantity).toBe(0);
  });
});

describe('estimatedUnitCostCents (Phase 4e, FR-153) — a cost basis two devices derive identically', () => {
  const receipt = (over: Partial<CostedReceipt>): CostedReceipt => ({
    quantity: 10,
    unitCostCents: 500,
    ...over,
  });

  it('is exactly the unit cost for a single receipt', () => {
    expect(estimatedUnitCostCents([receipt({ quantity: 40, unitCostCents: 1250 })])).toBe(1250);
  });

  it('weights across several receipts by quantity, not a plain average', () => {
    // 10 units at R5 and 40 units at R10 — a plain average would say R7.50, the weighted answer
    // leans toward the LARGER receipt.
    const cents = estimatedUnitCostCents([
      receipt({ quantity: 10, unitCostCents: 500 }),
      receipt({ quantity: 40, unitCostCents: 1000 }),
    ]);
    expect(cents).toBe(900); // (10*500 + 40*1000) / 50
  });

  it('is undefined for no receipts at all — an honest absence, never a guessed zero', () => {
    expect(estimatedUnitCostCents([])).toBeUndefined();
  });
});
