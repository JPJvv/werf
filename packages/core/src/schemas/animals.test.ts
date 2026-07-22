import { describe, expect, it } from 'vitest';
import { animalSchema, newAnimalIdentifierSchema, newAnimalSchema, newMobSchema } from './animals';

const ID = '018f8e2a-7b3c-7c4d-8e5f-0a1b2c3d4e5f';
const ID2 = '018f8e2a-7b3c-7c4d-8e5f-0a1b2c3d4e60';
const NOW = '2026-07-22T08:00:00.000Z';

describe('newAnimalSchema', () => {
  it('requires only id, farmId, species, sex and defaults status alive', () => {
    const a = newAnimalSchema.parse({ id: ID, farmId: ID2, species: 'cattle', sex: 'female' });
    expect(a.status).toBe('alive');
    expect(a.dobEstimated).toBe(false);
    expect(a.attributes).toEqual({});
    expect(a.mobId).toBeNull();
    expect(a.photoKey).toBeNull();
  });

  it('rejects an unknown species', () => {
    expect(() =>
      newAnimalSchema.parse({ id: ID, farmId: ID2, species: 'ostrich', sex: 'female' }),
    ).toThrow();
  });

  it('accepts castrated as a first-class sex', () => {
    const a = newAnimalSchema.parse({ id: ID, farmId: ID2, species: 'cattle', sex: 'castrated' });
    expect(a.sex).toBe('castrated');
  });

  it('keeps dob a YYYY-MM-DD string, not a coerced Date (no off-by-one)', () => {
    const a = newAnimalSchema.parse({
      id: ID,
      farmId: ID2,
      species: 'sheep',
      sex: 'male',
      dob: '2025-08-14',
    });
    expect(a.dob).toBe('2025-08-14');
    expect(() =>
      newAnimalSchema.parse({
        id: ID,
        farmId: ID2,
        species: 'sheep',
        sex: 'male',
        dob: '2025-08-14T00:00:00Z',
      }),
    ).toThrow();
  });

  it('record schema coerces audit timestamps to Date but leaves dob a string', () => {
    const a = animalSchema.parse({
      id: ID,
      farmId: ID2,
      enterpriseId: null,
      species: 'goat',
      breed: 'Boer',
      sex: 'female',
      dob: '2024-01-02',
      dobEstimated: true,
      status: 'alive',
      statusAt: null,
      damId: null,
      sireId: null,
      mobId: null,
      landUnitId: null,
      source: null,
      acquiredAt: null,
      attributes: { horn_status: 'polled' },
      photoKey: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    });
    expect(a.createdAt).toBeInstanceOf(Date);
    expect(a.dob).toBe('2024-01-02');
  });
});

describe('newMobSchema', () => {
  it('defaults headCount and location to null (a mob need not be placed or counted)', () => {
    const m = newMobSchema.parse({ id: ID, farmId: ID2, name: 'Flock A', species: 'sheep' });
    expect(m.headCount).toBeNull();
    expect(m.landUnitId).toBeNull();
  });

  it('rejects a negative head count', () => {
    expect(() =>
      newMobSchema.parse({ id: ID, farmId: ID2, name: 'Flock A', species: 'sheep', headCount: -3 }),
    ).toThrow();
  });
});

describe('animalIdentifierSchema', () => {
  it('newAnimalIdentifierSchema defaults isPrimary false', () => {
    const i = newAnimalIdentifierSchema.parse({
      id: ID,
      farmId: ID2,
      animalId: ID,
      type: 'visual_tag',
      value: 'BT 042',
    });
    expect(i.isPrimary).toBe(false);
    expect(i.appliedAt).toBeNull();
  });

  it('rejects an unknown identifier type and an empty value', () => {
    expect(() =>
      newAnimalIdentifierSchema.parse({
        id: ID,
        farmId: ID2,
        animalId: ID,
        type: 'microchip',
        value: 'x',
      }),
    ).toThrow();
    expect(() =>
      newAnimalIdentifierSchema.parse({
        id: ID,
        farmId: ID2,
        animalId: ID,
        type: 'eid',
        value: '',
      }),
    ).toThrow();
  });
});
