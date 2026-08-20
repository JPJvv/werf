/**
 * Reading the veterinary-product register (FR-131) against a real Postgres. The cases that matter
 * are all about WHICH rows come back, because the answer decides what a farmer may record and what
 * withdrawal the server will later store:
 *
 *  • Resolved by the FARM's jurisdiction, never the caller's — a ZA farm must not be able to
 *    borrow another country's (possibly shorter) withdrawal period.
 *  • Only registrations IN FORCE on the day asked about. A superseded version still matters for
 *    reading old events (the withdrawal that applied is stored on the event, ADR-0005) but must
 *    not be offered as something to select.
 *  • A non-member gets "no such farm" rather than a jurisdiction oracle.
 *
 * We never mock the DB (CLAUDE.md).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import {
  chemicalProducts,
  createAppDb,
  createElevatedDb,
  users,
  veterinaryProducts,
  type AppDb,
  type ElevatedDb,
} from '@werf/db';
import { startWerfTestDatabase, type WerfTestDatabase } from '@werf/db/testing';
import { NotFoundError, schemas } from '@werf/core';
import { APP_CONFIG, APP_DB, ELEVATED_DB } from '../db/db.module';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { TokenService } from '../auth/token.service';
import { TwoFactorService } from '../auth/two-factor.service';
import { PasskeyService } from '../auth/passkey.service';
import { RecoveryCodeService } from '../auth/recovery-code.service';
import { ReferenceService } from './reference.service';

const BOOT_TIMEOUT_MS = 180_000;

const registration = (label: string): schemas.RegisterRequest => ({
  business: {
    name: `${label} Boerdery`,
    registrationNumber: null,
    contact: { email: `${label.toLowerCase()}@example.test`, phone: null },
    physicalAddress: {
      line1: `${label} Plaas`,
      line2: null,
      locality: 'Bothaville',
      province: 'Free State',
      postalCode: '9660',
    },
  },
  farm: {
    name: `${label} Plaas`,
    province: 'Free State',
    district: null,
    enterpriseTypes: ['beef_cattle'],
  },
  owner: {
    fullName: `${label} Owner`,
    email: `${label.toLowerCase()}@werf.test`,
    password: 'correct horse battery staple',
    locale: 'en-ZA',
    theme: 'light',
  },
});

describe('the veterinary product register (FR-131)', () => {
  let pg: WerfTestDatabase;
  let app: AppDb;
  let elevated: ElevatedDb;
  let auth: AuthService;
  let service: ReferenceService;

  beforeAll(async () => {
    pg = await startWerfTestDatabase();
    app = createAppDb({ url: pg.appUrl });
    elevated = createElevatedDb({ url: pg.elevatedUrl });

    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        AuthService,
        SessionService,
        TokenService,
        TwoFactorService,
        PasskeyService,
        RecoveryCodeService,
        ReferenceService,
        {
          provide: APP_CONFIG,
          useValue: {
            port: 3000,
            databaseUrl: pg.appUrl,
            databaseElevatedUrl: pg.elevatedUrl,
            jwtSecret: 'test-signing-key-that-is-long-enough-32',
            piiEncryptionKey: randomBytes(32).toString('base64'),
          },
        },
        { provide: APP_DB, useValue: app },
        { provide: ELEVATED_DB, useValue: elevated },
      ],
    }).compile();

    auth = moduleRef.get(AuthService);
    service = moduleRef.get(ReferenceService);
  }, BOOT_TIMEOUT_MS);

  afterEach(async () => {
    await pg.reset();
  });

  afterAll(async () => {
    await app?.close();
    await elevated?.close();
    await pg?.stop();
  });

  async function tenant(label: string) {
    const session = await auth.register(registration(label));
    const [owner] = await elevated.db
      .select()
      .from(users)
      .where(eq(users.email, registration(label).owner.email));
    return { userId: owner!.id, farmId: session.activeFarmId! };
  }

  /** Reference data is written by the elevated admin path, never by a farmer. */
  async function aProduct(over: Partial<typeof veterinaryProducts.$inferInsert>) {
    const [row] = await elevated.db
      .insert(veterinaryProducts)
      .values({
        jurisdiction: 'ZA',
        name: 'Terramycin LA',
        activeIngredients: ['oxytetracycline'],
        species: ['cattle'],
        meatWithdrawalDays: 28,
        milkWithdrawalHours: 96,
        effectiveFrom: '2020-01-01',
        ...over,
      })
      .returning();
    return row!;
  }

  it('returns the products registered in this farm’s jurisdiction', async () => {
    const a = await tenant('Ref');
    await aProduct({ name: 'Terramycin LA' });

    const products = await service.listVeterinaryProducts(a.userId, a.farmId, '2026-07-25');

    expect(products.map((p) => p.name)).toEqual(['Terramycin LA']);
    expect(products[0]!.meatWithdrawalDays).toBe(28);
    // Milk is published in HOURS while meat is in DAYS — the register keeps them as published.
    expect(products[0]!.milkWithdrawalHours).toBe(96);
  });

  it('never offers another country’s registration, however short its withdrawal', async () => {
    // The whole reason jurisdiction is resolved from the FARM. A shorter foreign withdrawal on a
    // ZA carcass is a compliance failure, not a convenience.
    const a = await tenant('Ref');
    await aProduct({ name: 'ZA product' });
    await aProduct({ name: 'Elsewhere product', jurisdiction: 'NA', meatWithdrawalDays: 3 });

    const products = await service.listVeterinaryProducts(a.userId, a.farmId, '2026-07-25');

    expect(products.map((p) => p.name)).toEqual(['ZA product']);
  });

  it('offers only the registration in force on the day asked about', async () => {
    // A re-registration writes a new row and closes the old one. Selecting today must give today's
    // version; a client catching up after a fortnight offline asks for the day it is capturing FOR.
    const a = await tenant('Ref');
    await aProduct({
      name: 'Terramycin LA',
      effectiveFrom: '2020-01-01',
      effectiveTo: '2026-04-01',
      meatWithdrawalDays: 21,
    });
    await aProduct({
      name: 'Terramycin LA',
      effectiveFrom: '2026-04-01',
      meatWithdrawalDays: 28,
    });

    const now = await service.listVeterinaryProducts(a.userId, a.farmId, '2026-07-25');
    expect(now).toHaveLength(1);
    expect(now[0]!.meatWithdrawalDays).toBe(28);

    const before = await service.listVeterinaryProducts(a.userId, a.farmId, '2026-03-01');
    expect(before).toHaveLength(1);
    expect(before[0]!.meatWithdrawalDays).toBe(21);
  });

  it('[P1.3] returns EVERY version for the jurisdiction when no day is given, not just today’s', async () => {
    // The device's own cache refresh (referenceApi.listVeterinaryProducts) never sends `onDay` — it
    // needs the whole history so a treatment captured against a SUPERSEDED registration can still
    // resolve its clear date, and so a farmer back-dating a capture can select the version that was
    // actually in force on the day being captured, not today's.
    const a = await tenant('AllVersions');
    await aProduct({
      name: 'Terramycin LA',
      effectiveFrom: '2020-01-01',
      effectiveTo: '2026-04-01',
      meatWithdrawalDays: 21,
    });
    await aProduct({
      name: 'Terramycin LA',
      effectiveFrom: '2026-04-01',
      meatWithdrawalDays: 28,
    });

    const all = await service.listVeterinaryProducts(a.userId, a.farmId);

    expect(all).toHaveLength(2);
    expect(all.map((p) => p.meatWithdrawalDays).sort()).toEqual([21, 28]);
    expect(all.every((p) => p.effectiveFrom !== null)).toBe(true);
  });

  it('refuses a stranger as "no such farm" rather than answering for it', async () => {
    const a = await tenant('Ref');
    const b = await tenant('Other');
    await aProduct({});

    await expect(service.listVeterinaryProducts(b.userId, a.farmId, '2026-07-25')).rejects.toThrow(
      NotFoundError,
    );
  });

  describe('the chemical product register (FR-204/FR-508)', () => {
    /** Reference data is written by the elevated admin path, never by a farmer. */
    async function aChemicalProduct(over: Partial<typeof chemicalProducts.$inferInsert>) {
      const [row] = await elevated.db
        .insert(chemicalProducts)
        .values({
          jurisdiction: 'ZA',
          name: 'Cyprodinex 50 WG',
          registrationNumber: 'L1234',
          activeIngredients: ['cyprodinil'],
          crop: 'grapes',
          phiDays: 7,
          effectiveFrom: '2020-01-01',
          ...over,
        })
        .returning();
      return row!;
    }

    it('returns the products registered in this farm’s jurisdiction', async () => {
      const a = await tenant('CropRef');
      await aChemicalProduct({ name: 'Cyprodinex 50 WG' });

      const products = await service.listChemicalProducts(a.userId, a.farmId, '2026-10-05');

      expect(products.map((p) => p.name)).toEqual(['Cyprodinex 50 WG']);
      expect(products[0]!.phiDays).toBe(7);
    });

    it('never offers another country’s registration, however short its PHI', async () => {
      const a = await tenant('CropRef');
      await aChemicalProduct({ name: 'ZA product' });
      await aChemicalProduct({ name: 'Elsewhere product', jurisdiction: 'NA', phiDays: 1 });

      const products = await service.listChemicalProducts(a.userId, a.farmId, '2026-10-05');

      expect(products.map((p) => p.name)).toEqual(['ZA product']);
    });

    it('offers only the registration in force on the day asked about', async () => {
      const a = await tenant('CropRef');
      await aChemicalProduct({
        name: 'Cyprodinex 50 WG',
        effectiveFrom: '2020-01-01',
        effectiveTo: '2026-04-01',
        phiDays: 14,
      });
      await aChemicalProduct({
        name: 'Cyprodinex 50 WG',
        effectiveFrom: '2026-04-01',
        phiDays: 7,
      });

      const now = await service.listChemicalProducts(a.userId, a.farmId, '2026-10-05');
      expect(now).toHaveLength(1);
      expect(now[0]!.phiDays).toBe(7);

      const before = await service.listChemicalProducts(a.userId, a.farmId, '2026-03-01');
      expect(before).toHaveLength(1);
      expect(before[0]!.phiDays).toBe(14);
    });

    it('[P1.3] returns EVERY version for the jurisdiction when no day is given, not just today’s', async () => {
      const a = await tenant('CropAllVersions');
      await aChemicalProduct({
        name: 'Cyprodinex 50 WG',
        effectiveFrom: '2020-01-01',
        effectiveTo: '2026-04-01',
        phiDays: 14,
      });
      await aChemicalProduct({
        name: 'Cyprodinex 50 WG',
        effectiveFrom: '2026-04-01',
        phiDays: 7,
      });

      const all = await service.listChemicalProducts(a.userId, a.farmId);

      expect(all).toHaveLength(2);
      expect(all.map((p) => p.phiDays).sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual([7, 14]);
    });

    it('a product with no PHI on record reads as null, never as zero', async () => {
      // The P1.3 lesson (this class's header) applied here: a nullable phi_days is a real distinct
      // state from a registered zero — the client-facing register must not collapse the two.
      const a = await tenant('CropRef');
      await aChemicalProduct({ name: 'Glyfospray 360', phiDays: null });

      const products = await service.listChemicalProducts(a.userId, a.farmId, '2026-10-05');

      expect(products[0]!.phiDays).toBeNull();
    });

    it('refuses a stranger as "no such farm" rather than answering for it', async () => {
      const a = await tenant('CropRef');
      const b = await tenant('CropOther');
      await aChemicalProduct({});

      await expect(service.listChemicalProducts(b.userId, a.farmId, '2026-10-05')).rejects.toThrow(
        NotFoundError,
      );
    });
  });
});
