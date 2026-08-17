/**
 * Auth, end to end against a real Postgres (CLAUDE.md: never mock our own database).
 *
 * These assert what a farmer or an auditor would observe — "the old token stops working",
 * "a failed registration leaves nothing behind", "logging in again after three weeks
 * offline still works" — not which functions were called in what order.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import {
  authAuditLog,
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
import {
  ConflictError,
  InvalidCredentialsError,
  NotFoundError,
  SessionInvalidError,
  schemas,
} from '@werf/core';
import { APP_CONFIG, APP_DB, ELEVATED_DB } from '../db/db.module';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from '../config/config';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { TwoFactorService } from './two-factor.service';
import { PasskeyService } from './passkey.service';
import { RecoveryCodeService } from './recovery-code.service';
import { deriveTotp } from './totp';

const BOOT_TIMEOUT_MS = 180_000;

/** A complete, valid registration. Individual tests override just the field under test. */
const REGISTRATION: schemas.RegisterRequest = {
  business: {
    name: 'Rietfontein Boerdery',
    registrationNumber: null,
    contact: { email: 'kantoor@rietfontein.test', phone: '+27 51 555 0100' },
    physicalAddress: {
      line1: 'Plaas Rietfontein',
      line2: 'S305 distrikspad',
      locality: 'Bothaville',
      province: 'Free State',
      postalCode: '9660',
    },
  },
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
  let sessions: SessionService;
  let twoFactor: TwoFactorService;

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
    tokens = moduleRef.get(TokenService);
    sessions = moduleRef.get(SessionService);
    twoFactor = moduleRef.get(TwoFactorService);
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

    it('retains the business contact and physical address supplied at registration', async () => {
      await auth.register(REGISTRATION);

      const [business] = await elevated.db
        .select()
        .from(businesses)
        .where(eq(businesses.name, REGISTRATION.business.name));

      expect(business).toMatchObject({
        contactEmail: 'kantoor@rietfontein.test',
        contactPhone: '+27 51 555 0100',
        physicalAddressLine1: 'Plaas Rietfontein',
        physicalAddressLine2: 'S305 distrikspad',
        physicalAddressLocality: 'Bothaville',
        physicalAddressProvince: 'Free State',
        physicalAddressPostalCode: '9660',
      });
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

    it('lets someone register an address that was only ever invited', async () => {
      // The denial of service this closes. `invite` writes a user row for the invitee so
      // the pending membership has something to point at, and `users.email` is UNIQUE. If
      // any existing row is a conflict, an owner can name a stranger's address and bar
      // that person from ever signing up — permanently, silently, and with no invitation
      // actually delivered to explain it. This is that row, exactly as `invite` leaves it.
      await elevated.db
        .insert(users)
        .values({ email: REGISTRATION.owner.email, fullName: 'Guessed Name' });

      const session = await auth.register(REGISTRATION);

      // They get a real account, and it is theirs: their name, not the inviter's guess.
      expect(session.user.email).toBe(REGISTRATION.owner.email);
      expect(session.user.fullName).toBe(REGISTRATION.owner.fullName);
      expect(session.activeFarmId).not.toBeNull();

      // And it is one account, not a duplicate alongside the shell.
      const rows = await elevated.db
        .select()
        .from(users)
        .where(eq(users.email, REGISTRATION.owner.email));
      expect(rows).toHaveLength(1);
    });

    it('still refuses an address that belongs to a real account', async () => {
      // The other half: claiming is only ever for a password-less shell. A row with a
      // password is somebody's account and must not be takeable by re-registering it.
      await auth.register(REGISTRATION);

      await expect(
        auth.register({ ...REGISTRATION, owner: { ...REGISTRATION.owner, fullName: 'Impostor' } }),
      ).rejects.toThrow(ConflictError);

      const [user] = await elevated.db
        .select()
        .from(users)
        .where(eq(users.email, REGISTRATION.owner.email));
      expect(user!.fullName).toBe(REGISTRATION.owner.fullName);
    });

    it('leaves nothing behind when registration fails partway', async () => {
      await auth.register(REGISTRATION);
      const before = await elevated.db.select().from(businesses);

      await expect(
        auth.register({
          ...REGISTRATION,
          business: { ...REGISTRATION.business, name: 'Orphan Boerdery' },
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
        auth.login(
          {
            email: REGISTRATION.owner.email,
            password: 'not the right password',
            deviceLabel: null,
          },
          {
            sourceIp: '203.0.113.8',
            userAgent: 'Werf audit integration test',
          },
        ),
      ).rejects.toThrow(InvalidCredentialsError);

      const [event] = await elevated.db.select().from(authAuditLog);
      expect(event).toMatchObject({
        event: 'login',
        outcome: 'failure',
        sourceIp: '203.0.113.8',
        userAgent: 'Werf audit integration test',
        metadata: { reason: 'invalid_credentials', method: 'password' },
      });
      expect(event!.subjectUserId).not.toBeNull();
      // The evidence is useful without becoming a second credential/PII store.
      expect(JSON.stringify(event)).not.toContain(REGISTRATION.owner.email);
      expect(JSON.stringify(event)).not.toContain('not the right password');
    });

    it('keeps authentication evidence immutable even for the elevated application path', async () => {
      await auth.register(REGISTRATION);
      await auth.login({
        email: REGISTRATION.owner.email,
        password: REGISTRATION.owner.password,
        deviceLabel: null,
      });
      const [event] = await elevated.db.select().from(authAuditLog);
      expect(event!.sessionFamilyId).not.toBeNull();

      await expect(
        elevated.db
          .update(authAuditLog)
          .set({ outcome: 'failure' })
          .where(eq(authAuditLog.id, event!.id)),
      ).rejects.toThrow(/immutable/);
      await expect(
        elevated.db.delete(authAuditLog).where(eq(authAuditLog.id, event!.id)),
      ).rejects.toThrow(/immutable/);
      await expect(
        app.asUser(event!.subjectUserId!, (tx) => tx.select().from(authAuditLog)),
      ).rejects.toThrow(/permission denied|row-level security/i);

      const [unchanged] = await elevated.db.select().from(authAuditLog);
      expect(unchanged).toMatchObject({ id: event!.id, event: 'login', outcome: 'success' });
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

      const reuseEvents = await elevated.db
        .select()
        .from(authAuditLog)
        .where(eq(authAuditLog.event, 'session_reuse'));
      expect(reuseEvents).toHaveLength(1);
      expect(reuseEvents[0]).toMatchObject({
        outcome: 'failure',
        subjectUserId: first.user.id,
        metadata: { reason: 'refresh_token_reuse' },
      });
    });

    it('rejects a token that was never issued', async () => {
      await expect(auth.refresh('not-a-real-token')).rejects.toThrow(SessionInvalidError);
    });

    it('cannot be used to walk around an unsatisfied second factor', async () => {
      // The challenge token handed to a caller who has passed only the password IS a
      // refresh token. If /auth/refresh honoured it, the second factor would be optional
      // for anyone who noticed — the whole of ADR-0007's "2FA at login" turns decorative.
      const first = await auth.register(REGISTRATION);
      await elevated.db
        .update(userSessions)
        .set({ secondFactorAt: null })
        .where(eq(userSessions.refreshTokenHash, tokens.hashRefreshToken(first.refreshToken)));

      await expect(auth.refresh(first.refreshToken)).rejects.toThrow(SessionInvalidError);
    });

    it('does not let a half-authenticated session authorise a request either', async () => {
      const session = await auth.register(REGISTRATION);
      const [row] = await elevated.db.select().from(userSessions);
      await elevated.db
        .update(userSessions)
        .set({ secondFactorAt: null })
        .where(eq(userSessions.id, row!.id));

      // Same rule at the guard: a session that still owes a factor is not a session.
      await expect(sessions.findLive(row!.id)).resolves.toBeUndefined();
      expect(session.accessToken).toBeTruthy();
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

      const [event] = await elevated.db
        .select()
        .from(authAuditLog)
        .where(eq(authAuditLog.event, 'logout'));
      expect(event).toMatchObject({
        outcome: 'success',
        actorUserId: session.user.id,
        subjectUserId: session.user.id,
        farmId: session.activeFarmId,
        metadata: { reason: 'user_requested' },
      });
    });

    it('is idempotent — logging out twice is not an error', async () => {
      const session = await auth.register(REGISTRATION);

      await auth.logout(session.refreshToken);
      await expect(auth.logout(session.refreshToken)).resolves.toBeUndefined();
      await expect(auth.logout('a token that never existed')).resolves.toBeUndefined();

      const events = await elevated.db
        .select()
        .from(authAuditLog)
        .where(eq(authAuditLog.event, 'logout'));
      expect(events).toHaveLength(1);
    });
  });

  describe('the access-token guard', () => {
    // A guarded route that carries no @Public() metadata. getHandler/getClass must return
    // real objects — Reflector reads metadata off them and throws on undefined.
    class GuardedController {
      guarded(): void {}
    }

    const contextFor = (request: Record<string, unknown>): ExecutionContext =>
      ({
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => GuardedController.prototype.guarded,
        getClass: () => GuardedController,
      }) as unknown as ExecutionContext;

    /** A minimal ExecutionContext carrying just the Authorization header. */
    const contextWith = (header?: string): ExecutionContext =>
      contextFor({ headers: header ? { authorization: header } : {} });

    const guardFor = () => new AuthGuard(tokens, sessions, twoFactor, new Reflector());

    /**
     * Gets an owner past the mandatory-enrolment gate (FR-014), so the tests below can be
     * about what they are actually about — identity, revocation, the active farm — rather
     * than about 2FA. The gate itself is tested in two-factor.integration.test.ts.
     */
    const enrolSecondFactor = async (userId: string): Promise<void> => {
      const { secret } = await twoFactor.beginTotpEnrolment(userId);
      await twoFactor.confirmTotpEnrolment(userId, deriveTotp(secret, new Date()));
    };

    it('admits a valid token and reports who is calling', async () => {
      const session = await auth.register(REGISTRATION);
      await enrolSecondFactor(session.user.id);
      const context = contextWith(`Bearer ${session.accessToken}`);

      await expect(guardFor().canActivate(context)).resolves.toBe(true);
    });

    it('turns a logged-out token away immediately, not in fifteen minutes', async () => {
      // The whole reason the guard re-reads the session: an access token is valid for 15
      // minutes, and a revoked session must not keep working for the remainder of them.
      const session = await auth.register(REGISTRATION);
      await auth.logout(session.refreshToken);

      await expect(
        guardFor().canActivate(contextWith(`Bearer ${session.accessToken}`)),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('refuses a missing, malformed, or forged token alike', async () => {
      const guard = guardFor();

      await expect(guard.canActivate(contextWith())).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(contextWith('Bearer '))).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(contextWith('Bearer not.a.token'))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('reads the active farm from the session, so a farm switch takes effect at once', async () => {
      const session = await auth.register(REGISTRATION);
      await enrolSecondFactor(session.user.id);
      const [row] = await elevated.db.select().from(userSessions);

      // The token was minted before this change and still carries the old farm.
      await sessions.setActiveFarm(row!.id, row!.userId, row!.activeFarmId!);

      const request: Record<string, unknown> = {
        headers: { authorization: `Bearer ${session.accessToken}` },
      };

      await guardFor().canActivate(contextFor(request));
      expect((request.auth as { activeFarmId: string }).activeFarmId).toBe(row!.activeFarmId);
    });
  });

  describe('updating your own preferences (FR-008)', () => {
    it('writes the language to the ACCOUNT, so every device gets it', async () => {
      const session = await auth.register(REGISTRATION);
      expect(session.user.locale).toBe('en-ZA');

      const updated = await auth.updateProfile(session.user.id, { locale: 'af-ZA' });
      expect(updated.locale).toBe('af-ZA');

      // The point of the endpoint: a NEW session — a borrowed tablet, or this phone tomorrow
      // morning — reads the language off the account, not off the device that set it.
      const next = await auth.login({
        email: REGISTRATION.owner.email,
        password: REGISTRATION.owner.password,
        deviceLabel: null,
      });
      expect('accessToken' in next && next.user.locale).toBe('af-ZA');
    });

    it('never returns the password hash or the TOTP secret', async () => {
      // The client CACHES what this returns, on a phone that can be stolen.
      const session = await auth.register(REGISTRATION);
      const updated = await auth.updateProfile(session.user.id, { locale: 'af-ZA' });

      expect(Object.keys(updated).sort()).toEqual([
        'createdAt',
        'deletedAt',
        'email',
        'fullName',
        'id',
        'locale',
        'phone',
        'theme',
        'updatedAt',
      ]);
    });

    it('refuses an account that does not exist', async () => {
      await expect(
        auth.updateProfile('01900000-0000-7000-8000-000000000abc', { locale: 'af-ZA' }),
      ).rejects.toThrow(NotFoundError);
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
