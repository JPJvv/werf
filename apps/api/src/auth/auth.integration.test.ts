/**
 * Auth, end to end against a real Postgres (CLAUDE.md: never mock our own database).
 *
 * These assert what a farmer or an auditor would observe — "the old token stops working",
 * "a failed registration leaves nothing behind", "logging in again after three weeks
 * offline still works" — not which functions were called in what order.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import {
  businesses,
  createAppDb,
  createElevatedDb,
  enterprises,
  farmUsers,
  farms,
  userSessions,
  users,
  type AppDb,
  type ElevatedDb,
} from '@werf/db';
import { startWerfTestDatabase, type WerfTestDatabase } from '@werf/db/testing';
import { ConflictError, InvalidCredentialsError, SessionInvalidError, schemas } from '@werf/core';
import { APP_CONFIG, APP_DB, ELEVATED_DB } from '../db/db.module';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from '../config/config';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

const BOOT_TIMEOUT_MS = 180_000;

/** A complete, valid registration. Individual tests override just the field under test. */
const REGISTRATION: schemas.RegisterRequest = {
  business: { name: 'Rietfontein Boerdery', registrationNumber: null },
  farm: {
    name: 'Rietfontein',
    province: 'Free State',
    district: null,
    enterpriseTypes: ['beef_cattle', 'row_crops'],
  },
  owner: {
    fullName: 'Thabo Mokoena',
    email: 'thabo@rietfontein.test',
    password: 'correct horse battery staple',
    locale: 'en-ZA',
    theme: 'light',
  },
};

