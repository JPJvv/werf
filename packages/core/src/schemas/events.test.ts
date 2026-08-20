import { describe, expect, it } from 'vitest';
import { EVENT_TYPES } from '../events';
import { eventPayloadSchemaFor, eventPayloadSchemas, eventSchema, newEventSchema } from './events';

const ID = '018f8e2a-7b3c-7c4d-8e5f-0a1b2c3d4e5f';
const ID2 = '018f8e2a-7b3c-7c4d-8e5f-0a1b2c3d4e60';
const ID3 = '018f8e2a-7b3c-7c4d-8e5f-0a1b2c3d4e61';
const NOW = '2026-07-22T08:00:00.000Z';
const ON_FARM = '2026-07-15T05:30:00.000Z'; // occurred a week before it was written

const POINT = '{"type":"Point","coordinates":[26.1,-29.1]}';

describe('eventSchema — the envelope', () => {
  it('accepts a weight event and coerces the three timestamps to Date', () => {
    const e = eventSchema.parse({
      id: ID,
      farmId: ID2,
      enterpriseId: null,
      type: 'weight',
      occurredAt: ON_FARM,
      syncedAt: null,
      animalId: ID3,
      mobId: null,
      landUnitId: null,
      employeeId: null,
      batchId: null,
      inventoryLotId: null,
      payload: { kg: 412.5, method: 'scale' },
      locationGeojson: POINT,
      notes: null,
      createdBy: ID2,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    });
    expect(e.occurredAt).toBeInstanceOf(Date);
    // occurredAt (farm time) and createdAt (row written) are distinct — reports use occurredAt.
    expect(e.occurredAt.getTime()).toBeLessThan(e.createdAt.getTime());
  });

  it('validates the payload against the schema for its type (a weight needs a numeric kg)', () => {
    const base = {
      id: ID,
      farmId: ID2,
      enterpriseId: null,
      type: 'weight' as const,
      occurredAt: ON_FARM,
      syncedAt: null,
      animalId: ID3,
      mobId: null,
      landUnitId: null,
      employeeId: null,
      batchId: null,
      inventoryLotId: null,
      locationGeojson: null,
      notes: null,
      createdBy: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    };
    const bad = eventSchema.safeParse({ ...base, payload: { kg: 'heavy', method: 'scale' } });
    expect(bad.success).toBe(false);
    // The failure is reported under payload.kg, not at the envelope root.
    expect(bad.success === false && bad.error.issues[0]?.path).toEqual(['payload', 'kg']);
  });

  it('rejects a birth with an out-of-range ease score', () => {
    const r = eventSchema.safeParse({
      id: ID,
      farmId: ID2,
      enterpriseId: null,
      type: 'birth',
      occurredAt: ON_FARM,
      syncedAt: null,
      animalId: null,
      mobId: null,
      landUnitId: null,
      employeeId: null,
      batchId: null,
      inventoryLotId: null,
      payload: { calfId: ID3, damId: ID2, easeScore: 9, multiples: 1 },
      locationGeojson: null,
      notes: null,
      createdBy: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    });
    expect(r.success).toBe(false);
  });

  it('accepts an as-yet-untightened type with an open payload (condition_score)', () => {
    const r = eventSchema.safeParse({
      id: ID,
      farmId: ID2,
      enterpriseId: null,
      type: 'condition_score',
      occurredAt: ON_FARM,
      syncedAt: null,
      animalId: ID3,
      mobId: null,
      landUnitId: null,
      employeeId: null,
      batchId: null,
      inventoryLotId: null,
      payload: { score: 3, method: 'BCS' },
      locationGeojson: null,
      notes: null,
      createdBy: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    });
    expect(r.success).toBe(true);
  });

  it('validates a move payload against its now-concrete schema (the four location ids)', () => {
    const move = (payload: unknown) =>
      eventSchema.safeParse({
        id: ID,
        farmId: ID2,
        enterpriseId: null,
        type: 'move',
        occurredAt: ON_FARM,
        syncedAt: null,
        animalId: ID3,
        mobId: ID2,
        landUnitId: ID2,
        employeeId: null,
        batchId: null,
        inventoryLotId: null,
        payload,
        locationGeojson: null,
        notes: null,
        createdBy: null,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      }).success;

    expect(move({ fromLandUnitId: ID3, toLandUnitId: ID2, fromMobId: null, toMobId: ID2 })).toBe(
      true,
    );
    // A non-uuid land unit is a bad row, not an open free-for-all any more.
    expect(
      move({ fromLandUnitId: 'camp-3', toLandUnitId: ID2, fromMobId: null, toMobId: null }),
    ).toBe(false);
  });

  it('rejects a locationGeojson that is not a JSON object with a type', () => {
    const r = eventSchema.safeParse({
      id: ID,
      farmId: ID2,
      enterpriseId: null,
      type: 'weight',
      occurredAt: ON_FARM,
      syncedAt: null,
      animalId: ID3,
      mobId: null,
      landUnitId: null,
      employeeId: null,
      batchId: null,
      inventoryLotId: null,
      payload: { kg: 300, method: 'scale' },
      locationGeojson: 'not json',
      notes: null,
      createdBy: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    });
    expect(r.success).toBe(false);
  });

  it('exposes the per-type payload schema via the accessor', () => {
    expect(eventPayloadSchemaFor('weight')).toBe(eventPayloadSchemas.weight);
  });
});

describe('newEventSchema — what a client composes offline', () => {
  it('requires only id, farmId, type, occurredAt and payload; defaults the rest', () => {
    const e = newEventSchema.parse({
      id: ID,
      farmId: ID2,
      type: 'weight',
      occurredAt: ON_FARM,
      payload: { kg: 300, method: 'tape' },
    });
    expect(e.occurredAt).toBeInstanceOf(Date);
    expect(e.syncedAt).toBeNull(); // not yet synced
    expect(e.animalId).toBeNull();
    expect(e.batchId).toBeNull();
    expect(e.createdBy).toBeNull();
  });

  it('still validates the payload per type on the new shape', () => {
    expect(() =>
      newEventSchema.parse({
        id: ID,
        farmId: ID2,
        type: 'weight',
        occurredAt: ON_FARM,
        payload: { method: 'scale' }, // missing kg
      }),
    ).toThrow();
  });
});

describe('the payload registry', () => {
  it('has an entry for every event type, so no type is left unvalidatable', () => {
    for (const type of EVENT_TYPES) {
      expect(eventPayloadSchemas[type]).toBeDefined();
    }
  });

  it('now validates a sale payload (counterparty + non-negative cents)', () => {
    expect(
      eventPayloadSchemas.sale.safeParse({ counterparty: 'Abattoir X', priceCents: 1850000 })
        .success,
    ).toBe(true);
    // Missing counterparty, and a negative price, are both rejected — Money is integer cents ≥ 0.
    expect(eventPayloadSchemas.sale.safeParse({ priceCents: 1850000 }).success).toBe(false);
    expect(
      eventPayloadSchemas.sale.safeParse({ counterparty: 'X', priceCents: -100 }).success,
    ).toBe(false);
    expect(
      eventPayloadSchemas.sale.safeParse({ counterparty: 'X', priceCents: 12.5 }).success,
    ).toBe(false);
  });

  it('requires a cause on a death payload', () => {
    expect(eventPayloadSchemas.death.safeParse({ cause: 'tick-borne disease' }).success).toBe(true);
    expect(eventPayloadSchemas.death.safeParse({}).success).toBe(false);
  });
});
