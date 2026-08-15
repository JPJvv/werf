import { describe, expect, it } from 'vitest';
import { loginRequestSchema, passwordSchema, registerRequestSchema } from './auth';

const REGISTRATION = {
  business: {
    name: 'Rietfontein Boerdery',
    registrationNumber: null,
    contact: { email: 'kantoor@rietfontein.test', phone: '+27 51 555 0100' },
    physicalAddress: {
      line1: 'Plaas Rietfontein',
      line2: null,
      locality: 'Bothaville',
      province: 'Free State',
      postalCode: '9660',
    },
  },
  farm: {
    name: 'Rietfontein',
    province: 'Free State',
    district: null,
    enterpriseTypes: ['beef_cattle'],
  },
  owner: {
    fullName: 'Thabo Mokoena',
    email: 'thabo@rietfontein.test',
    password: 'correct horse battery staple',
    locale: 'en-ZA',
    theme: 'light',
  },
} as const;

describe('password migration policy', () => {
  it('requires fifteen characters for a newly created migration password', () => {
    expect(passwordSchema.safeParse('fourteen-char!').success).toBe(false);
    expect(passwordSchema.safeParse('fifteen-chars!!').success).toBe(true);
  });

  it('still accepts a bounded legacy password at sign-in so policy changes do not lock users out', () => {
    expect(
      loginRequestSchema.safeParse({
        email: 'owner@example.test',
        password: 'old-short',
        deviceLabel: null,
      }).success,
    ).toBe(true);
  });
});

describe('FR-001 registration details', () => {
  it('accepts a complete physical address and either business contact method', () => {
    expect(registerRequestSchema.safeParse(REGISTRATION).success).toBe(true);
    expect(
      registerRequestSchema.safeParse({
        ...REGISTRATION,
        business: {
          ...REGISTRATION.business,
          contact: { email: null, phone: '+27 82 555 0100' },
        },
      }).success,
    ).toBe(true);
  });

  it('rejects a registration with no business contact or an incomplete physical address', () => {
    expect(
      registerRequestSchema.safeParse({
        ...REGISTRATION,
        business: { ...REGISTRATION.business, contact: { email: null, phone: null } },
      }).success,
    ).toBe(false);
    expect(
      registerRequestSchema.safeParse({
        ...REGISTRATION,
        business: {
          ...REGISTRATION.business,
          physicalAddress: { ...REGISTRATION.business.physicalAddress, locality: '   ' },
        },
      }).success,
    ).toBe(false);
  });
});
