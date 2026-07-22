import { describe, expect, it } from 'vitest';
import { landUnitSchema, newLandUnitSchema } from './land';

const ID = '018f8e2a-7b3c-7c4d-8e5f-0a1b2c3d4e5f';
const ID2 = '018f8e2a-7b3c-7c4d-8e5f-0a1b2c3d4e60';
const NOW = '2026-07-22T08:00:00.000Z';

const POLYGON =
  '{"type":"Polygon","coordinates":[[[26.1,-29.1],[26.2,-29.1],[26.2,-29.2],[26.1,-29.1]]]}';

describe('landUnitSchema', () => {
  it('accepts a mapped camp and coerces timestamps to Date', () => {
    const c = landUnitSchema.parse({
      id: ID,
      farmId: ID2,
      enterpriseId: null,
      parentId: null,
      kind: 'camp',
      code: 'Camp 3',
      name: 'Rooikop',
      boundaryGeojson: POLYGON,
      hectares: 42.5,
      carryingCapacityLsu: 30,
      soilType: null,
      irrigation: null,
      attributes: {},
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    });
    expect(c.createdAt).toBeInstanceOf(Date);
    expect(c.kind).toBe('camp');
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      landUnitSchema.parse({
        id: ID,
        farmId: ID2,
        enterpriseId: null,
        parentId: null,
        kind: 'paddock',
        code: 'P1',
        name: null,
        boundaryGeojson: null,
        hectares: null,
        carryingCapacityLsu: null,
        soilType: null,
        irrigation: null,
        attributes: {},
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      }),
    ).toThrow();
  });

  it('rejects a boundaryGeojson that is not JSON with a type', () => {
    expect(() => landUnitSchema.shape.boundaryGeojson.parse('not json')).toThrow();
    expect(() => landUnitSchema.shape.boundaryGeojson.parse('{"coordinates":[]}')).toThrow();
    expect(landUnitSchema.shape.boundaryGeojson.parse(POLYGON)).toBe(POLYGON);
    expect(landUnitSchema.shape.boundaryGeojson.parse(null)).toBeNull();
  });

  it('rejects negative hectares', () => {
    expect(() => landUnitSchema.shape.hectares.parse(-1)).toThrow();
  });
});

describe('newLandUnitSchema', () => {
  it('requires only id, farmId, kind, code and defaults the rest', () => {
    const b = newLandUnitSchema.parse({ id: ID, farmId: ID2, kind: 'block', code: 'B12' });
    expect(b.enterpriseId).toBeNull();
    expect(b.parentId).toBeNull();
    expect(b.name).toBeNull();
    expect(b.boundaryGeojson).toBeNull();
    expect(b.hectares).toBeNull();
    expect(b.carryingCapacityLsu).toBeNull();
    expect(b.attributes).toEqual({});
  });

  it('requires a non-empty code', () => {
    expect(() =>
      newLandUnitSchema.parse({ id: ID, farmId: ID2, kind: 'camp', code: '' }),
    ).toThrow();
  });
});
