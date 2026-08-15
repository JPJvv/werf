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
import { SessionInvalidError, uuidv7 } from '@werf/core';
import { REFRESH_TOKEN_TTL_SECONDS, SECOND_FACTOR_CHALLENGE_TTL_SECONDS } from '../config/config';
import { ELEVATED_DB } from '../db/db.module';
import { type AuthAuditContext, type AuthAuditEntry, writeAuthAudit } from './auth-audit';
import { TokenService } from './token.service';

/**
 * Unexpired AND past its second factor. Both halves are what "live" means: a session that
 * has only cleared the password is not one a request may act on.
 */
const isLive = () =>
  sql`${userSessions.expiresAt} > now() and ${userSessions.secondFactorAt} is not null`;

/** What the rotation transaction found. Reported, not thrown — see `rotate`. */
type RotateOutcome =
  | { kind: 'ok'; session: IssuedSession }
  | {
      kind: 'reuse';
      familyId: string;
      sessionId: string;
      userId: string;
      activeFarmId: string | null;
    }
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

type IssuedSessionAudit = Omit<AuthAuditEntry, 'sessionId' | 'sessionFamilyId'>;

@Injectable()
export class SessionService {
  constructor(
    @Inject(ELEVATED_DB) private readonly elevated: ElevatedDb,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  /** Starts a NEW rotation family. This is a login, not a refresh. */
  async issue(
    params: {
      userId: string;
      activeFarmId: string | null;
      deviceLabel: string | null;
      secondFactorSatisfied: boolean;
    },
    audit?: IssuedSessionAudit,
  ): Promise<IssuedSession> {
    // v7, like every other id we store: the family index stays dense (db.md).
    const familyId = uuidv7();
    const insert = (tx?: Parameters<Parameters<ElevatedDb['db']['transaction']>[0]>[0]) =>
      this.insert({ ...params, familyId }, tx, audit);
    return audit ? this.elevated.db.transaction(insert) : insert();
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
  async rotate(refreshToken: string, context: AuthAuditContext = {}): Promise<IssuedSession> {
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
      if (session.rotatedAt !== null) {
        return {
          kind: 'reuse',
          familyId: session.familyId,
          sessionId: session.id,
          userId: session.userId,
          activeFarmId: session.activeFarmId,
        };
      }
      if (session.revokedAt !== null) return { kind: 'invalid', reason: 'revoked' };
      if (session.expiresAt.getTime() <= Date.now()) {
        return { kind: 'invalid', reason: 'expired' };
      }

      // A half-authenticated session must never be redeemable here. The challenge token
      // handed to a caller who has passed only the password IS a refresh token; without
      // this check, presenting it to /auth/refresh returns a full access token and walks
      // straight around the second factor. "2FA at login, not at every refresh" (ADR-0007)
      // only holds if login is the step that cannot be skipped. Reported as 'unknown' so
      // the response cannot distinguish it from a token that never existed.
      if (session.secondFactorAt === null) return { kind: 'invalid', reason: 'unknown' };

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
      await this.revokeFamily(outcome.familyId, 'reuse-detected', {
        event: 'session_reuse',
        outcome: 'failure',
        subjectUserId: outcome.userId,
        farmId: outcome.activeFarmId,
        sessionId: outcome.sessionId,
        sessionFamilyId: outcome.familyId,
        ...context,
        metadata: { reason: 'refresh_token_reuse' },
      });
      throw new SessionInvalidError('reused');
    }
    if (outcome.kind === 'invalid') throw new SessionInvalidError(outcome.reason);

    return outcome.session;
  }

  /** Ends one session. Its family dies with it — logout means logout on this device. */
  async revokeFamily(familyId: string, reason: string, audit?: AuthAuditEntry): Promise<void> {
    await this.elevated.db.transaction(async (tx) => {
      const revoked = await tx
        .update(userSessions)
        .set({ revokedAt: new Date(), revokedReason: reason })
        .where(and(eq(userSessions.familyId, familyId), isNull(userSessions.revokedAt)))
        .returning({ id: userSessions.id });

      // Idempotent logout/revocation must not manufacture duplicate evidence on retries.
      if (audit && revoked.length > 0) await writeAuthAudit(tx, audit);
    });
  }

  /**
   * Loads a FULLY authenticated session by id — used to authorise an access token's `sid`.
   *
   * `second_factor_at IS NOT NULL` is part of "live". A session that has passed the
   * password but still owes a second factor is not a session yet, and must not authorise
   * anything; see the note on `rotate`.
   */
  async findLive(sessionId: string): Promise<typeof userSessions.$inferSelect | undefined> {
    const [session] = await this.elevated.db
      .select()
      .from(userSessions)
      .where(and(eq(userSessions.id, sessionId), isNull(userSessions.revokedAt), isLive()));
    return session;
  }

  /**
   * Loads a half-authenticated session by its challenge token — the ONLY thing that may
   * act on one. The 2FA verification step uses this; nothing else should.
   */
  async findPendingSecondFactor(
    challengeToken: string,
  ): Promise<typeof userSessions.$inferSelect | undefined> {
    const [session] = await this.elevated.db
      .select()
      .from(userSessions)
      .where(
        and(
          eq(userSessions.refreshTokenHash, this.tokens.hashRefreshToken(challengeToken)),
          isNull(userSessions.revokedAt),
          isNull(userSessions.rotatedAt),
          isNull(userSessions.secondFactorAt),
          sql`${userSessions.expiresAt} > now()`,
        ),
      );
    return session;
  }

  /**
   * Points a live session at a different farm — FR-004, without re-authenticating.
   *
   * The predicate binds the session to `userId` and requires it to still be live. The
   * caller authorises membership before calling, but this write runs elevated, and an
   * elevated write whose only protection is the discipline of its callers is one refactor
   * away from being a cross-tenant hijack of somebody else's session.
   */
  async setActiveFarm(
    sessionId: string,
    userId: string,
    farmId: string,
    context: AuthAuditContext = {},
  ): Promise<void> {
    await this.elevated.db.transaction(async (tx) => {
      const predicate = and(
        eq(userSessions.id, sessionId),
        eq(userSessions.userId, userId),
        isNull(userSessions.revokedAt),
        isLive(),
      );
      const [session] = await tx
        .select({
          activeFarmId: userSessions.activeFarmId,
          familyId: userSessions.familyId,
        })
        .from(userSessions)
        .where(predicate)
        .for('update');
      if (!session) return;

      await tx.update(userSessions).set({ activeFarmId: farmId }).where(predicate);
      await writeAuthAudit(tx, {
        event: 'farm_switch',
        outcome: 'success',
        actorUserId: userId,
        subjectUserId: userId,
        farmId,
        sessionId,
        sessionFamilyId: session.familyId,
        ...context,
        metadata: { fromFarmId: session.activeFarmId },
      });
    });
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
    audit?: IssuedSessionAudit,
  ): Promise<IssuedSession> {
    const db = tx ?? this.elevated.db;
    const refreshToken = this.tokens.generateRefreshToken();
    const now = new Date();
    const secondFactorAt = params.secondFactorAt ?? (params.secondFactorSatisfied ? now : null);

    // A row that still owes a second factor is a CHALLENGE, not a session, and it gets
    // minutes rather than the 30-day offline window. The two are the same shape in this
    // table — the challenge token handed to a half-authenticated caller is literally a
    // refresh token — so without this branch a password-only artefact would stay live for
    // a month (ADR-0007).
    const ttlSeconds =
      secondFactorAt === null ? SECOND_FACTOR_CHALLENGE_TTL_SECONDS : REFRESH_TOKEN_TTL_SECONDS;
    const refreshExpiresAt = new Date(now.getTime() + ttlSeconds * 1000);

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

    if (audit) {
      await writeAuthAudit(db, {
        ...audit,
        sessionId: row!.id,
        sessionFamilyId: row!.familyId,
      });
    }

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
