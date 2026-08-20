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
import {
  ConflictError,
  InvalidCredentialsError,
  NotFoundError,
  SessionInvalidError,
  schemas,
} from '@werf/core';
import { ACCESS_TOKEN_TTL_SECONDS } from '../config/config';
import { APP_DB, ELEVATED_DB } from '../db/db.module';
import { enterprisesByFarm } from '../common/session-farm';
import { type AuthAuditContext, writeAuthAudit } from './auth-audit';
import { SessionService, type IssuedSession } from './session.service';
import { TokenService } from './token.service';
import { TwoFactorService } from './two-factor.service';
import { PasskeyService } from './passkey.service';

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
    @Inject(PasskeyService) private readonly passkeys: PasskeyService,
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
      // An address may already have a row for a reason that is NOT "someone registered
      // it": `FarmsService.invite` writes a user row for the invitee so the pending
      // membership has something to point at, and that row has no password. Because
      // `users.email` is UNIQUE and no invitation is actually delivered yet, treating
      // every existing row as a conflict means any owner can name a stranger's address
      // and permanently bar that person from ever signing up — a denial of service one
      // API call wide, aimed at anyone, with no notice to the victim.
      //
      // So a password-less, undeleted row is CLAIMED by the person who proves they want
      // it. This grants nothing: any pending invitations on that row stay pending, and
      // acceptance is still the invitee's own act. A row with a password is a real
      // account and still conflicts; a soft-deleted one is not resurrected by a stranger.
      const [existing] = await tx.select().from(users).where(eq(users.email, input.owner.email));
      if (existing && (existing.passwordHash !== null || existing.deletedAt !== null)) {
        throw new ConflictError('That email address is already registered');
      }

      const [business] = await tx
        .insert(businesses)
        .values({
          name: input.business.name,
          registrationNumber: input.business.registrationNumber,
          contactEmail: input.business.contact.email,
          contactPhone: input.business.contact.phone,
          physicalAddressLine1: input.business.physicalAddress.line1,
          physicalAddressLine2: input.business.physicalAddress.line2,
          physicalAddressLocality: input.business.physicalAddress.locality,
          physicalAddressProvince: input.business.physicalAddress.province,
          physicalAddressPostalCode: input.business.physicalAddress.postalCode,
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

      // Claim the invited shell if there is one, otherwise create the account. Either way
      // the details are the REGISTRANT's, not the inviter's guess at their name.
      const [owner] = existing
        ? await tx
            .update(users)
            .set({
              fullName: input.owner.fullName,
              passwordHash,
              locale: input.owner.locale,
              theme: input.owner.theme,
              updatedAt: new Date(),
            })
            .where(and(eq(users.id, existing.id), isNull(users.passwordHash)))
            .returning()
        : await tx
            .insert(users)
            .values({
              email: input.owner.email,
              fullName: input.owner.fullName,
              passwordHash,
              locale: input.owner.locale,
              theme: input.owner.theme,
            })
            .returning();

      // The `IS NULL` in that predicate is the race guard: two registrations for the same
      // invited address both read a password-less row, and only one may win. The loser
      // updates nothing and is told the address is taken, which by then it is.
      if (!owner) throw new ConflictError('That email address is already registered');

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
  async login(
    input: schemas.LoginRequest,
    context: AuthAuditContext = {},
  ): Promise<schemas.LoginResponse> {
    const [user] = await this.elevated.db
      .select()
      .from(users)
      .where(and(eq(users.email, input.email), isNull(users.deletedAt)));

    if (!user?.passwordHash) {
      await this.tokens.verifyPassword(await dummyHash(this.tokens), input.password);
      await writeAuthAudit(this.elevated.db, {
        event: 'login',
        outcome: 'failure',
        ...context,
        metadata: { reason: 'invalid_credentials', method: 'password' },
      });
      throw new InvalidCredentialsError();
    }

    const ok = await this.tokens.verifyPassword(user.passwordHash, input.password);
    if (!ok) {
      await writeAuthAudit(this.elevated.db, {
        event: 'login',
        outcome: 'failure',
        subjectUserId: user.id,
        ...context,
        metadata: { reason: 'invalid_credentials', method: 'password' },
      });
      throw new InvalidCredentialsError();
    }

    const memberships = await this.loadFarms(user.id);

    // What this account can actually present. Passkeys FIRST: ADR-0007 prefers them, and
    // the order is what the client offers the farmer — a fingerprint before six digits.
    const methods: schemas.SecondFactorRequired['methods'] = [];
    if (await this.passkeys.hasPasskey(user.id)) methods.push('passkey');
    if (user.totpEnrolledAt !== null) methods.push('totp');
    // Recovery codes ride along with any enrolled factor, because the case they exist for
    // — the phone holding both the passkey and the authenticator is at the bottom of a
    // dam — is exactly the case where this is the only line left (FR-014a).
    if (methods.length > 0) methods.push('recovery_code');

    const activeFarmId = memberships[0]?.id ?? null;
    const secondFactorSatisfied = methods.length === 0;
    const session = await this.sessions.issue(
      {
        userId: user.id,
        activeFarmId,
        deviceLabel: input.deviceLabel,
        // A second factor is owed only if one is actually enrolled. An account that has
        // none cannot be asked for one — that is a lockout, not a security control. The
        // rule that owners and bookkeepers must ENROL is enforced after login, by the
        // guard, which confines them to the enrolment routes until they do (FR-014).
        secondFactorSatisfied,
      },
      {
        event: 'login',
        outcome: secondFactorSatisfied ? 'success' : 'challenge',
        ...(secondFactorSatisfied ? { actorUserId: user.id } : {}),
        subjectUserId: user.id,
        farmId: activeFarmId,
        ...context,
        metadata: secondFactorSatisfied
          ? { method: 'password' }
          : { method: 'password', reason: 'second_factor_required' },
      },
    );

    if (session.secondFactorAt === null) {
      return {
        secondFactorRequired: true,
        challengeToken: session.refreshToken,
        methods: methods as schemas.SecondFactorRequired['methods'],
      };
    }

    return this.buildAuthSession(user.id, session, memberships);
  }

  /** Redeems a refresh token. No second factor is re-demanded here — ADR-0007. */
  async refresh(
    refreshToken: string,
    context: AuthAuditContext = {},
  ): Promise<schemas.AuthSession> {
    const session = await this.sessions.rotate(refreshToken, context);
    return this.buildAuthSession(await this.userIdForSession(session), session);
  }

  async logout(refreshToken: string, context: AuthAuditContext = {}): Promise<void> {
    const hash = this.tokens.hashRefreshToken(refreshToken);
    const [session] = await this.elevated.db
      .select({
        id: userSessions.id,
        familyId: userSessions.familyId,
        userId: userSessions.userId,
        activeFarmId: userSessions.activeFarmId,
      })
      .from(userSessions)
      .where(eq(userSessions.refreshTokenHash, hash));

    // Logging out with an already-dead token is not an error — it is the state the caller
    // wanted. Reporting a failure here just teaches clients to ignore the response.
    if (session) {
      await this.sessions.revokeFamily(session.familyId, 'logout', {
        event: 'logout',
        outcome: 'success',
        actorUserId: session.userId,
        subjectUserId: session.userId,
        farmId: session.activeFarmId,
        sessionId: session.id,
        sessionFamilyId: session.familyId,
        ...context,
        metadata: { reason: 'user_requested' },
      });
    }
  }

  /**
   * Updates the signed-in account's own preferences (FR-008) and returns the account as the client
   * should now hold it.
   *
   * The user id comes from the verified access token, never from the body, so this cannot be aimed
   * at another account. It returns the PUBLIC user projection — the same one a session carries, with
   * no password hash and no TOTP secret — because the client patches its cached session with this
   * and the cache is a file on a phone that may be stolen.
   *
   * Why this endpoint exists at all: language belongs to the person, not the device. Without a
   * write-back a farmer who switched to Afrikaans in Settings was switched back to English on the
   * next cold start, because the boot path re-adopts the account's stored locale. The setting looked
   * like it worked and then silently did not, which is worse than not offering it.
   */
  async updateProfile(
    userId: string,
    input: schemas.UpdateProfileRequest,
  ): Promise<schemas.AuthSession['user']> {
    const [updated] = await this.elevated.db
      .update(users)
      .set({ locale: input.locale, updatedAt: new Date() })
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .returning();

    if (!updated) throw new NotFoundError('Account not found');
    return publicUser(updated);
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
      user: publicUser(user!),
      farms: memberships,
      activeFarmId: session.activeFarmId,
      secondFactor: await this.twoFactor.statusFor(userId),
    };
  }

  /**
   * Completes a login that stopped at the second factor, returning the real session.
   * The half-authenticated challenge is spent inside `verifySecondFactor`.
   */
  async verifySecondFactor(
    input: schemas.VerifySecondFactorRequest,
    context: AuthAuditContext = {},
  ): Promise<schemas.AuthSession> {
    try {
      const { userId, session } = await this.twoFactor.verifySecondFactor(input, context);
      return this.buildAuthSession(userId, session);
    } catch (error) {
      if (error instanceof InvalidCredentialsError || error instanceof SessionInvalidError) {
        await writeAuthAudit(this.elevated.db, {
          event: 'login',
          outcome: 'failure',
          ...context,
          metadata: { reason: 'invalid_second_factor', method: input.method },
        });
      }
      throw error;
    }
  }

  /** The same, satisfied with a passkey instead of a typed code (ADR-0007). */
  async verifyPasskey(
    input: schemas.PasskeyAuthenticationRequest,
    context: AuthAuditContext = {},
  ): Promise<schemas.AuthSession> {
    try {
      const { userId, session } = await this.passkeys.verifySecondFactor(input, context);
      return this.buildAuthSession(userId, session);
    } catch (error) {
      if (error instanceof InvalidCredentialsError || error instanceof SessionInvalidError) {
        await writeAuthAudit(this.elevated.db, {
          event: 'login',
          outcome: 'failure',
          ...context,
          metadata: { reason: 'invalid_second_factor', method: 'passkey' },
        });
      }
      throw error;
    }
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
    return this.app.asUser(userId, async (tx) => {
      const rows = await tx
        .select({
          id: farms.id,
          businessId: farms.businessId,
          name: farms.name,
          enterpriseTypes: farms.enterpriseTypes,
          eventRetentionMonths: farms.eventRetentionMonths,
          restPeriodDays: farms.restPeriodDays,
          role: farmUsers.role,
        })
        .from(farmUsers)
        .innerJoin(farms, eq(farms.id, farmUsers.farmId))
        .where(and(eq(farmUsers.userId, userId), isNull(farmUsers.deletedAt)));

      // The farm's herds travel with the session because a capture must file itself under one
      // OFFLINE (FR-113), and a device in a dead zone cannot ask for the list at capture time.
      const herds = await enterprisesByFarm(
        tx,
        rows.map((farm) => farm.id),
      );
      return rows.map((farm) => ({ ...farm, enterprises: herds.get(farm.id) ?? [] }));
    });
  }
}

/**
 * The account as a client may hold it. Field-by-field on purpose: the users row also carries the
 * password hash and the encrypted TOTP secret, and those must never leave the server — a cached
 * session is a file on a phone that can be stolen (.claude/rules/db.md). Spreading the row and
 * deleting keys would leave a column added in a later migration exposed by default; this way a new
 * column is invisible until someone deliberately adds it here.
 */
function publicUser(row: typeof users.$inferSelect): schemas.AuthSession['user'] {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    fullName: row.fullName,
    locale: row.locale as schemas.AuthSession['user']['locale'],
    theme: row.theme as schemas.AuthSession['user']['theme'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
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
