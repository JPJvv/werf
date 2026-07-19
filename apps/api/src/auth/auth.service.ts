/**
 * Registration and authentication (FR-001, FR-002, ADR-0007).
 */

import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import {
  businesses,
  enterprises,
  farmUsers,
  farms,
  userSessions,
  users,
  type AppDb,
  type ElevatedDb,
} from '@werf/db';
import { ConflictError, InvalidCredentialsError, schemas } from '@werf/core';
import { ACCESS_TOKEN_TTL_SECONDS } from '../config/config';
import { APP_DB, ELEVATED_DB } from '../db/db.module';
import { SessionService, type IssuedSession } from './session.service';
import { TokenService } from './token.service';
import { TwoFactorService } from './two-factor.service';

/**
 * A human-readable default name for the enterprise row each chosen type creates. The farmer
 * renames these; the point is that a farm is never left with zero enterprises to attribute
 * costs to (ADR-0004).
 */
const ENTERPRISE_DEFAULT_NAMES: Record<string, string> = {
  beef_cattle: 'Beef cattle',
  dairy: 'Dairy herd',
  sheep: 'Sheep flock',
  goats: 'Goat herd',
  pigs: 'Pigs',
  poultry: 'Poultry',
  game: 'Game',
  row_crops: 'Row crops',
  vegetables: 'Vegetables',
  orchards: 'Orchard',
  vineyards: 'Vineyard',
  other: 'Other',
};

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_DB) private readonly app: AppDb,
    @Inject(ELEVATED_DB) private readonly elevated: ElevatedDb,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(TwoFactorService) private readonly twoFactor: TwoFactorService,
  ) {}

  /**
   * Creates a whole tenant: business, first farm, its enterprises, and the owner, in ONE
   * transaction. Every intermediate state is invalid — a business with no farm has no
   * jurisdiction, a farm with no owner is a farm nobody can log into — so a partial
   * failure must leave nothing behind.
   *
   * This is the canonical elevated-path operation: the rows precede the membership that
   * RLS scopes by, so there is no user whose farms could authorise it. The transaction is
   * the boundary; after this call, everything about this tenant goes through `AppDb`.
   *
   * IDs come from the database's `uuid_generate_v7()` rather than the client. That is not
   * a break with client-generated IDs — registration is the one inherently ONLINE
   * operation in the product (there is no offline account to write into), so the reason
   * for client IDs, that the client cannot reach a server, does not apply.
   */
  async register(input: schemas.RegisterRequest): Promise<schemas.AuthSession> {
    const passwordHash = await this.tokens.hashPassword(input.owner.password);

    const created = await this.elevated.db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.owner.email));
      if (existing.length > 0) {
        throw new ConflictError('That email address is already registered');
      }

      const [business] = await tx
        .insert(businesses)
        .values({
          name: input.business.name,
          registrationNumber: input.business.registrationNumber,
        })
        .returning();

      const [farm] = await tx
        .insert(farms)
        .values({
          businessId: business!.id,
          name: input.farm.name,
          province: input.farm.province,
          district: input.farm.district,
          enterpriseTypes: input.farm.enterpriseTypes,
          // jurisdiction and timezone take their column defaults ('ZA',
          // 'Africa/Johannesburg'). Jurisdiction comes from the FARM and is never
          // accepted from the request — a caller must not be able to choose the law
          // their payroll is computed under.
        })
        .returning();

      const [owner] = await tx
        .insert(users)
        .values({
          email: input.owner.email,
          fullName: input.owner.fullName,
          passwordHash,
          locale: input.owner.locale,
          theme: input.owner.theme,
        })
        .returning();

      await tx.insert(farmUsers).values({
        farmId: farm!.id,
        userId: owner!.id,
        role: 'owner',
        // Accepted on the spot: consent is not in question when you are inviting yourself.
        // Only rows with `accepted_at` count towards `app_user_farm_ids()`, so omitting
        // this would leave the founder locked out of the farm they just created.
        acceptedAt: new Date(),
      });

      await tx.insert(enterprises).values(
        input.farm.enterpriseTypes.map((type) => ({
          farmId: farm!.id,
          name: ENTERPRISE_DEFAULT_NAMES[type] ?? type,
          type,
        })),
      );

      return { userId: owner!.id, farmId: farm!.id };
    });

    // 2FA enrolment happens after registration, in the office, online — a passkey cannot
    // be registered without a network round trip (ADR-0007). So the first session is
    // fully authenticated; enforcing mandatory 2FA for owners arrives with enrolment.
    const session = await this.sessions.issue({
      userId: created.userId,
      activeFarmId: created.farmId,
      deviceLabel: null,
      secondFactorSatisfied: true,
    });

    return this.buildAuthSession(created.userId, session);
  }

  /**
   * Authenticates the first factor.
   *
   * Every failure path returns the same error and takes broadly the same time: an unknown
   * email still costs a password verification against a dummy hash, because an endpoint
   * that answers faster for non-existent accounts tells an attacker exactly which farmers
   * bank with us.
   */
  async login(input: schemas.LoginRequest): Promise<schemas.LoginResponse> {
    const [user] = await this.elevated.db
      .select()
      .from(users)
      .where(and(eq(users.email, input.email), isNull(users.deletedAt)));

    if (!user?.passwordHash) {
      await this.tokens.verifyPassword(await dummyHash(this.tokens), input.password);
      throw new InvalidCredentialsError();
    }

    const ok = await this.tokens.verifyPassword(user.passwordHash, input.password);
    if (!ok) throw new InvalidCredentialsError();

    const memberships = await this.loadFarms(user.id);
    const session = await this.sessions.issue({
      userId: user.id,
      activeFarmId: memberships[0]?.id ?? null,
      deviceLabel: input.deviceLabel,
      // A second factor is owed only if one is actually enrolled. An account that has
      // none cannot be asked for one — that is a lockout, not a security control. The
      // rule that owners and bookkeepers must ENROL is enforced after login, by the
      // guard, which confines them to the enrolment routes until they do (FR-014).
      secondFactorSatisfied: user.totpEnrolledAt === null,
    });

    if (session.secondFactorAt === null) {
      return {
        secondFactorRequired: true,
        challengeToken: session.refreshToken,
        // Recovery codes are offered alongside TOTP because the case they exist for —
        // the phone with the authenticator on it is at the bottom of a dam — is exactly
        // the case where this list is the only thing the farmer can act on (FR-014a).
        methods: ['totp', 'recovery_code'],
      };
    }

    return this.buildAuthSession(user.id, session, memberships);
  }

  /** Redeems a refresh token. No second factor is re-demanded here — ADR-0007. */
  async refresh(refreshToken: string): Promise<schemas.AuthSession> {
    const session = await this.sessions.rotate(refreshToken);
    return this.buildAuthSession(await this.userIdForSession(session), session);
  }

  async logout(refreshToken: string): Promise<void> {
    const hash = this.tokens.hashRefreshToken(refreshToken);
    const [session] = await this.elevated.db
      .select({ familyId: userSessions.familyId })
      .from(userSessions)
      .where(eq(userSessions.refreshTokenHash, hash));

    // Logging out with an already-dead token is not an error — it is the state the caller
    // wanted. Reporting a failure here just teaches clients to ignore the response.
    if (session) await this.sessions.revokeFamily(session.familyId, 'logout');
  }

  private async userIdForSession(session: IssuedSession): Promise<string> {
    const live = await this.sessions.findLive(session.sessionId);
    return live!.userId;
  }

  private async buildAuthSession(
    userId: string,
    session: IssuedSession,
    knownFarms?: schemas.SessionFarm[],
  ): Promise<schemas.AuthSession> {
    const [user] = await this.elevated.db.select().from(users).where(eq(users.id, userId));
    const memberships = knownFarms ?? (await this.loadFarms(userId));

    const accessToken = await this.tokens.signAccessToken({
      sub: userId,
      sid: session.sessionId,
      farm: session.activeFarmId,
    });

    return {
      accessToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: session.refreshToken,
      refreshExpiresAt: session.refreshExpiresAt.toISOString(),
      user: {
        id: user!.id,
        email: user!.email,
        phone: user!.phone,
        fullName: user!.fullName,
        locale: user!.locale as schemas.AuthSession['user']['locale'],
        theme: user!.theme as schemas.AuthSession['user']['theme'],
        createdAt: user!.createdAt,
        updatedAt: user!.updatedAt,
        deletedAt: user!.deletedAt,
      },
      farms: memberships,
      activeFarmId: session.activeFarmId,
      secondFactor: await this.twoFactor.statusFor(userId),
    };
  }

  /**
   * Completes a login that stopped at the second factor, returning the real session.
   * The half-authenticated challenge is spent inside `verifySecondFactor`.
   */
  async verifySecondFactor(input: schemas.VerifySecondFactorRequest): Promise<schemas.AuthSession> {
    const { userId, session } = await this.twoFactor.verifySecondFactor(input);
    return this.buildAuthSession(userId, session);
  }

  /**
   * The farms this user may act on, with the role they hold on each (roles are per FARM).
   *
   * Runs on the SCOPED connection even though the user id is already known and the WHERE
   * clause would be correct on its own. Post-authentication reads have no claim on the
   * elevated path, and going through RLS means a mistake in this query returns too little
   * rather than another tenant's farms. It also means pending invitations are excluded for
   * free: `app_user_farm_ids()` ignores them, so an invitation the user has not accepted
   * cannot show up in their session as a farm they own.
   */
  private async loadFarms(userId: string): Promise<schemas.SessionFarm[]> {
    return this.app.asUser(userId, async (tx) =>
      tx
        .select({
          id: farms.id,
          name: farms.name,
          enterpriseTypes: farms.enterpriseTypes,
          role: farmUsers.role,
        })
        .from(farmUsers)
        .innerJoin(farms, eq(farms.id, farmUsers.farmId))
        .where(and(eq(farmUsers.userId, userId), isNull(farmUsers.deletedAt))),
    );
  }
}

/**
 * A real argon2id hash of a value nobody knows, used to spend the same CPU on a login for
 * an address that has no account. Without it, "no such user" returns in a millisecond and
 * "wrong password" takes fifty — a timing difference that enumerates our customers.
 *
 * Computed once, lazily, from random bytes. Hard-coding a literal here would be quietly
 * useless: a malformed hash makes argon2 throw immediately, `verifyPassword` swallows it,
 * and the timing equalisation this exists for silently stops happening.
 */
let dummyHashPromise: Promise<string> | undefined;

function dummyHash(tokens: TokenService): Promise<string> {
  dummyHashPromise ??= tokens.hashPassword(randomBytes(32).toString('base64url'));
  return dummyHashPromise;
}
