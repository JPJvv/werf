/**
 * Second-factor enrolment and verification (FR-014, FR-014a, ADR-0007).
 *
 * Passkeys are the preferred factor and arrive in their own slice; TOTP is the universal
 * fallback that has to work on a cheap Android, on a shared office desktop, and in a camp
 * with no signal. SMS is not here and never will be — see ADR-0007.
 *
 * Runs elevated throughout, for two reasons: verification happens BEFORE there is a
 * session to scope by, and the columns it touches are credential state that no request
 * path should be able to reach.
 *
 * Note the gap that makes "should" the right word there. Migration 0001 grants
 * `SELECT, INSERT, UPDATE` on `users` table-wide to `werf_app`, with no column list, so
 * the app role CAN in principle read a co-member's encrypted seed and rewrite its own
 * `totp_last_used_step`. Nothing does today — every path here is elevated and bound to
 * the acting user — but the separation is currently a convention rather than a grant.
 * Closing it needs column-level grants in a follow-up migration; tracked in
 * docs/05-operations/security.md §10.2.
 */

import { Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { and, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { farmUsers, users, type ElevatedDb } from '@werf/db';
import { ConflictError, InvalidCredentialsError, SessionInvalidError, schemas } from '@werf/core';
import { APP_CONFIG, ELEVATED_DB } from '../db/db.module';
import type { AppConfig } from '../config/config';
import { SessionService, type IssuedSession } from './session.service';
import { TokenService } from './token.service';
import { decryptPii, encryptPii, parsePiiKey } from './pii-crypto';
import { generateTotpSecret, totpEnrolmentUri, verifyTotp } from './totp';

/** What the QR code and the authenticator app's account list will say. */
const TOTP_ISSUER = 'Werf';

/** FR-014a: ten codes, single-use, shown once. */
const RECOVERY_CODE_COUNT = 10;

/**
 * The alphabet for recovery codes. No 0/O, no 1/I/L: these get printed and put in a safe,
 * then retyped a year later by someone reading their own handwriting under pressure,
 * having lost their phone. Ambiguity here is a support call at the worst possible moment.
 */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const RECOVERY_GROUP_LENGTH = 5;
const RECOVERY_GROUPS = 2;

/**
 * The roles that MUST have a second factor (FR-014). An owner holds the keys to the whole
 * business; a bookkeeper sees every wage and bank detail on the farm. A manager may enrol
 * and is encouraged to, but is not locked out for not having.
 */
const ROLES_REQUIRING_SECOND_FACTOR: ReadonlySet<string> = new Set(['owner', 'bookkeeper']);

@Injectable()
export class TwoFactorService {
  constructor(
    @Inject(ELEVATED_DB) private readonly elevated: ElevatedDb,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  /**
   * Starts TOTP enrolment: a fresh secret, stored encrypted but NOT yet active.
   *
   * `totp_enrolled_at` stays null until the user proves they can produce a code from it.
   * That ordering is the whole design — activating on generation would lock out anyone
   * whose camera failed to scan, whose clock is wrong, or who closed the tab, and the
   * account that gets locked out is the owner's.
   */
  async beginTotpEnrolment(userId: string): Promise<schemas.TotpEnrolmentStartResponse> {
    const user = await this.loadUser(userId);

    // Re-enrolling is allowed (a new phone), but not silently while one already works:
    // an attacker with a stolen session must not be able to swap the second factor out
    // from under the owner. Disenrolment is a deliberate, separately authorised act.
    if (user.totpEnrolledAt !== null) {
      throw new ConflictError('An authenticator app is already enrolled on this account');
    }

    const secret = generateTotpSecret();
    await this.elevated.db
      .update(users)
      .set({ totpSecretEncrypted: this.encryptSeed(secret, userId), totpLastUsedStep: null })
      .where(eq(users.id, userId));

    return {
      secret,
      uri: totpEnrolmentUri({
        secret,
        account: user.email ?? user.phone ?? user.id,
        issuer: TOTP_ISSUER,
      }),
    };
  }

  /**
   * Confirms enrolment with a code from the app, and issues the recovery codes.
   *
   * Recovery codes are generated HERE, not at `begin`, because they only mean anything
   * once the factor they recover from is live — and because showing them beside a QR code
   * the user never scanned trains people to ignore them.
   */
  async confirmTotpEnrolment(
    userId: string,
    code: string,
  ): Promise<schemas.TotpEnrolmentConfirmResponse> {
    const user = await this.loadUser(userId);
    if (user.totpEnrolledAt !== null) {
      throw new ConflictError('An authenticator app is already enrolled on this account');
    }
    if (!user.totpSecretEncrypted) {
      throw new ConflictError('Start enrolment before confirming it');
    }

    const secret = this.decryptSeed(user.totpSecretEncrypted, userId);
    const result = verifyTotp(secret, code, new Date());
    if (!result.valid) throw new InvalidCredentialsError();

    const plainCodes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    const hashed = await Promise.all(plainCodes.map((c) => this.tokens.hashPassword(normalise(c))));

    await this.elevated.db
      .update(users)
      .set({
        totpEnrolledAt: new Date(),
        totpLastUsedStep: result.step,
        recoveryCodesHashed: hashed,
      })
      .where(eq(users.id, userId));

    // The ONLY time these exist in plaintext anywhere. We store argon2id hashes, so this
    // is not a policy we could relax later even if someone asked — the codes are gone.
    return { recoveryCodes: plainCodes };
  }

  /**
   * Satisfies the second factor for a half-authenticated login, turning the challenge
   * token into a real session.
   *
   * The returned session is a NEW one, not the challenge session upgraded in place. A
   * half-authenticated row has already been handed to the caller as a bearer token; if we
   * flipped `second_factor_at` on that same row, the string the caller already holds would
   * retroactively become a full refresh token, and any copy of it made while it was
   * harmless becomes a live session.
   */
  async verifySecondFactor(
    input: schemas.VerifySecondFactorRequest,
  ): Promise<{ userId: string; session: IssuedSession }> {
    const pending = await this.sessions.findPendingSecondFactor(input.challengeToken);
    if (!pending) throw new SessionInvalidError('unknown');

    const user = await this.loadUser(pending.userId);

    // The challenge is spent BEFORE the code is judged, so one challenge token buys
    // exactly one attempt whether it succeeds or fails. Revoking after the rejection —
    // the obvious ordering — leaves a failed attempt's challenge alive and turns this
    // endpoint into an unlimited guessing oracle against six digits: an attacker with
    // the password alone could grind the whole 10^6 space against a re-rolling target.
    // Retrying now costs a fresh login, which puts the first factor back in the way.
    await this.sessions.revokeFamily(pending.familyId, 'second-factor-attempted');

    const accepted =
      input.method === 'totp'
        ? await this.consumeTotp(user, input.code)
        : await this.consumeRecoveryCode(user, input.code);
    if (!accepted) throw new InvalidCredentialsError();

    const session = await this.sessions.issue({
      userId: pending.userId,
      activeFarmId: pending.activeFarmId,
      deviceLabel: pending.deviceLabel,
      secondFactorSatisfied: true,
    });

    return { userId: pending.userId, session };
  }

  /**
   * What this account owes (FR-014). Read on every login and by the guard, so it is one
   * query: the roles this user actually holds, on accepted memberships only.
   */
  async statusFor(userId: string): Promise<schemas.SecondFactorStatus> {
    const user = await this.loadUser(userId);
    if (user.totpEnrolledAt !== null) return 'complete';

    // `accepted_at IS NOT NULL` matters as much here as it does in the RLS predicate: an
    // invitation grants nothing until it is accepted, so it must not IMPOSE anything
    // either. Without it, naming any address as a farm's bookkeeper would confine that
    // stranger's existing account to an enrolment screen — a denial of service anyone
    // could aim at anyone, with no consent involved.
    const memberships = await this.elevated.db
      .select({ role: farmUsers.role })
      .from(farmUsers)
      .where(
        and(
          eq(farmUsers.userId, userId),
          isNull(farmUsers.deletedAt),
          isNotNull(farmUsers.acceptedAt),
        ),
      );

    const mustEnrol = memberships.some((m) => ROLES_REQUIRING_SECOND_FACTOR.has(m.role));

    return mustEnrol ? 'required' : 'optional';
  }

  /** True when this user has any second factor enrolled — the login branch reads this. */
  async isEnrolled(userId: string): Promise<boolean> {
    return (await this.loadUser(userId)).totpEnrolledAt !== null;
  }

  /**
   * Verifies a TOTP code and burns the step it came from.
   *
   * Advancing `totpLastUsedStep` is what makes a code single-use: a code stays valid for
   * its whole period, so without this the six digits someone read over a shoulder work
   * again for up to ninety seconds.
   *
   * The UPDATE *is* the check. Comparing the step against the row we read a moment ago
   * and then writing unconditionally is a read-modify-write race, and concurrency is
   * precisely the attacker's posture: two simultaneous requests carrying the same stolen
   * code would both read the old step, both pass the comparison, and both get a session.
   * Making the predicate part of the write means the database decides, once.
   */
  private async consumeTotp(user: UserRow, code: string): Promise<boolean> {
    if (!user.totpSecretEncrypted || user.totpEnrolledAt === null) return false;

    const result = verifyTotp(
      this.decryptSeed(user.totpSecretEncrypted, user.id),
      code,
      new Date(),
    );
    if (!result.valid) return false;

    const advanced = await this.elevated.db
      .update(users)
      .set({ totpLastUsedStep: result.step })
      .where(
        and(
          eq(users.id, user.id),
          or(isNull(users.totpLastUsedStep), lt(users.totpLastUsedStep, result.step)),
        ),
      )
      .returning({ id: users.id });

    // No row updated means another request already spent this step. Exactly one caller
    // can win, and the loser is told the code is invalid — which it now is.
    return advanced.length === 1;
  }

  /**
   * Verifies a recovery code and consumes it — FR-014a's "single-use", enforced by
   * deleting the hash rather than by a flag, so there is nothing left to un-delete.
   *
   * Every stored hash is checked even after a match, because argon2id is slow and
   * returning on the first hit makes a code stored early in the array verify measurably
   * faster than one stored late.
   *
   * The removal is done by the database with `array_remove`, gated on the hash still
   * being present, rather than by writing back a filtered copy of the array we read.
   * Writing back a copy is a lost update: two concurrent redemptions of DIFFERENT codes
   * each compute nine elements from the same ten-element snapshot, and the second write
   * silently resurrects the code the first one burned. "Single-use, permanently"
   * (FR-014a) has to be enforced by the write, not by the snapshot.
   */
  private async consumeRecoveryCode(user: UserRow, code: string): Promise<boolean> {
    const stored = user.recoveryCodesHashed ?? [];
    if (stored.length === 0) return false;

    const supplied = normalise(code);
    let matched: string | undefined;

    for (const hash of stored) {
      if (await this.tokens.verifyPassword(hash, supplied)) matched ??= hash;
    }
    if (matched === undefined) return false;

    const consumed = await this.elevated.db
      .update(users)
      .set({ recoveryCodesHashed: sql`array_remove(${users.recoveryCodesHashed}, ${matched})` })
      .where(and(eq(users.id, user.id), sql`${matched} = ANY(${users.recoveryCodesHashed})`))
      .returning({ id: users.id });

    // Lost the race: someone else redeemed this same code first. It is spent either way.
    return consumed.length === 1;
  }

  private encryptSeed(secret: string, userId: string): Uint8Array {
    return encryptPii(secret, parsePiiKey(this.config.piiEncryptionKey), userId);
  }

  private decryptSeed(envelope: Uint8Array, userId: string): string {
    return decryptPii(envelope, parsePiiKey(this.config.piiEncryptionKey), userId);
  }

  private async loadUser(userId: string): Promise<UserRow> {
    const [user] = await this.elevated.db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)));
    if (!user) throw new InvalidCredentialsError();
    return user;
  }
}

type UserRow = typeof users.$inferSelect;

/** `A7K2M-9PQRS`. Two groups of five: ~49 bits, and readable off a printed page. */
function generateRecoveryCode(): string {
  const group = () =>
    Array.from(
      { length: RECOVERY_GROUP_LENGTH },
      () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)],
    ).join('');

  return Array.from({ length: RECOVERY_GROUPS }, group).join('-');
}

/**
 * Case and separators are presentation, not secret. Someone retyping a code off paper will
 * lower-case it, add a space, or drop the hyphen, and none of those should cost them their
 * only way back into the account.
 */
function normalise(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}
