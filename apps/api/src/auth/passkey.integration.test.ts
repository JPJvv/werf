/**
 * Passkeys, end to end against a real Postgres and a real (software) authenticator.
 *
 * Nothing here is mocked: the authenticator generates a genuine P-256 key, signs the
 * challenge the server issued, and the server verifies that signature. So these tests
 * fail if the origin check, the RP ID, the challenge lifecycle or the counter logic is
 * wrong — which is exactly the set of mistakes that would quietly turn a phishing-
 * resistant factor into a decorative one.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import {
  createAppDb,
  createElevatedDb,
  userPasskeys,
  webauthnChallenges,
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
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { TwoFactorService } from './two-factor.service';
import { PasskeyService } from './passkey.service';
import { RecoveryCodeService } from './recovery-code.service';
import { TestAuthenticator } from './test-authenticator';

const BOOT_TIMEOUT_MS = 180_000;

const RP_ID = 'localhost';
const ORIGIN = 'http://localhost:5173';

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

describe('passkeys (ADR-0007)', () => {
  let pg: WerfTestDatabase;
  let app: AppDb;
  let elevated: ElevatedDb;
  let auth: AuthService;
  let passkeys: PasskeyService;
  let twoFactor: TwoFactorService;
  let recoveryCodes: RecoveryCodeService;

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
            webauthnRpId: RP_ID,
            webauthnRpName: 'Werf',
            webauthnOrigin: [ORIGIN],
          },
        },
        { provide: APP_DB, useValue: app },
        { provide: ELEVATED_DB, useValue: elevated },
      ],
    }).compile();

    auth = moduleRef.get(AuthService);
    passkeys = moduleRef.get(PasskeyService);
    twoFactor = moduleRef.get(TwoFactorService);
    recoveryCodes = moduleRef.get(RecoveryCodeService);
  }, BOOT_TIMEOUT_MS);

  afterEach(async () => {
    await pg.reset();
  });

  afterAll(async () => {
    await app?.close();
    await elevated?.close();
    await pg?.stop();
  });

  /** The challenge the server just issued, as the browser would read it. */
  const challengeFrom = (options: schemas.PasskeyCeremonyOptions): string =>
    (options.options as { challenge: string }).challenge;

  /** Registers the owner and enrols one passkey. Returns the virtual phone. */
  const ownerWithPasskey = async (): Promise<{
    userId: string;
    device: TestAuthenticator;
  }> => {
    const session = await auth.register(REGISTRATION);
    const device = new TestAuthenticator();

    const options = await passkeys.beginRegistration(session.user.id);
    await passkeys.finishRegistration(session.user.id, {
      credential: device.register({
        challenge: challengeFrom(options),
        origin: ORIGIN,
        rpId: RP_ID,
      }) as never,
      deviceLabel: 'Samsung A15',
    });

    return { userId: session.user.id, device };
  };

  const login = () =>
    auth.login({
      email: REGISTRATION.owner.email,
      password: REGISTRATION.owner.password,
      deviceLabel: null,
    });

  /** Password, then the passkey ceremony, as a real client would drive it. */
  const loginWithPasskey = async (device: TestAuthenticator): Promise<schemas.AuthSession> => {
    const challenge = (await login()) as schemas.SecondFactorRequired;
    const options = await passkeys.beginAuthentication(challenge.challengeToken);

    return auth.verifyPasskey({
      challengeToken: challenge.challengeToken,
      credential: device.authenticate({
        challenge: challengeFrom(options),
        origin: ORIGIN,
        rpId: RP_ID,
      }) as never,
    });
  };

  describe('enrolling a phone', () => {
    it('stores a public key and nothing that could impersonate the user', async () => {
      const { userId } = await ownerWithPasskey();

      const [row] = await elevated.db
        .select()
        .from(userPasskeys)
        .where(eq(userPasskeys.userId, userId));

      expect(row!.publicKey.length).toBeGreaterThan(0);
      expect(row!.deviceLabel).toBe('Samsung A15');
      // The table has no column that could hold a private key — that is the property
      // that makes a breach of this table worthless, so assert the shape, not a value.
      expect(Object.keys(row!)).not.toContain('privateKey');
      expect(Object.keys(row!)).not.toContain('secret');
    });

    it('counts as the second factor an owner is obliged to have (FR-014)', async () => {
      // A farmer who enrolled a fingerprint and no authenticator app has done what
      // FR-014 asks. Demanding both would be a rule ADR-0007 does not make.
      const { userId } = await ownerWithPasskey();

      expect(await twoFactor.statusFor(userId)).toBe('complete');
      expect(await twoFactor.isEnrolled(userId)).toBe(true);
    });

    it('refuses an attestation from the wrong origin — the phishing case', async () => {
      // This is the single most important assertion in the file. A passkey's value over
      // TOTP is that a look-alike site cannot use it, and that rests entirely on the
      // origin the browser reports being the one we expect.
      const session = await auth.register(REGISTRATION);
      const device = new TestAuthenticator();
      const options = await passkeys.beginRegistration(session.user.id);

      await expect(
        passkeys.finishRegistration(session.user.id, {
          credential: device.register({
            challenge: challengeFrom(options),
            origin: 'https://werf-login.example.com',
            rpId: RP_ID,
          }) as never,
          deviceLabel: null,
        }),
      ).rejects.toThrow(InvalidCredentialsError);
    });

    it('refuses an attestation signed over a challenge we never issued', async () => {
      const session = await auth.register(REGISTRATION);
      const device = new TestAuthenticator();
      await passkeys.beginRegistration(session.user.id);

      await expect(
        passkeys.finishRegistration(session.user.id, {
          credential: device.register({
            challenge: randomBytes(32).toString('base64url'),
            origin: ORIGIN,
            rpId: RP_ID,
          }) as never,
          deviceLabel: null,
        }),
      ).rejects.toThrow(InvalidCredentialsError);
    });

    it('spends the challenge, so an enrolment cannot be replayed', async () => {
      const session = await auth.register(REGISTRATION);
      const device = new TestAuthenticator();
      const options = await passkeys.beginRegistration(session.user.id);
      const credential = device.register({
        challenge: challengeFrom(options),
        origin: ORIGIN,
        rpId: RP_ID,
      });

      await passkeys.finishRegistration(session.user.id, {
        credential: credential as never,
        deviceLabel: null,
      });

      await expect(
        passkeys.finishRegistration(session.user.id, {
          credential: credential as never,
          deviceLabel: null,
        }),
      ).rejects.toThrow(InvalidCredentialsError);
    });

    it('refuses to enrol the same device twice', async () => {
      const { userId, device } = await ownerWithPasskey();
      const options = await passkeys.beginRegistration(userId);

      await expect(
        passkeys.finishRegistration(userId, {
          credential: device.register({
            challenge: challengeFrom(options),
            origin: ORIGIN,
            rpId: RP_ID,
          }) as never,
          deviceLabel: null,
        }),
      ).rejects.toThrow(ConflictError);
    });

    it('issues recovery codes when the passkey is the FIRST factor (FR-014a)', async () => {
      // Without this, a passkey-only owner whose phone drowns has no way back in at all —
      // and the login screen would be offering them a recovery option that cannot work.
      const session = await auth.register(REGISTRATION);
      const device = new TestAuthenticator();
      const options = await passkeys.beginRegistration(session.user.id);

      const result = await passkeys.finishRegistration(session.user.id, {
        credential: device.register({
          challenge: challengeFrom(options),
          origin: ORIGIN,
          rpId: RP_ID,
        }) as never,
        deviceLabel: null,
      });

      expect(result.recoveryCodes).toHaveLength(10);
      expect(await recoveryCodes.remaining(session.user.id)).toBe(10);
    });

    it('does not silently replace the codes already in the farmer‘s safe', async () => {
      // Enrolling a SECOND device must not invalidate the printed page. Returning null
      // is how the client knows not to show a "write these down" screen again.
      const { userId } = await ownerWithPasskey();
      const second = new TestAuthenticator();
      const options = await passkeys.beginRegistration(userId);

      const result = await passkeys.finishRegistration(userId, {
        credential: second.register({
          challenge: challengeFrom(options),
          origin: ORIGIN,
          rpId: RP_ID,
        }) as never,
        deviceLabel: 'Office desktop',
      });

      expect(result.recoveryCodes).toBeNull();
      expect(await recoveryCodes.remaining(userId)).toBe(10);
    });
  });

  describe('revoking a device (FR-014c)', () => {
    it('stops a lost phone from opening the account', async () => {
      const { userId, device } = await ownerWithPasskey();
      const [enrolled] = await passkeys.list(userId);

      await passkeys.revoke(userId, enrolled!.id);

      expect(await passkeys.list(userId)).toHaveLength(0);
      expect(await passkeys.hasPasskey(userId)).toBe(false);

      // The revoked key can no longer start a ceremony at all. Note what this means for
      // the account: it was its ONLY factor, so the login now stops at the password and
      // the owner falls back under the mandatory-enrolment guard — confined to enrolling
      // a replacement rather than locked out. That is the intended shape of "I lost my
      // phone", and it is why revoke does not refuse to remove the last key.
      const after = await login();
      expect('accessToken' in after).toBe(true);
      expect(await twoFactor.statusFor(userId)).toBe('required');

      const stillHeld = (await login()) as schemas.AuthSession;
      expect(stillHeld.secondFactor).toBe('required');
      // And the device itself is no longer a credential the server will look up.
      expect(await passkeys.hasPasskey(userId)).toBe(false);
      expect(device.id).toBeTruthy();
    });

    it('is a soft delete, so the audit trail survives', async () => {
      const { userId } = await ownerWithPasskey();
      const [enrolled] = await passkeys.list(userId);

      await passkeys.revoke(userId, enrolled!.id);

      const [row] = await elevated.db
        .select()
        .from(userPasskeys)
        .where(eq(userPasskeys.id, enrolled!.id));
      expect(row!.deletedAt).not.toBeNull();
    });

    it('lets a phone that turns up again be re-enrolled', async () => {
      // Soft-delete plus a UNIQUE credential id would otherwise bar it forever, quietly
      // turning "revoke this device" into "destroy this device".
      const { userId, device } = await ownerWithPasskey();
      const [enrolled] = await passkeys.list(userId);
      await passkeys.revoke(userId, enrolled!.id);

      const options = await passkeys.beginRegistration(userId);
      await expect(
        passkeys.finishRegistration(userId, {
          credential: device.register({
            challenge: challengeFrom(options),
            origin: ORIGIN,
            rpId: RP_ID,
          }) as never,
          deviceLabel: 'Samsung A15 (found)',
        }),
      ).resolves.toMatchObject({ passkey: { deviceLabel: 'Samsung A15 (found)' } });

      await expect(loginWithPasskey(device)).resolves.toMatchObject({
        secondFactor: 'complete',
      });
    });

    it('refuses to revoke someone else‘s device, and does not confirm it exists', async () => {
      const { userId } = await ownerWithPasskey();
      const [victimKey] = await passkeys.list(userId);

      const other = await auth.register({
        ...REGISTRATION,
        business: { name: 'Other Boerdery', registrationNumber: null },
        owner: { ...REGISTRATION.owner, email: 'other@example.test' },
      });

      // 404, not 403: confirming that a passkey exists but belongs to someone else is
      // itself a disclosure.
      await expect(passkeys.revoke(other.user.id, victimKey!.id)).rejects.toThrow(NotFoundError);
      expect(await passkeys.list(userId)).toHaveLength(1);
    });
  });

  describe('logging in with a passkey', () => {
    it('offers the passkey first — a fingerprint before six digits (ADR-0007)', async () => {
      await ownerWithPasskey();
      const response = (await login()) as schemas.SecondFactorRequired;

      expect(response.secondFactorRequired).toBe(true);
      expect(response.methods[0]).toBe('passkey');
      expect(response.methods).toContain('recovery_code');
      expect(response.methods).not.toContain('sms');
      // No TOTP enrolled on this account, so it must not be offered as an option.
      expect(response.methods).not.toContain('totp');
    });

    it('completes the login when the phone signs the challenge', async () => {
      const { device } = await ownerWithPasskey();
      const session = await loginWithPasskey(device);

      expect(session.accessToken).toBeTruthy();
      expect(session.secondFactor).toBe('complete');
      expect(session.farms).toHaveLength(1);
    });

    it('records when the key was last used, so a stranger‘s device is visible', async () => {
      const { userId, device } = await ownerWithPasskey();
      await loginWithPasskey(device);

      const list = await passkeys.list(userId);
      expect(list).toHaveLength(1);
      expect(list[0]!.lastUsedAt).not.toBeNull();
      expect(list[0]!.deviceLabel).toBe('Samsung A15');
    });

    it('refuses an assertion from a look-alike origin', async () => {
      const { device } = await ownerWithPasskey();
      const challenge = (await login()) as schemas.SecondFactorRequired;
      const options = await passkeys.beginAuthentication(challenge.challengeToken);

      await expect(
        auth.verifyPasskey({
          challengeToken: challenge.challengeToken,
          credential: device.authenticate({
            challenge: challengeFrom(options),
            origin: 'https://werf-login.example.com',
            rpId: RP_ID,
          }) as never,
        }),
      ).rejects.toThrow(InvalidCredentialsError);
    });

    it('refuses a replayed assertion', async () => {
      const { device } = await ownerWithPasskey();
      const challenge = (await login()) as schemas.SecondFactorRequired;
      const options = await passkeys.beginAuthentication(challenge.challengeToken);
      const assertion = device.authenticate({
        challenge: challengeFrom(options),
        origin: ORIGIN,
        rpId: RP_ID,
      });

      await auth.verifyPasskey({
        challengeToken: challenge.challengeToken,
        credential: assertion as never,
      });

      // Same signature, same challenge token: both are spent.
      await expect(
        auth.verifyPasskey({
          challengeToken: challenge.challengeToken,
          credential: assertion as never,
        }),
      ).rejects.toThrow(SessionInvalidError);
    });

    it('spends the challenge on a FAILED attempt too', async () => {
      const { device } = await ownerWithPasskey();
      const challenge = (await login()) as schemas.SecondFactorRequired;
      const options = await passkeys.beginAuthentication(challenge.challengeToken);

      await expect(
        auth.verifyPasskey({
          challengeToken: challenge.challengeToken,
          credential: device.authenticate({
            challenge: challengeFrom(options),
            origin: 'https://wrong.example.com',
            rpId: RP_ID,
          }) as never,
        }),
      ).rejects.toThrow(InvalidCredentialsError);

      // A correct assertion on the same challenge token is now worthless.
      const fresh = device.authenticate({
        challenge: challengeFrom(options),
        origin: ORIGIN,
        rpId: RP_ID,
      });
      await expect(
        auth.verifyPasskey({
          challengeToken: challenge.challengeToken,
          credential: fresh as never,
        }),
      ).rejects.toThrow(SessionInvalidError);
    });

    it('refuses another person‘s credential presented against your own login', async () => {
      // The credential id is not a secret — it travels in the clear. So the lookup must
      // be bound to the user the challenge token identifies, not to the id alone.
      const { device: victimDevice } = await ownerWithPasskey();

      const attacker = await auth.register({
        ...REGISTRATION,
        business: { name: 'Other Boerdery', registrationNumber: null },
        owner: { ...REGISTRATION.owner, email: 'attacker@example.test' },
      });
      const attackerDevice = new TestAuthenticator();
      const enrol = await passkeys.beginRegistration(attacker.user.id);
      await passkeys.finishRegistration(attacker.user.id, {
        credential: attackerDevice.register({
          challenge: challengeFrom(enrol),
          origin: ORIGIN,
          rpId: RP_ID,
        }) as never,
        deviceLabel: null,
      });

      const challenge = (await auth.login({
        email: 'attacker@example.test',
        password: REGISTRATION.owner.password,
        deviceLabel: null,
      })) as schemas.SecondFactorRequired;
      const options = await passkeys.beginAuthentication(challenge.challengeToken);

      await expect(
        auth.verifyPasskey({
          challengeToken: challenge.challengeToken,
          credential: victimDevice.authenticate({
            challenge: challengeFrom(options),
            origin: ORIGIN,
            rpId: RP_ID,
          }) as never,
        }),
      ).rejects.toThrow(InvalidCredentialsError);
    });

    it('refuses a fabricated challenge token', async () => {
      await ownerWithPasskey();

      await expect(passkeys.beginAuthentication('not-a-real-token')).rejects.toThrow(
        SessionInvalidError,
      );
    });
  });

  describe('the signature counter', () => {
    it('accepts an authenticator that does not implement one', async () => {
      // Apple's and many Android platform authenticators always report 0. Requiring an
      // increase would lock out most of the devices ADR-0007 is actually aimed at.
      const { device } = await ownerWithPasskey();

      await expect(loginWithPasskey(device)).resolves.toMatchObject({
        secondFactor: 'complete',
      });
      await expect(loginWithPasskey(device)).resolves.toMatchObject({
        secondFactor: 'complete',
      });
    });

    it('advances it when the authenticator does keep one', async () => {
      const session = await auth.register(REGISTRATION);
      const device = new TestAuthenticator({ counter: 1 });

      const options = await passkeys.beginRegistration(session.user.id);
      await passkeys.finishRegistration(session.user.id, {
        credential: device.register({
          challenge: challengeFrom(options),
          origin: ORIGIN,
          rpId: RP_ID,
        }) as never,
        deviceLabel: null,
      });

      await loginWithPasskey(device);

      const [row] = await elevated.db
        .select()
        .from(userPasskeys)
        .where(eq(userPasskeys.userId, session.user.id));
      expect(Number(row!.signCount)).toBeGreaterThan(1);
    });

    it('refuses a counter that goes backwards — the cloned-authenticator signal', async () => {
      const session = await auth.register(REGISTRATION);
      const device = new TestAuthenticator({ counter: 10 });

      const options = await passkeys.beginRegistration(session.user.id);
      await passkeys.finishRegistration(session.user.id, {
        credential: device.register({
          challenge: challengeFrom(options),
          origin: ORIGIN,
          rpId: RP_ID,
        }) as never,
        deviceLabel: null,
      });

      await loginWithPasskey(device);

      // A second authenticator holding a copy of the key would report a counter it has
      // already used. That is the one signal WebAuthn gives us that a key was cloned.
      device.rewindCounter(1);

      const challenge = (await login()) as schemas.SecondFactorRequired;
      const replayOptions = await passkeys.beginAuthentication(challenge.challengeToken);
      await expect(
        auth.verifyPasskey({
          challengeToken: challenge.challengeToken,
          credential: device.authenticate({
            challenge: challengeFrom(replayOptions),
            origin: ORIGIN,
            rpId: RP_ID,
            incrementCounter: true,
          }) as never,
        }),
      ).rejects.toThrow(InvalidCredentialsError);
    });
  });

  describe('the challenge store', () => {
    it('does not leave a spent challenge usable', async () => {
      const { userId } = await ownerWithPasskey();

      const rows = await elevated.db
        .select()
        .from(webauthnChallenges)
        .where(eq(webauthnChallenges.userId, userId));

      expect(rows).toHaveLength(1);
      expect(rows[0]!.consumedAt).not.toBeNull();
    });

    it('abandons an earlier ceremony when a new one starts', async () => {
      // Two tabs, two challenges. Every challenge left open is another value an attacker
      // gets to race, so starting a ceremony must retire the one before it.
      const session = await auth.register(REGISTRATION);

      const stale = await passkeys.beginRegistration(session.user.id);
      const current = await passkeys.beginRegistration(session.user.id);

      const rows = await elevated.db
        .select()
        .from(webauthnChallenges)
        .where(eq(webauthnChallenges.userId, session.user.id));

      const staleRow = rows.find((r) => r.challenge === challengeFrom(stale));
      const currentRow = rows.find((r) => r.challenge === challengeFrom(current));

      expect(staleRow!.consumedAt).not.toBeNull();
      expect(currentRow!.consumedAt).toBeNull();
    });

    it('lets an attempt against a retired challenge cost the ceremony', async () => {
      // Consequence of one-challenge-at-a-time worth stating out loud: the server spends
      // whichever challenge is open, then checks the signature against it. So a stale tab
      // submitting late does not merely fail — it burns the live ceremony, and the farmer
      // starts again. That is the right trade (a challenge is one attempt, always), but
      // it is a real behaviour the client has to expect rather than treat as a glitch.
      const session = await auth.register(REGISTRATION);
      const device = new TestAuthenticator();

      const stale = await passkeys.beginRegistration(session.user.id);
      await passkeys.beginRegistration(session.user.id);

      await expect(
        passkeys.finishRegistration(session.user.id, {
          credential: device.register({
            challenge: challengeFrom(stale),
            origin: ORIGIN,
            rpId: RP_ID,
          }) as never,
          deviceLabel: null,
        }),
      ).rejects.toThrow(InvalidCredentialsError);

      const open = await elevated.db
        .select()
        .from(webauthnChallenges)
        .where(eq(webauthnChallenges.userId, session.user.id));
      expect(open.every((row) => row.consumedAt !== null)).toBe(true);
    });
  });
});
