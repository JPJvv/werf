/**
 * Passkeys (WebAuthn) — ADR-0007's PREFERRED second factor.
 *
 * The reasoning that makes this worth the implementation cost: the platform authenticator
 * on a modern Android or iPhone IS a fingerprint sensor, and a farmer already unlocks
 * their phone with it forty times a day. It also works with no signal, which SMS does not.
 * The unfamiliar word is "passkey", so the copy never uses it.
 *
 * What we store is PUBLIC KEYS. A breach of `user_passkeys` gives an attacker nothing —
 * that is not a happy accident, it is why the credential type was chosen. The private key
 * never leaves the user's phone, and we could not disclose it if we were compelled to.
 *
 * Registration needs a network round trip and so happens at onboarding, in the office;
 * authentication against a platform authenticator does not, and works in a camp.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { userPasskeys, users, webauthnChallenges, type ElevatedDb } from '@werf/db';
import {
  ConflictError,
  InvalidCredentialsError,
  NotFoundError,
  SessionInvalidError,
  schemas,
} from '@werf/core';
import { APP_CONFIG, ELEVATED_DB } from '../db/db.module';
import type { AppConfig } from '../config/config';
import type { AuthAuditContext } from './auth-audit';
import { SessionService, type IssuedSession } from './session.service';
import { RecoveryCodeService } from './recovery-code.service';

/**
 * How long a ceremony may stay open. Long enough to find the phone and present a finger;
 * short enough that a challenge left in a closed tab is worthless.
 */
const CHALLENGE_TTL_SECONDS = 5 * 60;

type Ceremony = 'registration' | 'authentication';

@Injectable()
export class PasskeyService {
  constructor(
    @Inject(ELEVATED_DB) private readonly elevated: ElevatedDb,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(RecoveryCodeService) private readonly recoveryCodes: RecoveryCodeService,
  ) {}

  /**
   * Begins enrolment for an authenticated user.
   *
   * `excludeCredentials` lists what they already have, so the authenticator itself
   * refuses to enrol the same device twice rather than silently creating a duplicate the
   * user cannot tell apart in a revocation list.
   */
  async beginRegistration(userId: string): Promise<schemas.PasskeyCeremonyOptions> {
    const [user] = await this.elevated.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new InvalidCredentialsError();

    const existing = await this.listCredentials(userId);

    const options = await generateRegistrationOptions({
      rpName: this.config.webauthnRpName,
      rpID: this.config.webauthnRpId,
      // The user handle. Deliberately the opaque UUID and never the email address: it is
      // stored on the authenticator, may be shown by the platform, and can be read back
      // during a usernameless ceremony. A handle that carries PII leaks it to anyone who
      // gets the phone.
      userID: Buffer.from(user.id, 'utf8'),
      userName: user.email ?? user.phone ?? user.id,
      userDisplayName: user.fullName,
      attestationType: 'none',
      excludeCredentials: existing.map((credential) => ({
        id: toBase64Url(credential.credentialId),
        transports: credential.transports as never,
      })),
      authenticatorSelection: {
        // The phone in their pocket, not a USB key they will lose in a bakkie.
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        // 'preferred', not 'required', and the same on the authentication side. The
        // decision: this is a SECOND factor, presented after a password, so proving
        // possession of the enrolled phone is already the property we need — and
        // 'required' turns every device with a broken sensor or no screen lock into a
        // farmer who cannot log in. Enforcing user verification would be the right call
        // if a passkey ever becomes the FIRST factor; it is not one today.
        userVerification: 'preferred',
      },
    });

    // No login family: enrolment happens inside an already-authenticated session.
    await this.storeChallenge({
      userId,
      sessionFamilyId: null,
      challenge: options.challenge,
      ceremony: 'registration',
    });
    return { options: options as unknown as Record<string, unknown> };
  }