describe('auth', () => {
  let pg: WerfTestDatabase;
  let app: AppDb;
  let elevated: ElevatedDb;
  let auth: AuthService;
  let tokens: TokenService;

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
        {
          provide: APP_CONFIG,
          useValue: {
            port: 3000,
            databaseUrl: pg.appUrl,
            databaseElevatedUrl: pg.elevatedUrl,
            jwtSecret: 'test-signing-key-that-is-long-enough-32',
          },
        },
        { provide: APP_DB, useValue: app },
        { provide: ELEVATED_DB, useValue: elevated },
      ],
    }).compile();

    auth = moduleRef.get(AuthService);
    tokens = moduleRef.get(TokenService);
  }, BOOT_TIMEOUT_MS);

  afterEach(async () => {
    await pg.reset();
  });

  afterAll(async () => {
    await app?.close();
    await elevated?.close();
    await pg?.stop();
  });

  describe('registering a business (FR-001, FR-002)', () => {
    it('creates a farm the owner can immediately act on', async () => {
      const session = await auth.register(REGISTRATION);

      expect(session.farms).toHaveLength(1);
      expect(session.farms[0]).toMatchObject({
        name: 'Rietfontein',
        role: 'owner',
        enterpriseTypes: ['beef_cattle', 'row_crops'],
      });
      expect(session.activeFarmId).toBe(session.farms[0]!.id);
      expect(session.accessToken).toBeTruthy();
      expect(session.expiresIn).toBe(ACCESS_TOKEN_TTL_SECONDS);
    });

    it('gives each chosen enterprise type something to attribute costs to (ADR-0004)', async () => {
      const session = await auth.register(REGISTRATION);

      const rows = await elevated.db
        .select()
        .from(enterprises)
        .where(eq(enterprises.farmId, session.activeFarmId!));

      expect(rows.map((r) => r.type).sort()).toEqual(['beef_cattle', 'row_crops']);
      expect(rows.every((r) => r.active)).toBe(true);
    });

    it('takes jurisdiction from the farm, never from the request', async () => {
      // A caller must not be able to choose the law their payroll is computed under, so
      // the field is not in the request schema at all and the column default governs.
      const session = await auth.register({
        ...REGISTRATION,
        // @ts-expect-error — proving the schema refuses it even if a caller tries.
        farm: { ...REGISTRATION.farm, jurisdiction: 'NA' },
      });

      const [farm] = await elevated.db
        .select()
        .from(farms)
        .where(eq(farms.id, session.activeFarmId!));

      expect(farm!.jurisdiction).toBe('ZA');
      expect(farm!.timezone).toBe('Africa/Johannesburg');
    });

    it('refuses a second registration on the same email', async () => {
      await auth.register(REGISTRATION);

      await expect(auth.register(REGISTRATION)).rejects.toThrow(ConflictError);
    });

    it('leaves nothing behind when registration fails partway', async () => {
      await auth.register(REGISTRATION);
      const before = await elevated.db.select().from(businesses);

      await expect(
        auth.register({
          ...REGISTRATION,
          business: { name: 'Orphan Boerdery', registrationNumber: null },
        }),
      ).rejects.toThrow(ConflictError);

      // A business with no farm has no jurisdiction and a farm with no owner is a farm
      // nobody can log into — so a partial tenant must not survive the failure.
      const after = await elevated.db.select().from(businesses);
      expect(after).toHaveLength(before.length);
      expect(after.map((b) => b.name)).not.toContain('Orphan Boerdery');
    });

    it('never stores the password itself', async () => {
      await auth.register(REGISTRATION);

      const [user] = await elevated.db
        .select()
        .from(users)
        .where(eq(users.email, REGISTRATION.owner.email));

      expect(user!.passwordHash).not.toContain(REGISTRATION.owner.password);
      expect(user!.passwordHash).toMatch(/^\$argon2id\$/);
    });
  });

  describe('logging in', () => {
    it('returns a session the client can cache for offline use (FR-006)', async () => {
      await auth.register(REGISTRATION);

      const result = await auth.login({
        email: REGISTRATION.owner.email,
        password: REGISTRATION.owner.password,
        deviceLabel: 'Samsung A15',
      });

      expect('accessToken' in result).toBe(true);
      const session = result as schemas.AuthSession;
      // The shell must render offline from this alone: who they are, what language, and
      // which farms — without asking the server anything on a cold start with no signal.
      expect(session.user.fullName).toBe('Thabo Mokoena');
      expect(session.user.locale).toBe('en-ZA');
      expect(session.farms).toHaveLength(1);

      const refreshWindowDays =
        (new Date(session.refreshExpiresAt).getTime() - Date.now()) / 86_400_000;
      expect(refreshWindowDays).toBeGreaterThan(29);
    });

    it('rejects the wrong password', async () => {
      await auth.register(REGISTRATION);

      await expect(
        auth.login({
          email: REGISTRATION.owner.email,
          password: 'not the right password',
          deviceLabel: null,
        }),
      ).rejects.toThrow(InvalidCredentialsError);
    });

    it('answers an unknown address exactly as it answers a wrong password', async () => {
      await auth.register(REGISTRATION);

      // Identical error type and message: the endpoint must not become an oracle for
      // enumerating which farmers have accounts.
      const unknown = await auth
        .login({ email: 'nobody@nowhere.test', password: 'some password here', deviceLabel: null })
        .catch((e: Error) => e);
      const wrongPassword = await auth
        .login({
          email: REGISTRATION.owner.email,
          password: 'some password here',
          deviceLabel: null,
        })
        .catch((e: Error) => e);

      expect((unknown as Error).constructor).toBe((wrongPassword as Error).constructor);
      expect((unknown as Error).message).toBe((wrongPassword as Error).message);
    });

    it('records the device so a person can recognise a session later', async () => {
      await auth.register(REGISTRATION);
      await auth.login({
        email: REGISTRATION.owner.email,
        password: REGISTRATION.owner.password,
        deviceLabel: 'Samsung A15',
      });

      const rows = await elevated.db.select().from(userSessions);
      expect(rows.some((r) => r.deviceLabel === 'Samsung A15')).toBe(true);
    });
  });

  describe('refreshing (ADR-0007)', () => {
    it('issues a new token and retires the old one', async () => {
      const first = await auth.register(REGISTRATION);

      const second = await auth.refresh(first.refreshToken);

      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(second.accessToken).toBeTruthy();
      // Single use: the spent token is gone for good.
      await expect(auth.refresh(first.refreshToken)).rejects.toThrow(SessionInvalidError);
    });

    it('does not demand a second factor again', async () => {
      // A farmer reconnecting after a fortnight in the veld must not be asked for an
      // authenticator app while standing next to a broken windmill.
      const first = await auth.register(REGISTRATION);
      const second = await auth.refresh(first.refreshToken);

      const [session] = await elevated.db
        .select()
        .from(userSessions)
        .where(eq(userSessions.refreshTokenHash, tokens.hashRefreshToken(second.refreshToken)));

      expect(session!.secondFactorAt).not.toBeNull();
    });

    it('slides the 30-day window forward on each use', async () => {
      const first = await auth.register(REGISTRATION);
      const second = await auth.refresh(first.refreshToken);

      // The window measures silence, not account age: someone who syncs on day 21 gets
      // another 30 days, which is the whole point of the offline window.
      const remaining = new Date(second.refreshExpiresAt).getTime() - Date.now();
      expect(remaining).toBeGreaterThan((REFRESH_TOKEN_TTL_SECONDS - 60) * 1000);
    });

    it('kills the whole chain when a spent token is replayed', async () => {
      const first = await auth.register(REGISTRATION);
      const second = await auth.refresh(first.refreshToken);

      // Replaying the spent token is either theft or a retry, and we cannot tell which —
      // so we assume theft.
      await expect(auth.refresh(first.refreshToken)).rejects.toThrow(SessionInvalidError);

      // The legitimate successor dies too. The real user re-authenticates (an annoyance);
      // the attacker loses the session (the point).
      await expect(auth.refresh(second.refreshToken)).rejects.toThrow(SessionInvalidError);
    });

    it('rejects a token that was never issued', async () => {
      await expect(auth.refresh('not-a-real-token')).rejects.toThrow(SessionInvalidError);
    });

    it('rejects an expired token without touching anything else', async () => {
      const first = await auth.register(REGISTRATION);

      await elevated.db
        .update(userSessions)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(userSessions.refreshTokenHash, tokens.hashRefreshToken(first.refreshToken)));

      await expect(auth.refresh(first.refreshToken)).rejects.toThrow(SessionInvalidError);
    });
  });

  describe('logging out', () => {
    it('ends the session for good', async () => {
      const session = await auth.register(REGISTRATION);

      await auth.logout(session.refreshToken);

      await expect(auth.refresh(session.refreshToken)).rejects.toThrow(SessionInvalidError);
    });

    it('is idempotent — logging out twice is not an error', async () => {
      const session = await auth.register(REGISTRATION);

      await auth.logout(session.refreshToken);
      await expect(auth.logout(session.refreshToken)).resolves.toBeUndefined();
      await expect(auth.logout('a token that never existed')).resolves.toBeUndefined();
    });
  });

  describe('the tenant that registration produced', () => {
    it('is reachable through the RLS-bound connection the rest of the app uses', async () => {
      // Registration runs elevated by necessity. Everything after it must work through
      // the ordinary scoped path — otherwise the tenant exists but the app cannot see it.
      const session = await auth.register(REGISTRATION);
      const [owner] = await elevated.db
        .select()
        .from(users)
        .where(eq(users.email, REGISTRATION.owner.email));

      const visible = await app.asUser(owner!.id, (tx) => tx.select().from(farms));
      const membership = await app.asUser(owner!.id, (tx) => tx.select().from(farmUsers));

      expect(visible.map((f) => f.id)).toEqual([session.activeFarmId]);
      expect(membership[0]!.role).toBe('owner');
    });
  });
});
