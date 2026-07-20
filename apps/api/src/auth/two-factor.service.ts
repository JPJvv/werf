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
import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { farmUsers, users, type ElevatedDb } from '@werf/db';
import { ConflictError, InvalidCredentialsError, SessionInvalidError, schemas } from '@werf/core';
import { APP_CONFIG, ELEVATED_DB } from '../db/db.module';
import type { AppConfig } from '../config/config';
import { SessionService, type IssuedSession } from './session.service';
import { PasskeyService } from './passkey.service';
import { RecoveryCodeService } from './recovery-code.service';
import { TokenService } from './token.service';
import { decryptPii, encryptPii, parsePiiKey } from './pii-crypto';
import { generateTotpSecret, totpEnrolmentUri, verifyTotp } from './totp';

/** What the QR code and the authenticator app's account list will say. */
const TOTP_ISSUER = 'Werf';

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
    @Inject(PasskeyService) private readonly passkeys: PasskeyService,
    @Inject(RecoveryCodeService) private readonly recoveryCodes: RecoveryCodeService,
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
   *
   * `issueIfNone`, NOT `issue`. This path used to mint a fresh set unconditionally, which
   * silently invalidated the page already printed and in the safe: an owner enrols a
   * passkey (which issues codes), then months later adds an authenticator app, and the ten
   * codes they wrote down stop working with nothing said. They would find out in the one
   * scenario FR-014a exists for — the phone at the bottom of a dam — which is the worst
   * possible moment to discover it. Recovery codes belong to the ACCOUNT, not to whichever
   * factor was enrolled last, so they are minted once and only replaced deliberately.
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

    await this.elevated.db
      .update(users)
      .set({ totpEnrolledAt: new Date(), totpLastUsedStep: result.step })
      .where(eq(users.id, userId));

    // Null when the account already had codes — the caller renders "you already have
    // recovery codes" rather than a page of new ones, and the printed set stays valid.
    return { recoveryCodes: await this.recoveryCodes.issueIfNone(userId) };
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
        : await this.recoveryCodes.consume(user.id, input.code);
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
    // EITHER factor discharges the obligation. ADR-0007 prefers passkeys and calls TOTP
    // the universal fallback, so an owner who enrolled a fingerprint and no authenticator
    // app has done what FR-014 asks; demanding both would be a rule the ADR does not make.
    if (await this.isEnrolled(userId)) return 'complete';

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

  /** True when this user has ANY second factor enrolled — a passkey or an authenticator. */
  async isEnrolled(userId: string): Promise<boolean> {
    if ((await this.loadUser(userId)).totpEnrolledAt !== null) return true;
    return this.passkeys.hasPasskey(userId);
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
