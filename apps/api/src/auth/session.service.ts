/**
 * Refresh-session lifecycle: issue, rotate, revoke (ADR-0007).
 *
 * Runs on the elevated connection because the refresh path must find a session BEFORE it
 * knows whose it is — there is no user id to scope by until the token has been resolved.
 * `user_sessions` is unreachable from the app role by design (migration 0003).
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { userSessions, type ElevatedDb } from '@werf/db';
import { SessionInvalidError } from '@werf/core';
import { REFRESH_TOKEN_TTL_SECONDS } from '../config/config';
import { ELEVATED_DB } from '../db/db.module';
import { TokenService } from './token.service';

/** What the rotation transaction found. Reported, not thrown — see `rotate`. */
type RotateOutcome =
  | { kind: 'ok'; session: IssuedSession }
  | { kind: 'reuse'; familyId: string }
  | { kind: 'invalid'; reason: 'unknown' | 'revoked' | 'expired' };

export interface IssuedSession {
  readonly sessionId: string;
  readonly familyId: string;
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
  readonly activeFarmId: string | null;
  /** Null while the account still owes a second factor. */
  readonly secondFactorAt: Date | null;
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(ELEVATED_DB) private readonly elevated: ElevatedDb,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  /** Starts a NEW rotation family. This is a login, not a refresh. */
  async issue(params: {
    userId: string;
    activeFarmId: string | null;
    deviceLabel: string | null;
    secondFactorSatisfied: boolean;
  }): Promise<IssuedSession> {
    const familyId = crypto.randomUUID();
    return this.insert({ ...params, familyId });
  }

  /**
   * Redeems a refresh token for its successor.
   *
   * The reuse case is the one that matters. A token that has already been rotated being
   * presented again means either an attacker stole it and is racing the real client, or
   * the real client is retrying after a response it never received. We cannot tell the
   * two apart, so we assume theft and revoke the whole family: the legitimate user
   * re-authenticates, which is an annoyance, and the attacker loses the session, which is
   * the point. Silently issuing a new token would let a stolen token live forever.
   */
  async rotate(refreshToken: string): Promise<IssuedSession> {
    const hash = this.tokens.hashRefreshToken(refreshToken);

    // The transaction REPORTS what it found rather than throwing, and the throwing happens
    // after it commits. This is load-bearing, not style: revoking a compromised family
    // from inside a transaction that then throws means the rollback quietly undoes the
    // revocation, and the stolen token keeps working. The rejection and the revocation
    // must not share a fate.
    const outcome = await this.elevated.db.transaction(async (tx): Promise<RotateOutcome> => {
      const [session] = await tx
        .select()
        .from(userSessions)
        .where(eq(userSessions.refreshTokenHash, hash))
        .for('update');

      if (!session) return { kind: 'invalid', reason: 'unknown' };
      if (session.rotatedAt !== null) return { kind: 'reuse', familyId: session.familyId };
      if (session.revokedAt !== null) return { kind: 'invalid', reason: 'revoked' };
      if (session.expiresAt.getTime() <= Date.now()) {
        return { kind: 'invalid', reason: 'expired' };
      }

      await tx
        .update(userSessions)
        .set({ rotatedAt: new Date(), lastUsedAt: new Date() })
        .where(eq(userSessions.id, session.id));

      // The 30-day window slides forward on each use. A farmer who syncs on day 21 of a
      // month in the veld gets another 30 days, which is exactly the intent of the
      // window — it measures silence, not account age. Note that `secondFactorAt` is
      // CARRIED FORWARD, never recomputed: 2FA is required at login, not at every
      // refresh, or reconnecting after a fortnight would demand an authenticator app
      // next to a broken windmill (ADR-0007).
      const issued = await this.insert(
        {
          userId: session.userId,
          familyId: session.familyId,
          activeFarmId: session.activeFarmId,
          deviceLabel: session.deviceLabel,
          secondFactorSatisfied: session.secondFactorAt !== null,
          authenticatedAt: session.authenticatedAt,
          secondFactorAt: session.secondFactorAt,
        },
        tx,
      );

      return { kind: 'ok', session: issued };
    });

    if (outcome.kind === 'reuse') {
      await this.revokeFamily(outcome.familyId, 'reuse-detected');
      throw new SessionInvalidError('reused');
    }
    if (outcome.kind === 'invalid') throw new SessionInvalidError(outcome.reason);

    return outcome.session;
  }

  /** Ends one session. Its family dies with it — logout means logout on this device. */
  async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.elevated.db
      .update(userSessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(userSessions.familyId, familyId), isNull(userSessions.revokedAt)));
  }

  /** Loads a live session by id — used to authorise an access token's `sid`. */
  async findLive(sessionId: string): Promise<typeof userSessions.$inferSelect | undefined> {
    const [session] = await this.elevated.db
      .select()
      .from(userSessions)
      .where(
        and(
          eq(userSessions.id, sessionId),
          isNull(userSessions.revokedAt),
          sql`${userSessions.expiresAt} > now()`,
        ),
      );
    return session;
  }

  /** Points a live session at a different farm — FR-004, without re-authenticating. */
  async setActiveFarm(sessionId: string, farmId: string): Promise<void> {
    await this.elevated.db
      .update(userSessions)
      .set({ activeFarmId: farmId })
      .where(eq(userSessions.id, sessionId));
  }

  private async insert(
    params: {
      userId: string;
      familyId: string;
      activeFarmId: string | null;
      deviceLabel: string | null;
      secondFactorSatisfied: boolean;
      authenticatedAt?: Date;
      secondFactorAt?: Date | null;
    },
    tx?: Parameters<Parameters<ElevatedDb['db']['transaction']>[0]>[0],
  ): Promise<IssuedSession> {
    const db = tx ?? this.elevated.db;
    const refreshToken = this.tokens.generateRefreshToken();
    const now = new Date();
    const refreshExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000);
    const secondFactorAt = params.secondFactorAt ?? (params.secondFactorSatisfied ? now : null);

    const [row] = await db
      .insert(userSessions)
      .values({
        userId: params.userId,
        familyId: params.familyId,
        refreshTokenHash: this.tokens.hashRefreshToken(refreshToken),
        authenticatedAt: params.authenticatedAt ?? now,
        secondFactorAt,
        activeFarmId: params.activeFarmId,
        deviceLabel: params.deviceLabel,
        expiresAt: refreshExpiresAt,
        lastUsedAt: now,
      })
      .returning();

    return {
      sessionId: row!.id,
      familyId: row!.familyId,
      refreshToken,
      refreshExpiresAt,
      activeFarmId: row!.activeFarmId,
      secondFactorAt: row!.secondFactorAt,
    };
  }
}
