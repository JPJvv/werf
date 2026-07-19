/**
 * Second factor, end to end against a real Postgres (CLAUDE.md: never mock our own database).
 *
 * These assert what a farmer or an attacker would observe — "the password alone got me
 * nothing", "that recovery code is gone now", "the code I shoulder-surfed no longer works"
 * — not which functions ran in what order.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { eq, isNull } from 'drizzle-orm';
import {
  createAppDb,
  createElevatedDb,
  farmUsers,
  userSessions,
  users,
  type AppDb,
  type ElevatedDb,
} from '@werf/db';
import { startWerfTestDatabase, type WerfTestDatabase } from '@werf/db/testing';
import {
  ConflictError,
  InvalidCredentialsError,
  SecondFactorEnrolmentRequiredError,
  SessionInvalidError,
  schemas,
} from '@werf/core';
import { APP_CONFIG, APP_DB, ELEVATED_DB } from '../db/db.module';
import { REFRESH_TOKEN_TTL_SECONDS, SECOND_FACTOR_CHALLENGE_TTL_SECONDS } from '../config/config';
import { AuthGuard, AllowsPendingEnrolment } from './auth.guard';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { TwoFactorService } from './two-factor.service';
import { PasskeyService } from './passkey.service';
import { RecoveryCodeService } from './recovery-code.service';
import { TOTP_PERIOD_SECONDS, deriveTotp } from './totp';

const BOOT_TIMEOUT_MS = 180_000;

const REGISTRATION: schemas.RegisterRequest = {
  business: { name: 'Rietfontein Boerdery', registrationNumber: null },
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
};

describe('second factor', () => {
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

  /**
   * Registers the owner and completes TOTP enrolment. Returns what a client would hold.
   *
   * Enrolment confirms with the PREVIOUS step's code — still inside the drift window, so
   * a real app would produce it, but a different step from the one the tests below log in
   * with. That is not test choreography: confirming enrolment spends that code, so
   * re-using it to authenticate is exactly what the replay guard refuses. In the field
   * the two are minutes apart; here they would otherwise be microseconds.
   */
  const enrolledOwner = async (): Promise<{
    userId: string;
    secret: string;
    recoveryCodes: string[];
  }> => {
    const session = await auth.register(REGISTRATION);
    const { secret } = await twoFactor.beginTotpEnrolment(session.user.id);
    const previousStep = new Date(Date.now() - TOTP_PERIOD_SECONDS * 1000);
    const { recoveryCodes } = await twoFactor.confirmTotpEnrolment(
      session.user.id,
      deriveTotp(secret, previousStep),
    );
    return { userId: session.user.id, secret, recoveryCodes };
  };

  const login = () =>
    auth.login({
      email: REGISTRATION.owner.email,
      password: REGISTRATION.owner.password,
      deviceLabel: null,
    });

  describe('enrolling an authenticator app (FR-014)', () => {
    it('does not activate the factor until a code proves the app has the seed', async () => {
      // The failure this prevents: a farmer whose camera never focused, or who closed the
      // tab, being locked out of their own business by a factor they cannot produce.
      const session = await auth.register(REGISTRATION);
      await twoFactor.beginTotpEnrolment(session.user.id);

      expect(await twoFactor.isEnrolled(session.user.id)).toBe(false);
      const response = await login();
      expect('accessToken' in response).toBe(true);
    });

    it('activates it once a real code is presented, and returns ten recovery codes', async () => {
      const { recoveryCodes, userId } = await enrolledOwner();

      expect(await twoFactor.isEnrolled(userId)).toBe(true);
      expect(recoveryCodes).toHaveLength(10);
      expect(new Set(recoveryCodes).size).toBe(10);
      // Printable and unambiguous: no O/0 or I/1/L to misread off a page in a safe.
      for (const code of recoveryCodes)
        expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    });

    it('refuses a wrong code, leaving the account un-enrolled', async () => {
      const session = await auth.register(REGISTRATION);
      await twoFactor.beginTotpEnrolment(session.user.id);

      await expect(twoFactor.confirmTotpEnrolment(session.user.id, '000000')).rejects.toThrow(
        InvalidCredentialsError,
      );
      expect(await twoFactor.isEnrolled(session.user.id)).toBe(false);
    });

    it('refuses to swap the factor out from under an account that already has one', async () => {
      // The attack: a stolen session silently re-enrols TOTP against the attacker's own
      // phone, and the real owner's authenticator quietly stops being the second factor.
      const { userId } = await enrolledOwner();

      await expect(twoFactor.beginTotpEnrolment(userId)).rejects.toThrow(ConflictError);
    });

    it('never stores the seed in a form the database can reveal', async () => {
      const { userId, secret } = await enrolledOwner();

      const [row] = await elevated.db.select().from(users).where(eq(users.id, userId));
      const stored = Buffer.from(row!.totpSecretEncrypted!);

      // A dump of this table plus knowledge of our schema must not yield a working seed.
      expect(stored.toString('utf8')).not.toContain(secret);
      expect(stored.toString('base64')).not.toContain(secret);
    });
  });

  describe('logging in with a second factor enrolled (ADR-0007)', () => {
    it('gives the password alone nothing that can act', async () => {
      await enrolledOwner();
      const response = await login();

      expect(response).toMatchObject({ secondFactorRequired: true });
      // The response SHAPE cannot hold a token. This asserts the shape, not a branch.
      expect(response).not.toHaveProperty('accessToken');
      expect(response).not.toHaveProperty('refreshToken');
      expect(response).not.toHaveProperty('farms');
    });

    it('offers TOTP and recovery codes, and never SMS', async () => {
      await enrolledOwner();
      const response = (await login()) as schemas.SecondFactorRequired;

      expect(response.methods).toEqual(['totp', 'recovery_code']);
      expect(response.methods).not.toContain('sms');
    });

    it('completes the login when the code from the app is presented', async () => {
      const { secret } = await enrolledOwner();
      const challenge = (await login()) as schemas.SecondFactorRequired;

      const session = await auth.verifySecondFactor({
        challengeToken: challenge.challengeToken,
        method: 'totp',
        code: deriveTotp(secret, new Date()),
      });

      expect(session.accessToken).toBeTruthy();
      expect(session.farms).toHaveLength(1);
      expect(session.secondFactor).toBe('complete');
    });

    it('refuses the challenge token at /auth/refresh — 2FA cannot be walked around', async () => {
      // The regression this pins: the challenge token IS a refresh token. If `rotate`
      // does not check the second factor, presenting it here returns a full session and
      // the password becomes the only factor after all.
      await enrolledOwner();
      const challenge = (await login()) as schemas.SecondFactorRequired;

      await expect(auth.refresh(challenge.challengeToken)).rejects.toThrow(SessionInvalidError);
    });

    it('spends the challenge on a SUCCESSFUL attempt', async () => {
      const { secret } = await enrolledOwner();
      const challenge = (await login()) as schemas.SecondFactorRequired;

      await auth.verifySecondFactor({
        challengeToken: challenge.challengeToken,
        method: 'totp',
        code: deriveTotp(secret, new Date()),
      });

      // Replaying the same challenge must not mint a second session.
      await expect(
        auth.verifySecondFactor({
          challengeToken: challenge.challengeToken,
          method: 'totp',
          code: deriveTotp(secret, new Date()),
        }),
      ).rejects.toThrow(SessionInvalidError);
    });

    it('spends the challenge on a FAILED attempt — no unlimited guessing', async () => {
      // Without this, one password plus one challenge token buys an unlimited oracle on
      // six digits: guess, get rejected, guess again with the same challenge. The whole
      // 10^6 space, no lockout, no signal to the owner. A wrong code must cost the
      // attacker the challenge, forcing them back through the first factor.
      const { secret } = await enrolledOwner();
      const challenge = (await login()) as schemas.SecondFactorRequired;

      await expect(
        auth.verifySecondFactor({
          challengeToken: challenge.challengeToken,
          method: 'totp',
          code: '000000',
        }),
      ).rejects.toThrow(InvalidCredentialsError);

      // The CORRECT code on that same challenge is now worthless — the challenge is dead,
      // not merely the guess.
      await expect(
        auth.verifySecondFactor({
          challengeToken: challenge.challengeToken,
          method: 'totp',
          code: deriveTotp(secret, new Date()),
        }),
      ).rejects.toThrow(SessionInvalidError);
    });

    it('does not leave a half-authenticated challenge alive for the refresh window', async () => {
      // A challenge token IS a refresh token in storage terms. Inheriting the 30-day
      // offline window would leave a password-only artefact valid for a month.
      await enrolledOwner();
      await login();

      const [row] = await elevated.db
        .select()
        .from(userSessions)
        .where(isNull(userSessions.secondFactorAt));

      const lifetimeSeconds = (row!.expiresAt.getTime() - row!.createdAt.getTime()) / 1000;
      expect(lifetimeSeconds).toBeLessThanOrEqual(SECOND_FACTOR_CHALLENGE_TTL_SECONDS + 5);
      expect(lifetimeSeconds).toBeLessThan(REFRESH_TOKEN_TTL_SECONDS);
    });

    it('lets only one of two requests racing the same TOTP code through', async () => {
      // The replay guard has to be enforced by the UPDATE's own predicate. Comparing the
      // step against a row read a moment earlier, then writing unconditionally, lets two
      // simultaneous requests carrying the same shoulder-surfed digits both win.
      const { secret } = await enrolledOwner();
      const code = deriveTotp(secret, new Date());

      const first = (await login()) as schemas.SecondFactorRequired;
      const second = (await login()) as schemas.SecondFactorRequired;

      const results = await Promise.allSettled([
        auth.verifySecondFactor({
          challengeToken: first.challengeToken,
          method: 'totp',
          code,
        }),
        auth.verifySecondFactor({
          challengeToken: second.challengeToken,
          method: 'totp',
          code,
        }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });

    it('refuses a fabricated challenge token', async () => {
      await enrolledOwner();

      await expect(
        auth.verifySecondFactor({
          challengeToken: tokens.generateRefreshToken(),
          method: 'totp',
          code: '123456',
        }),
      ).rejects.toThrow(SessionInvalidError);
    });

    it('refuses a code the account has already spent', async () => {
      // A TOTP code is valid for its whole period, so one read over a shoulder — or left
      // on a shared office screen — must not work a second time.
      const { secret, userId } = await enrolledOwner();
      const code = deriveTotp(secret, new Date());

      const first = (await login()) as schemas.SecondFactorRequired;
      await auth.verifySecondFactor({
        challengeToken: first.challengeToken,
        method: 'totp',
        code,
      });

      const second = (await login()) as schemas.SecondFactorRequired;
      await expect(
        auth.verifySecondFactor({
          challengeToken: second.challengeToken,
          method: 'totp',
          code,
        }),
      ).rejects.toThrow(InvalidCredentialsError);

      // And the account is not damaged by the refusal — the NEXT code still works.
      const later = new Date(Date.now() + TOTP_PERIOD_SECONDS * 1000);
      const third = (await login()) as schemas.SecondFactorRequired;
      await expect(
        auth.verifySecondFactor({
          challengeToken: third.challengeToken,
          method: 'totp',
          code: deriveTotp(secret, later),
        }),
      ).resolves.toMatchObject({ secondFactor: 'complete' });
      expect(await twoFactor.isEnrolled(userId)).toBe(true);
    });
  });

  describe('recovery codes (FR-014a)', () => {
    it('lets a farmer whose phone is at the bottom of a dam back in', async () => {
      const { recoveryCodes } = await enrolledOwner();
      const challenge = (await login()) as schemas.SecondFactorRequired;

      const session = await auth.verifySecondFactor({
        challengeToken: challenge.challengeToken,
        method: 'recovery_code',
        code: recoveryCodes[0]!,
      });

      expect(session.accessToken).toBeTruthy();
    });

    it('burns the code — single use, permanently', async () => {
      const { recoveryCodes, userId } = await enrolledOwner();

      const first = (await login()) as schemas.SecondFactorRequired;
      await auth.verifySecondFactor({
        challengeToken: first.challengeToken,
        method: 'recovery_code',
        code: recoveryCodes[0]!,
      });

      const second = (await login()) as schemas.SecondFactorRequired;
      await expect(
        auth.verifySecondFactor({
          challengeToken: second.challengeToken,
          method: 'recovery_code',
          code: recoveryCodes[0]!,
        }),
      ).rejects.toThrow(InvalidCredentialsError);

      const [row] = await elevated.db.select().from(users).where(eq(users.id, userId));
      expect(row!.recoveryCodesHashed).toHaveLength(9);
    });

    it('accepts a code retyped off paper — lower case, spaces, no hyphen', async () => {
      const { recoveryCodes } = await enrolledOwner();
      const messy = ` ${recoveryCodes[0]!.replace('-', ' ').toLowerCase()} `;

      const challenge = (await login()) as schemas.SecondFactorRequired;
      await expect(
        auth.verifySecondFactor({
          challengeToken: challenge.challengeToken,
          method: 'recovery_code',
          code: messy,
        }),
      ).resolves.toMatchObject({ secondFactor: 'complete' });
    });

    it('leaves the other nine usable', async () => {
      const { recoveryCodes } = await enrolledOwner();

      const first = (await login()) as schemas.SecondFactorRequired;
      await auth.verifySecondFactor({
        challengeToken: first.challengeToken,
        method: 'recovery_code',
        code: recoveryCodes[0]!,
      });

      const second = (await login()) as schemas.SecondFactorRequired;
      await expect(
        auth.verifySecondFactor({
          challengeToken: second.challengeToken,
          method: 'recovery_code',
          code: recoveryCodes[9]!,
        }),
      ).resolves.toMatchObject({ secondFactor: 'complete' });
    });

    it('stores them hashed, never in a form a database dump reveals', async () => {
      const { recoveryCodes, userId } = await enrolledOwner();

      const [row] = await elevated.db.select().from(users).where(eq(users.id, userId));
      const stored = (row!.recoveryCodesHashed ?? []).join(' ');

      for (const code of recoveryCodes) {
        expect(stored).not.toContain(code);
        expect(stored).not.toContain(code.replace('-', ''));
      }
      // argon2id, like passwords — these are short enough to be guessable.
      for (const hash of row!.recoveryCodesHashed ?? []) expect(hash).toMatch(/^\$argon2id\$/);
    });

    it('cannot be redeemed twice by two requests racing each other', async () => {
      // The bug this pins: reading the ten hashes, filtering one out in JS, and writing
      // the array back is a lost update. Two concurrent redemptions of DIFFERENT codes
      // each compute nine from the same ten, and the second write resurrects the first
      // one's burned code. Concurrency is the attacker's posture, not an edge case.
      const { recoveryCodes, userId } = await enrolledOwner();

      const first = (await login()) as schemas.SecondFactorRequired;
      const second = (await login()) as schemas.SecondFactorRequired;

      const results = await Promise.allSettled([
        auth.verifySecondFactor({
          challengeToken: first.challengeToken,
          method: 'recovery_code',
          code: recoveryCodes[0]!,
        }),
        auth.verifySecondFactor({
          challengeToken: second.challengeToken,
          method: 'recovery_code',
          code: recoveryCodes[1]!,
        }),
      ]);

      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

      // Both codes are gone. Eight left, not nine.
      const [row] = await elevated.db.select().from(users).where(eq(users.id, userId));
      expect(row!.recoveryCodesHashed).toHaveLength(8);
    });

    it('lets only one of two requests racing the SAME code through', async () => {
      const { recoveryCodes, userId } = await enrolledOwner();

      const first = (await login()) as schemas.SecondFactorRequired;
      const second = (await login()) as schemas.SecondFactorRequired;

      const results = await Promise.allSettled([
        auth.verifySecondFactor({
          challengeToken: first.challengeToken,
          method: 'recovery_code',
          code: recoveryCodes[0]!,
        }),
        auth.verifySecondFactor({
          challengeToken: second.challengeToken,
          method: 'recovery_code',
          code: recoveryCodes[0]!,
        }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      const [row] = await elevated.db.select().from(users).where(eq(users.id, userId));
      expect(row!.recoveryCodesHashed).toHaveLength(9);
    });

    it('refuses a code that was never issued', async () => {
      await enrolledOwner();
      const challenge = (await login()) as schemas.SecondFactorRequired;

      await expect(
        auth.verifySecondFactor({
          challengeToken: challenge.challengeToken,
          method: 'recovery_code',
          code: 'AAAAA-BBBBB',
        }),
      ).rejects.toThrow(InvalidCredentialsError);
    });
  });

  describe('mandatory enrolment for owner and bookkeeper (FR-014)', () => {
    class GuardedController {
      ordinary(): void {}
      @AllowsPendingEnrolment()
      enrolment(): void {}
    }

    const contextFor = (handler: 'ordinary' | 'enrolment', token: string): ExecutionContext =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }),
        }),
        getHandler: () => GuardedController.prototype[handler],
        getClass: () => GuardedController,
      }) as unknown as ExecutionContext;

    const guard = () => new AuthGuard(tokens, sessions, twoFactor, new Reflector());

    it('reports the obligation on the session an owner registers with', async () => {
      const session = await auth.register(REGISTRATION);
      expect(session.secondFactor).toBe('required');
    });

    it('confines an un-enrolled owner to the enrolment routes', async () => {
      // "Mandatory" has to mean the server refuses. A client-side nag is enforced by the
      // attacker's browser, which is to say not at all.
      const session = await auth.register(REGISTRATION);

      await expect(
        guard().canActivate(contextFor('ordinary', session.accessToken)),
      ).rejects.toThrow(SecondFactorEnrolmentRequiredError);

      // ...but they can still reach enrolment, or there is no way out of the corner.
      await expect(guard().canActivate(contextFor('enrolment', session.accessToken))).resolves.toBe(
        true,
      );
    });

    it('lifts the confinement the moment enrolment completes', async () => {
      const session = await auth.register(REGISTRATION);
      const { secret } = await twoFactor.beginTotpEnrolment(session.user.id);
      await twoFactor.confirmTotpEnrolment(session.user.id, deriveTotp(secret, new Date()));

      await expect(guard().canActivate(contextFor('ordinary', session.accessToken))).resolves.toBe(
        true,
      );
      expect(await twoFactor.statusFor(session.user.id)).toBe('complete');
    });

    it('does not confine a manager — optional for them (ADR-0007)', async () => {
      const session = await auth.register(REGISTRATION);
      await elevated.db
        .update(farmUsers)
        .set({ role: 'manager' })
        .where(eq(farmUsers.userId, session.user.id));

      expect(await twoFactor.statusFor(session.user.id)).toBe('optional');
      await expect(guard().canActivate(contextFor('ordinary', session.accessToken))).resolves.toBe(
        true,
      );
    });

    it('obliges a bookkeeper, who sees every wage on the farm', async () => {
      const session = await auth.register(REGISTRATION);
      await elevated.db
        .update(farmUsers)
        .set({ role: 'bookkeeper' })
        .where(eq(farmUsers.userId, session.user.id));

      expect(await twoFactor.statusFor(session.user.id)).toBe('required');
    });

    it('is not imposed by an invitation the person never accepted', async () => {
      // An unaccepted membership grants nothing, so it cannot oblige anything either —
      // otherwise anyone could force 2FA on a stranger by naming their address.
      const session = await auth.register(REGISTRATION);
      await elevated.db
        .update(farmUsers)
        .set({ role: 'owner', acceptedAt: null })
        .where(eq(farmUsers.userId, session.user.id));

      expect(await twoFactor.statusFor(session.user.id)).toBe('optional');
    });
  });
});
