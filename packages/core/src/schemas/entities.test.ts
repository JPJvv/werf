import { describe, expect, it } from 'vitest';
import {
  businessSchema,
  enterpriseSchema,
  farmSchema,
  farmUserSchema,
  newBusinessSchema,
  newEnterpriseSchema,
  newFarmSchema,
  newFarmUserSchema,
  newUserSchema,
  userSchema,
} from './entities';

const ID = '018f8e2a-7b3c-7c4d-8e5f-0a1b2c3d4e5f';
const ID2 = '018f8e2a-7b3c-7c4d-8e5f-0a1b2c3d4e60';
const NOW = '2026-07-19T08:00:00.000Z';

describe('businessSchema', () => {
  it('accepts a record and coerces timestamps to Date', () => {
    const b = businessSchema.parse({
      id: ID,
      name: 'Rietfontein Boerdery',
      registrationNumber: null,
      vatNumber: null,
      contactEmail: 'kantoor@rietfontein.test',
      contactPhone: '+27 51 555 0100',
      physicalAddressLine1: 'Plaas Rietfontein',
      physicalAddressLine2: null,
      physicalAddressLocality: 'Bothaville',
      physicalAddressProvince: 'Free State',
      physicalAddressPostalCode: '9660',
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    });
    expect(b.createdAt).toBeInstanceOf(Date);
    expect(b.deletedAt).toBeNull();
  });

  it('newBusinessSchema defaults the optional fields to null', () => {
    const b = newBusinessSchema.parse({ id: ID, name: 'Rietfontein Boerdery' });
    expect(b.registrationNumber).toBeNull();
    expect(b.vatNumber).toBeNull();
    expect(b.contactEmail).toBeNull();
    expect(b.physicalAddressLine1).toBeNull();
  });
});

describe('farmSchema', () => {
  it('locks jurisdiction to a supported value', () => {
    expect(() =>
      farmSchema.parse({
        id: ID,
        businessId: ID2,
        name: 'Rietfontein',
        jurisdiction: 'NA',
        province: 'Free State',
        district: null,
        enterpriseTypes: ['beef_cattle'],
        hectares: null,
        timezone: 'Africa/Johannesburg',
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      }),
    ).toThrow();
  });

  it('newFarmSchema requires at least one enterprise type and defaults ZA + Joburg tz', () => {
    const f = newFarmSchema.parse({
      id: ID,
      businessId: ID2,
      name: 'Rietfontein',
      province: 'Free State',
      enterpriseTypes: ['beef_cattle', 'row_crops'],
    });
    expect(f.jurisdiction).toBe('ZA');
    expect(f.timezone).toBe('Africa/Johannesburg');

    expect(() =>
      newFarmSchema.parse({
        id: ID,
        businessId: ID2,
        name: 'Rietfontein',
        province: 'Free State',
        enterpriseTypes: [],
      }),
    ).toThrow();
  });
});

describe('userSchema', () => {
  it('requires an email or a phone', () => {
    expect(() =>
      userSchema.parse({
        id: ID,
        email: null,
        phone: null,
        fullName: 'Thabo',
        locale: 'en-ZA',
        theme: 'light',
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      }),
    ).toThrow();
  });

  it('newUserSchema defaults locale en-ZA and theme light', () => {
    const u = newUserSchema.parse({ id: ID, email: 'thabo@example.test', fullName: 'Thabo' });
    expect(u.locale).toBe('en-ZA');
    expect(u.theme).toBe('light');
    expect(u.phone).toBeNull();
  });

  it('accepts a phone-only user', () => {
    const u = newUserSchema.parse({ id: ID, phone: '+27820000000', fullName: 'Nomsa' });
    expect(u.email).toBeNull();
    expect(u.phone).toBe('+27820000000');
  });
});

describe('farmUserSchema', () => {
  it('validates a per-farm role and defaults external grant fields to null', () => {
    const fu = newFarmUserSchema.parse({ id: ID, farmId: ID2, userId: ID, role: 'manager' });
    expect(fu.role).toBe('manager');
    expect(fu.scope).toBeNull();
    expect(fu.expiresAt).toBeNull();
  });

  it('rejects an unknown role', () => {
    expect(() =>
      farmUserSchema.parse({
        id: ID,
        farmId: ID2,
        userId: ID,
        role: 'superadmin',
        scope: null,
        expiresAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      }),
    ).toThrow();
  });
});

describe('enterpriseSchema', () => {
  it('newEnterpriseSchema defaults active true', () => {
    const e = newEnterpriseSchema.parse({
      id: ID,
      farmId: ID2,
      name: 'Beef cattle',
      type: 'beef_cattle',
    });
    expect(e.active).toBe(true);
  });

  it('rejects an unknown enterprise type', () => {
    expect(() =>
      enterpriseSchema.parse({
        id: ID,
        farmId: ID2,
        name: 'Ostriches',
        type: 'ostrich',
        active: true,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      }),
    ).toThrow();
  });
});
