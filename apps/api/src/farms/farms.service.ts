/**
 * Farm management: more farms under a business, changing enterprises, inviting people,
 * and switching the active farm (FR-003, FR-004, FR-005).
 *
 * Read the privilege choices here carefully. Most operations go through `AppDb.asUser`,
 * where RLS is doing the tenancy enforcement and a bug in this file still cannot reach
 * another farm's rows. Two operations cannot: creating a farm and inviting a user both
 * write rows that PRECEDE the membership RLS scopes by, so they would fail their own
 * WITH CHECK. Those use the elevated path — and each one authorises the caller through
 * the scoped connection FIRST, so the elevated write is only ever reached by someone RLS
 * already agreed is an owner.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { enterprises, farmUsers, farms, users, type AppDb, type ElevatedDb } from '@werf/db';
import { ConflictError, NotFoundError, TenancyError, schemas } from '@werf/core';
import type { EnterpriseType } from '@werf/core';
import { APP_DB, ELEVATED_DB } from '../db/db.module';
import { enterprisesByFarm } from '../common/session-farm';
import { SessionService } from '../auth/session.service';

/** Default names for the enterprise row each chosen type creates. The farmer renames them. */
const ENTERPRISE_DEFAULT_NAMES: Record<EnterpriseType, string> = {
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
export class FarmsService {
  constructor(
    @Inject(APP_DB) private readonly app: AppDb,
    @Inject(ELEVATED_DB) private readonly elevated: ElevatedDb,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  /** The farms the caller may act on, with their per-farm role. */
  async listForUser(userId: string): Promise<schemas.SessionFarm[]> {
    return this.app.asUser(userId, async (tx) => {
      const rows = await tx
        .select({
          id: farms.id,
          name: farms.name,
          enterpriseTypes: farms.enterpriseTypes,
          role: farmUsers.role,
        })
        .from(farmUsers)
        .innerJoin(farms, eq(farms.id, farmUsers.farmId))
        .where(and(eq(farmUsers.userId, userId), isNull(farmUsers.deletedAt)));

      // The farm's herds, so a capture can file itself under one offline (FR-113).
      const herds = await enterprisesByFarm(
        tx,
        rows.map((farm) => farm.id),
      );
      return rows.map((farm) => ({ ...farm, enterprises: herds.get(farm.id) ?? [] }));
    });
  }

  /**
   * Adds a farm to a business the caller already owns (FR-004).
   *
   * The ownership check runs on the SCOPED connection: it can only see farms the caller is
   * a member of, so "is there a farm of this business I own?" cannot be answered `yes` by
   * a business the caller has nothing to do with. Only after that does the elevated insert
   * happen — necessary because the new farm has no members yet and would fail farms'
   * WITH CHECK against its own row.
   */
  async createFarm(userId: string, input: schemas.CreateFarmRequest): Promise<schemas.SessionFarm> {
    await this.assertOwnsBusiness(userId, input.businessId);

    return this.elevated.db.transaction(async (tx) => {
      const [farm] = await tx
        .insert(farms)
        .values({
          businessId: input.businessId,
          name: input.name,
          province: input.province,
          district: input.district,
          enterpriseTypes: input.enterpriseTypes,
        })
        .returning();

      await tx.insert(farmUsers).values({
        farmId: farm!.id,
        userId,
        role: 'owner',
        // Self-created, so accepted immediately — see the note in AuthService.register.
        acceptedAt: new Date(),
      });

      const created = await tx
        .insert(enterprises)
        .values(
          input.enterpriseTypes.map((type) => ({
            farmId: farm!.id,
            name: ENTERPRISE_DEFAULT_NAMES[type],
            type,
          })),
        )
        .returning({ id: enterprises.id, name: enterprises.name, type: enterprises.type });

      return {
        id: farm!.id,
        name: farm!.name,
        enterpriseTypes: farm!.enterpriseTypes,
        enterprises: created,
        role: 'owner',
      };
    });
  }

  /**
   * Adds and/or removes enterprise types (FR-002, FR-003).
   *
   * Additive in both directions, which is the requirement people misread. Adding needs no
   * migration — the types are an array column and each new one gets an enterprise row.
   * Removing does NOT delete anything: the type leaves the farm's list so the UI stops
   * offering it, and its enterprises are marked inactive. Last season's maize costs must
   * still exist after the farmer stops growing maize, or every historical report silently
   * changes shape.
   */
  async updateEnterpriseTypes(
    userId: string,
    farmId: string,
    input: schemas.UpdateEnterpriseTypesRequest,
  ): Promise<schemas.SessionFarm> {
    return this.app.asUser(userId, async (tx) => {
      const [farm] = await tx.select().from(farms).where(eq(farms.id, farmId));
      // RLS already filtered this to the caller's farms, so "not visible" and "does not
      // exist" arrive here as the same thing — which is the answer we want to give.
      if (!farm) throw new NotFoundError('Farm not found');

      await this.assertRole(tx, userId, farmId, ['owner']);

      const current = new Set(farm.enterpriseTypes);
      for (const type of input.remove) current.delete(type);
      for (const type of input.add) current.add(type);

      if (current.size === 0) {
        throw new ConflictError('A farm must run at least one enterprise type');
      }

      const next = [...current];
      const [updated] = await tx
        .update(farms)
        .set({ enterpriseTypes: next, updatedAt: new Date() })
        .where(eq(farms.id, farmId))
        .returning();

      // Retire, never delete — the tombstone rule's whole purpose is that history survives.
      if (input.remove.length > 0) {
        await tx
          .update(enterprises)
          .set({ active: false, updatedAt: new Date() })
          .where(and(eq(enterprises.farmId, farmId), inArray(enterprises.type, input.remove)));
      }

      // Re-activate rather than duplicate: a farmer who drops maize and picks it up again
      // next season should get their maize enterprise back, not a second one.
      for (const type of input.add) {
        const existing = await tx
          .select()
          .from(enterprises)
          .where(and(eq(enterprises.farmId, farmId), eq(enterprises.type, type)));

        if (existing.length > 0) {
          await tx
            .update(enterprises)
            .set({ active: true, updatedAt: new Date() })
            .where(and(eq(enterprises.farmId, farmId), eq(enterprises.type, type)));
        } else {
          await tx.insert(enterprises).values({
            farmId,
            name: ENTERPRISE_DEFAULT_NAMES[type],
            type,
          });
        }
      }

      const [role] = await tx
        .select({ role: farmUsers.role })
        .from(farmUsers)
        .where(and(eq(farmUsers.farmId, farmId), eq(farmUsers.userId, userId)));

      // Re-read rather than reason about what was just added or retired: this is the list the
      // client will file captures against (FR-113), so it has to be what the table actually says.
      const herds = await enterprisesByFarm(tx, [farmId]);

      return {
        id: updated!.id,
        name: updated!.name,
        enterpriseTypes: updated!.enterpriseTypes,
        enterprises: herds.get(farmId) ?? [],
        role: role!.role,
      };
    });
  }

  /**
   * Invites someone to a farm with a per-farm role (FR-005).
   *
   * Elevated for the same structural reason as farm creation: the invitee's user row and
   * their membership do not exist yet, so there is no membership for RLS to permit them
   * by. The caller's ownership is established through the scoped connection first.
   *
   * Two things this deliberately does NOT do:
   *
   * 1. It does not grant anything. The membership is written `pending` — `invited_at` set,
   *    `accepted_at` null — and `app_user_farm_ids()` ignores pending rows. An invitation
   *    is a request. Granting on send would mean any owner could name an email address and
   *    thereby acquire that person's name, phone and locale through the `users` RLS policy
   *    (and onto their device, since `users` syncs). Consent has to come from the invitee.
   * 2. It does not report whether the address already had an account. The response is the
   *    same either way, because a differing response is a membership oracle: try an
   *    address, read the answer, learn who banks with us.
   */
  async invite(
    userId: string,
    farmId: string,
    input: schemas.InviteUserRequest,
  ): Promise<{ status: 'pending'; role: string }> {
    await this.assertMembership(userId, farmId, ['owner']);

    return this.elevated.db.transaction(async (tx) => {
      const existing = input.email
        ? await tx.select().from(users).where(eq(users.email, input.email))
        : await tx.select().from(users).where(eq(users.phone, input.phone!));

      // Someone may already have an account from another farm — the same person managing
      // two neighbours' farms is normal. Reuse the identity; the ROLE is what is per-farm.
      const invitee =
        existing[0] ??
        (
          await tx
            .insert(users)
            .values({
              email: input.email,
              phone: input.phone,
              fullName: input.fullName,
              // No password. The invitee sets one when they accept; an invited account
              // that cannot be logged into yet is the correct intermediate state.
            })
            .returning()
        )[0]!;

      const [priorMembership] = await tx
        .select()
        .from(farmUsers)
        .where(and(eq(farmUsers.farmId, farmId), eq(farmUsers.userId, invitee.id)));

      if (priorMembership) {
        // A live membership (accepted, or still pending) is a genuine conflict. A
        // TOMBSTONED one is not: someone who left the farm must be able to come back, and
        // the unique constraint on (farm_id, user_id) means the row has to be revived
        // rather than re-inserted.
        if (priorMembership.deletedAt === null) {
          throw new ConflictError('That person is already on this farm');
        }

        await tx
          .update(farmUsers)
          .set({
            role: input.role,
            deletedAt: null,
            invitedAt: new Date(),
            // Re-invitation starts the consent over. Reviving straight to accepted would
            // let a removal-and-re-add silently reinstate access the person never re-agreed to.
            acceptedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(farmUsers.id, priorMembership.id));

        return { status: 'pending' as const, role: input.role };
      }

      await tx.insert(farmUsers).values({
        farmId,
        userId: invitee.id,
        role: input.role,
        invitedAt: new Date(),
        acceptedAt: null,
      });

      return { status: 'pending' as const, role: input.role };
    });
  }

  /**
   * Accepts a pending invitation — the moment a membership becomes real.
   *
   * Scoped to the invitee themselves: only the person named on the invitation can accept
   * it, which is the entire point of splitting invite from accept.
   */
  async acceptInvitation(userId: string, farmId: string): Promise<void> {
    const [pending] = await this.elevated.db
      .select()
      .from(farmUsers)
      .where(
        and(
          eq(farmUsers.farmId, farmId),
          eq(farmUsers.userId, userId),
          isNull(farmUsers.acceptedAt),
          isNull(farmUsers.deletedAt),
        ),
      );

    if (!pending) throw new NotFoundError('No pending invitation');

    await this.elevated.db
      .update(farmUsers)
      .set({ acceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(farmUsers.id, pending.id));
  }

  /**
   * Points the current session at a different farm (FR-004) — no re-login, because a
   * session belongs to a person and roles belong to farms.
   */
  async switchActiveFarm(userId: string, sessionId: string, farmId: string): Promise<void> {
    await this.assertMembership(userId, farmId, null);
    await this.sessions.setActiveFarm(sessionId, userId, farmId);
  }

  /** Confirms membership (and optionally role) through the RLS-bound connection. */
  private async assertMembership(
    userId: string,
    farmId: string,
    allowedRoles: readonly string[] | null,
  ): Promise<void> {
    await this.app.asUser(userId, async (tx) => {
      const [membership] = await tx
        .select({ role: farmUsers.role })
        .from(farmUsers)
        .where(
          and(
            eq(farmUsers.farmId, farmId),
            eq(farmUsers.userId, userId),
            isNull(farmUsers.deletedAt),
          ),
        );

      // Not "forbidden" — a farm the caller has no membership on must be indistinguishable
      // from a farm that does not exist, or the API confirms which farms exist.
      if (!membership) throw new NotFoundError('Farm not found');
      if (allowedRoles && !allowedRoles.includes(membership.role)) {
        throw new TenancyError(`Role ${membership.role} may not perform this action`);
      }
    });
  }

  private async assertRole(
    tx: Parameters<Parameters<AppDb['asUser']>[1]>[0],
    userId: string,
    farmId: string,
    allowedRoles: readonly string[],
  ): Promise<void> {
    const [membership] = await tx
      .select({ role: farmUsers.role })
      .from(farmUsers)
      .where(
        and(
          eq(farmUsers.farmId, farmId),
          eq(farmUsers.userId, userId),
          isNull(farmUsers.deletedAt),
        ),
      );

    if (!membership) throw new NotFoundError('Farm not found');
    if (!allowedRoles.includes(membership.role)) {
      throw new TenancyError(`Role ${membership.role} may not perform this action`);
    }
  }

  /** True only if the caller owns a farm belonging to that business — checked under RLS. */
  private async assertOwnsBusiness(userId: string, businessId: string): Promise<void> {
    await this.app.asUser(userId, async (tx) => {
      const owned = await tx
        .select({ id: farms.id })
        .from(farmUsers)
        .innerJoin(farms, eq(farms.id, farmUsers.farmId))
        .where(
          and(
            eq(farmUsers.userId, userId),
            eq(farmUsers.role, 'owner'),
            eq(farms.businessId, businessId),
            isNull(farmUsers.deletedAt),
            sql`${farms.deletedAt} is null`,
          ),
        );

      if (owned.length === 0) throw new NotFoundError('Business not found');
    });
  }
}