  /**
   * Completes enrolment. The signature is verified by `@simplewebauthn`, against the
   * challenge WE issued and the origin and RP ID WE expect — the three checks that make a
   * passkey phishing-resistant. A response verified against a challenge the client chose
   * would prove nothing at all.
   */
  async finishRegistration(
    userId: string,
    input: schemas.PasskeyRegistrationRequest,
  ): Promise<schemas.PasskeyEnrolmentResponse> {
    const challenge = await this.consumeChallenge(userId, null, 'registration');

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: input.credential as never,
        expectedChallenge: challenge,
        expectedOrigin: this.config.webauthnOrigin,
        expectedRPID: this.config.webauthnRpId,
        requireUserVerification: false,
      });
    } catch {
      // A malformed or unverifiable attestation is a failed enrolment, not a 500. The
      // challenge is already spent either way.
      throw new InvalidCredentialsError();
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new InvalidCredentialsError();
    }

    const credential = verification.registrationInfo.credential;
    const credentialId = fromBase64Url(credential.id);

    // The credential id is globally unique by construction, and the column is UNIQUE, so
    // an existing row means this key was enrolled before — on this account or, in
    // principle, another.
    const [existing] = await this.elevated.db
      .select()
      .from(userPasskeys)
      .where(eq(userPasskeys.credentialId, credentialId));

    let row: typeof userPasskeys.$inferSelect | undefined;

    if (existing && existing.deletedAt !== null && existing.userId === userId) {
      // A device this same user revoked and is now re-enrolling — a phone found again
      // after being written off. Soft-delete plus a UNIQUE credential id would otherwise
      // bar it forever, turning "revoke" into "destroy", so the tombstone is lifted and
      // the freshly attested key material replaces what was there.
      [row] = await this.elevated.db
        .update(userPasskeys)
        .set({
          deletedAt: null,
          publicKey: credential.publicKey,
          signCount: credential.counter,
          transports: credential.transports ?? null,
          deviceLabel: input.deviceLabel,
          lastUsedAt: null,
        })
        .where(eq(userPasskeys.id, existing.id))
        .returning();
    } else if (existing) {
      // Live on this account, or belonging to someone else. The message is the same in
      // both cases on purpose: a distinguishable "already enrolled elsewhere" turns this
      // endpoint into an oracle for whether an arbitrary credential id exists, and
      // credential ids are not secret — they travel in `allowCredentials`.
      throw new ConflictError('That device cannot be enrolled');
    } else {
      [row] = await this.elevated.db
        .insert(userPasskeys)
        .values({
          userId,
          credentialId,
          publicKey: credential.publicKey,
          signCount: credential.counter,
          transports: credential.transports ?? null,
          deviceLabel: input.deviceLabel,
        })
        .returning();
    }

    // If this is the account's FIRST factor, it also needs a way back from losing it.
    // A passkey-only owner whose phone drowns has otherwise no route in at all, which is
    // precisely the scenario FR-014a exists for — and the login screen would be offering
    // them a "use a recovery code" option that could never work.
    const recoveryCodes = await this.recoveryCodes.issueIfNone(userId);

    return {
      passkey: {
        id: row!.id,
        deviceLabel: row!.deviceLabel,
        createdAt: row!.createdAt,
        lastUsedAt: row!.lastUsedAt,
      },
      // Present exactly once, on the enrolment that created them (FR-014a).
      recoveryCodes,
    };
  }

  /**
   * Revokes a passkey — a lost or sold phone must stop being a key (FR-014c).
   *
   * Soft-delete, per the repository rule, and scoped to the owner so one user cannot
   * revoke another's device. It deliberately does NOT refuse to remove the last one: an
   * account whose only factor is a phone in a dam must be able to say so, and the
   * mandatory-enrolment guard then confines them to enrolling a replacement.
   */
  async revoke(userId: string, passkeyId: string): Promise<void> {
    const revoked = await this.elevated.db
      .update(userPasskeys)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(userPasskeys.id, passkeyId),
          eq(userPasskeys.userId, userId),
          isNull(userPasskeys.deletedAt),
        ),
      )
      .returning({ id: userPasskeys.id });

    // 404 rather than 403 for someone else's key: confirming that a passkey exists but
    // belongs to another account is itself a disclosure.
    if (revoked.length === 0) throw new NotFoundError('No such passkey');
  }

  /**
   * Begins an authentication ceremony for a login that has passed the password.
   *
   * Scoped to the half-authenticated session's user, so this endpoint cannot be used to
   * ask "which passkeys does this email address have?" — that question is an
   * enumeration oracle, and the challenge token is what proves the caller may ask.
   */
  async beginAuthentication(challengeToken: string): Promise<schemas.PasskeyCeremonyOptions> {
    const pending = await this.sessions.findPendingSecondFactor(challengeToken);
    if (!pending) throw new SessionInvalidError('unknown');

    const credentials = await this.listCredentials(pending.userId);
    if (credentials.length === 0) throw new InvalidCredentialsError();

    const options = await generateAuthenticationOptions({
      rpID: this.config.webauthnRpId,
      allowCredentials: credentials.map((credential) => ({
        id: toBase64Url(credential.credentialId),
        transports: credential.transports as never,
      })),
      userVerification: 'preferred',
    });

    await this.storeChallenge({
      userId: pending.userId,
      sessionFamilyId: pending.familyId,
      challenge: options.challenge,
      ceremony: 'authentication',
    });
    return { options: options as unknown as Record<string, unknown> };
  }

  /**
   * Completes authentication, turning the challenge token into a real session.
   *
   * Like the TOTP path, the half-authenticated challenge is spent BEFORE the signature is
   * judged, and a new session family is issued rather than the pending row being upgraded
   * in place — see the note on `TwoFactorService.verifySecondFactor` for why both matter.
   */
  async verifySecondFactor(
    input: schemas.PasskeyAuthenticationRequest,
    context: AuthAuditContext = {},
  ): Promise<{ userId: string; session: IssuedSession }> {
    const pending = await this.sessions.findPendingSecondFactor(input.challengeToken);
    if (!pending) throw new SessionInvalidError('unknown');

    const challenge = await this.consumeChallenge(
      pending.userId,
      pending.familyId,
      'authentication',
    );
    await this.sessions.revokeFamily(pending.familyId, 'second-factor-attempted');

    const credentialId = fromBase64Url(input.credential.id);

    // Bound to the user the challenge token identifies. Looking the credential up by id
    // alone would let anyone who knows another person's credential id — it is not a
    // secret, it is sent in the clear — present it against their OWN half-authenticated
    // session. The signature would fail, but the lookup should never get that far.
    const [credential] = await this.elevated.db
      .select()
      .from(userPasskeys)
      .where(
        and(
          eq(userPasskeys.credentialId, credentialId),
          eq(userPasskeys.userId, pending.userId),
          isNull(userPasskeys.deletedAt),
        ),
      );
    if (!credential) throw new InvalidCredentialsError();

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: input.credential as never,
        expectedChallenge: challenge,
        expectedOrigin: this.config.webauthnOrigin,
        expectedRPID: this.config.webauthnRpId,
        requireUserVerification: false,
        credential: {
          id: toBase64Url(credential.credentialId),
          // Copied rather than passed through: the driver hands back a view onto a shared
          // buffer, which does not satisfy the library's stricter `Uint8Array<ArrayBuffer>`.
          publicKey: Uint8Array.from(credential.publicKey),
          counter: Number(credential.signCount),
          transports: (credential.transports ?? undefined) as never,
        },
      });
    } catch {
      throw new InvalidCredentialsError();
    }

    if (!verification.verified) throw new InvalidCredentialsError();

    // Two different guards, and it is worth being precise about which does what.
    //
    // ROLLBACK — a counter at or below the stored one, the signal that a credential has
    // been cloned — is caught by `verifyAuthenticationResponse` above, which throws
    // before we get here. That check is the library's, not ours.
    //
    // What the predicate below adds is the CONCURRENT case the library cannot see: two
    // simultaneous assertions carrying the same counter both pass verification against
    // the same stored value, and only one may advance it. Writing unconditionally after
    // a read would be the same read-modify-write race the TOTP replay guard had.
    //
    // A counter of 0 means the authenticator does not implement one at all — normal for
    // Apple and many Android platform authenticators, which are exactly the devices
    // ADR-0007 targets. There is nothing to enforce then, and demanding an increase would
    // lock those users out.
    const newCounter = verification.authenticationInfo.newCounter;
    if (newCounter > 0) {
      const advanced = await this.elevated.db
        .update(userPasskeys)
        .set({ signCount: newCounter, lastUsedAt: new Date() })
        .where(
          and(eq(userPasskeys.id, credential.id), sql`${userPasskeys.signCount} < ${newCounter}`),
        )
        .returning({ id: userPasskeys.id });

      if (advanced.length === 0) throw new InvalidCredentialsError();
    } else {
      await this.elevated.db
        .update(userPasskeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(userPasskeys.id, credential.id));
    }

    const session = await this.sessions.issue(
      {
        userId: pending.userId,
        activeFarmId: pending.activeFarmId,
        deviceLabel: pending.deviceLabel,
        secondFactorSatisfied: true,
      },
      {
        event: 'login',
        outcome: 'success',
        actorUserId: pending.userId,
        subjectUserId: pending.userId,
        farmId: pending.activeFarmId,
        ...context,
        metadata: { method: 'passkey' },
      },
    );

    return { userId: pending.userId, session };
  }

  /** True when this user has at least one live passkey — the login branch reads this. */
  async hasPasskey(userId: string): Promise<boolean> {
    return (await this.listCredentials(userId)).length > 0;
  }

  /** The user's enrolled devices, for a revocation list. Public keys are not included. */
  async list(userId: string): Promise<schemas.PasskeySummary[]> {
    const rows = await this.listCredentials(userId);
    return rows.map((row) => ({
      id: row.id,
      deviceLabel: row.deviceLabel,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
    }));
  }

  private async listCredentials(userId: string): Promise<(typeof userPasskeys.$inferSelect)[]> {
    return this.elevated.db
      .select()
      .from(userPasskeys)
      .where(and(eq(userPasskeys.userId, userId), isNull(userPasskeys.deletedAt)));
  }

  /**
   * Opens a ceremony, retiring the previous one of the same kind for the same scope.
   *
   * `scope` is the login family for an authentication and the user for an enrolment. The
   * distinction matters: without it, a challenge is keyed only by user, and anyone holding
   * the victim's PASSWORD can call the challenge endpoint in a loop, retiring the victim's
   * genuine challenge each time so their real assertion never has a live value to match.
   * That is a targeted denial of the preferred second factor bought with a credential the
   * attacker already has. Scoping to the family means their loop only starves their own
   * login attempt.
   *
   * Both statements run in ONE transaction. Retire-then-insert as two round trips lets two
   * concurrent begins each see nothing open and each insert, leaving two live challenges —
   * which the consuming UPDATE would then spend together, failing the honest client.
   */
  private async storeChallenge(params: {
    userId: string;
    sessionFamilyId: string | null;
    challenge: string;
    ceremony: Ceremony;
  }): Promise<void> {
    await this.elevated.db.transaction(async (tx) => {
      await tx
        .update(webauthnChallenges)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(webauthnChallenges.userId, params.userId),
            eq(webauthnChallenges.ceremony, params.ceremony),
            scopeMatches(params.sessionFamilyId),
            isNull(webauthnChallenges.consumedAt),
          ),
        );

      await tx.insert(webauthnChallenges).values({
        userId: params.userId,
        sessionFamilyId: params.sessionFamilyId,
        challenge: params.challenge,
        ceremony: params.ceremony,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000),
      });
    });
  }

  /**
   * Spends the open challenge for this scope and ceremony, or throws.
   *
   * The consuming UPDATE carries every condition — unspent, unexpired, right user, right
   * ceremony, right login family — and reports what it consumed. That is what makes the
   * challenge single-use under concurrency: two requests racing it cannot both find it
   * open, because only one UPDATE can match a row that its own predicate then excludes.
   *
   * Note it does not match on the challenge VALUE the client submitted, and does not need
   * to: whatever row this spends becomes the `expectedChallenge` the assertion is verified
   * against, so a client that signed anything else fails. The consequence worth knowing is
   * that a late submission from a stale tab burns the live ceremony rather than being
   * ignored — one challenge, one attempt, always.
   */
  private async consumeChallenge(
    userId: string,
    sessionFamilyId: string | null,
    ceremony: Ceremony,
  ): Promise<string> {
    const [consumed] = await this.elevated.db
      .update(webauthnChallenges)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(webauthnChallenges.userId, userId),
          eq(webauthnChallenges.ceremony, ceremony),
          scopeMatches(sessionFamilyId),
          isNull(webauthnChallenges.consumedAt),
          sql`${webauthnChallenges.expiresAt} > now()`,
        ),
      )
      .returning({ challenge: webauthnChallenges.challenge });

    if (!consumed) throw new InvalidCredentialsError();
    return consumed.challenge;
  }
}

/**
 * Ties a challenge to the login it belongs to. Enrolment challenges have no login family
 * (the user is already authenticated), so they match on NULL — written as an explicit
 * `IS NULL` because `= NULL` is never true in SQL and would silently match nothing.
 */
function scopeMatches(sessionFamilyId: string | null) {
  return sessionFamilyId === null
    ? isNull(webauthnChallenges.sessionFamilyId)
    : eq(webauthnChallenges.sessionFamilyId, sessionFamilyId);
}

/** The library speaks base64url strings; the database stores raw bytes. */
function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function fromBase64Url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}
