/**
 * Farm management against a real Postgres. The interesting cases are the ones where a
 * user is asked to act on a farm that is not theirs — those must be indistinguishable
 * from a farm that does not exist.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { and, eq, sql } from 'drizzle-orm';
import {
  authAuditLog,
  createAppDb,
  createElevatedDb,
  enterprises,
  events,
  farmUsers,
  farms,
  userSessions,
  users,
  type AppDb,
  type ElevatedDb,
} from '@werf/db';
import { startWerfTestDatabase, type WerfTestDatabase } from '@werf/db/testing';
import { ConflictError, NotFoundError, TenancyError, schemas } from '@werf/core';
import { APP_CONFIG, APP_DB, ELEVATED_DB } from '../db/db.module';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { TokenService } from '../auth/token.service';
import { TwoFactorService } from '../auth/two-factor.service';
import { PasskeyService } from '../auth/passkey.service';
import { RecoveryCodeService } from '../auth/recovery-code.service';
import { FarmsService } from './farms.service';
import { MAILER, type Mailer, type OutboundMessage } from '../mail/mailer';

/**
 * A relay that records what it was asked to send, and can be told to fail.
 *
 * A fake rather than a mock of our own code: this is the PORT's contract standing in for a real
 * SMTP server, which is the boundary the tests are allowed to substitute. `send` never rejects,
 * exactly as the port promises — which is precisely the property the "a failed relay must not
 * destroy the membership" test is checking is honoured all the way up.
 */
class RecordingMailer implements Mailer {
  readonly sent: OutboundMessage[] = [];
  failing = false;

  send(message: OutboundMessage): Promise<void> {
    if (this.failing) return Promise.resolve(); // the real adapter swallows and logs
    this.sent.push(message);
    return Promise.resolve();
  }
}

const BOOT_TIMEOUT_MS = 180_000;

const registration = (label: string): schemas.RegisterRequest => ({
  business: {
    name: `${label} Boerdery`,
    registrationNumber: null,
    contact: { email: `${label.toLowerCase()}@example.test`, phone: null },
    physicalAddress: {
      line1: `${label} Plaas`,
      line2: null,
      locality: 'Bothaville',
      province: 'Free State',
      postalCode: '9660',
    },
  },
  farm: {
    name: `${label} Plaas`,
    province: 'Free State',
    district: null,
    enterpriseTypes: ['beef_cattle'],
  },
  owner: {
    fullName: `${label} Owner`,
    email: `${label.toLowerCase()}@werf.test`,
    password: 'correct horse battery staple',
    locale: 'en-ZA',
    theme: 'light',
  },
});

describe('farm management', () => {
  let pg: WerfTestDatabase;
  let app: AppDb;
  let elevated: ElevatedDb;
  let auth: AuthService;
  let service: FarmsService;
  let mailer: RecordingMailer;

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
        FarmsService,
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
        { provide: MAILER, useFactory: () => new RecordingMailer() },
      ],
    }).compile();

    auth = moduleRef.get(AuthService);
    service = moduleRef.get(FarmsService);
    mailer = moduleRef.get<RecordingMailer>(MAILER);
  }, BOOT_TIMEOUT_MS);

  afterEach(async () => {
    await pg.reset();
    mailer.sent.length = 0;
    mailer.failing = false;
  });

  afterAll(async () => {
    await app?.close();
    await elevated?.close();
    await pg?.stop();
  });

  /** Registers a tenant and returns its owner's id, farm id, and business id. */
  async function tenant(label: string) {
    const session = await auth.register(registration(label));
    const [owner] = await elevated.db
      .select()
      .from(users)
      .where(eq(users.email, registration(label).owner.email));
    const [farm] = await elevated.db
      .select()
      .from(farms)
      .where(eq(farms.id, session.activeFarmId!));

    return {
      session,
      userId: owner!.id,
      farmId: farm!.id,
      businessId: farm!.businessId,
    };
  }

  describe('adding farms to a business (FR-004)', () => {
    it('lets an owner run several farms under one business', async () => {
      const a = await tenant('Alpha');

      const second = await service.createFarm(a.userId, {
        businessId: a.businessId,
        name: 'Kudu Ranch',
        province: 'Northern Cape',
        district: null,
        enterpriseTypes: ['sheep', 'game'],
      });

      const list = await service.listForUser(a.userId);
      expect(list.map((f) => f.name).sort()).toEqual(['Alpha Plaas', 'Kudu Ranch']);
      expect(second.role).toBe('owner');
    });

    it('gives the new farm its enterprises immediately', async () => {
      const a = await tenant('Alpha');
      const second = await service.createFarm(a.userId, {
        businessId: a.businessId,
        name: 'Kudu Ranch',
        province: 'Northern Cape',
        district: null,
        enterpriseTypes: ['sheep', 'game'],
      });

      const rows = await elevated.db
        .select()
        .from(enterprises)
        .where(eq(enterprises.farmId, second.id));

      expect(rows.map((r) => r.type).sort()).toEqual(['game', 'sheep']);
    });

    it('⭐ every farm lands in events_default, permanently (sync-auditor Finding 2, closed 2026-08-13)', async () => {
      // packages/sync/scripts/derive-sync-streams.ts's PARTITIONED_SOURCE_TABLE hand-maps the
      // `events` down-sync stream to the single `events_default` partition — see
      // powersync-partitioned-table-gotcha. That mapping used to be correct only by accident
      // (neither onboarding path called create_farm_partition, but nothing stopped a future one
      // from doing so). STATUS.md §3's owner decision retired the ability outright: migration
      // 0021 drops create_farm_partition, because PowerSync rejects publish_via_partition_root
      // (PSYNC_S1143) and the sync config is a static file generated at build/deploy time, not
      // regenerated per farm at signup — a farm given its own partition after the last deploy
      // would down-sync nothing, silently, forever. This is now a PERMANENT invariant, not a
      // tripwire on an open decision: both real onboarding paths still route to events_default,
      // and the function they might have called no longer exists to call.
      async function assertDefaultPartition(farmId: string): Promise<void> {
        const [created] = await elevated.db
          .insert(events)
          .values({
            farmId,
            type: 'weight',
            occurredAt: new Date('2026-07-20T06:00:00Z'),
            payload: { kg: 400, method: 'scale' },
          })
          .returning();
        const rows = await elevated.db.execute(
          sql`SELECT tableoid::regclass::text AS partition FROM events WHERE id = ${created!.id}`,
        );
        expect((rows.rows[0] as { partition: string }).partition).toBe('events_default');
      }

      // Path 1: registration's own direct farm insert.
      const a = await tenant('Alpha');
      await assertDefaultPartition(a.farmId);

      // Path 2: FarmsService.createFarm — a SEPARATE insert, not reachable from registration, and
      // the exact function Finding 2's own text names.
      const second = await service.createFarm(a.userId, {
        businessId: a.businessId,
        name: 'Kudu Ranch',
        province: 'Northern Cape',
        district: null,
        enterpriseTypes: ['sheep'],
      });
      await assertDefaultPartition(second.id);
    });

    it('refuses to add a farm to somebody else’s business', async () => {
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');

      // Bravo's owner naming Alpha's business must not be able to plant a farm in it —
      // and must not learn that the business exists either.
      await expect(
        service.createFarm(b.userId, {
          businessId: a.businessId,
          name: 'Trojan Plaas',
          province: 'Gauteng',
          district: null,
          enterpriseTypes: ['pigs'],
        }),
      ).rejects.toThrow(NotFoundError);

      const alphaFarms = await service.listForUser(a.userId);
      expect(alphaFarms.map((f) => f.name)).toEqual(['Alpha Plaas']);
    });
  });

  describe('changing enterprise types (FR-002, FR-003)', () => {
    it('adds a type without disturbing what is already there', async () => {
      const a = await tenant('Alpha');

      const updated = await service.updateEnterpriseTypes(a.userId, a.farmId, {
        add: ['row_crops'],
        remove: [],
      });

      expect(updated.enterpriseTypes.sort()).toEqual(['beef_cattle', 'row_crops']);
      const rows = await elevated.db
        .select()
        .from(enterprises)
        .where(eq(enterprises.farmId, a.farmId));
      expect(rows.map((r) => r.type).sort()).toEqual(['beef_cattle', 'row_crops']);
    });

    it('retires a removed type instead of deleting its history', async () => {
      const a = await tenant('Alpha');
      await service.updateEnterpriseTypes(a.userId, a.farmId, { add: ['row_crops'], remove: [] });

      const updated = await service.updateEnterpriseTypes(a.userId, a.farmId, {
        add: [],
        remove: ['row_crops'],
      });

      // The farm stops offering maize...
      expect(updated.enterpriseTypes).toEqual(['beef_cattle']);
      // ...but last season's maize enterprise still exists, merely inactive. Deleting it
      // would silently change the shape of every historical report.
      const [maize] = await elevated.db
        .select()
        .from(enterprises)
        .where(and(eq(enterprises.farmId, a.farmId), eq(enterprises.type, 'row_crops')));
      expect(maize).toBeDefined();
      expect(maize!.active).toBe(false);
      expect(maize!.deletedAt).toBeNull();
    });

    it('revives the original enterprise when a farmer picks a crop back up', async () => {
      const a = await tenant('Alpha');
      await service.updateEnterpriseTypes(a.userId, a.farmId, { add: ['row_crops'], remove: [] });
      await service.updateEnterpriseTypes(a.userId, a.farmId, { add: [], remove: ['row_crops'] });

      await service.updateEnterpriseTypes(a.userId, a.farmId, { add: ['row_crops'], remove: [] });

      const rows = await elevated.db
        .select()
        .from(enterprises)
        .where(and(eq(enterprises.farmId, a.farmId), eq(enterprises.type, 'row_crops')));

      // One maize enterprise, reactivated — not a second one that splits the history.
      expect(rows).toHaveLength(1);
      expect(rows[0]!.active).toBe(true);
    });

    it('refuses to leave a farm with no enterprise at all', async () => {
      const a = await tenant('Alpha');

      await expect(
        service.updateEnterpriseTypes(a.userId, a.farmId, { add: [], remove: ['beef_cattle'] }),
      ).rejects.toThrow(ConflictError);
    });

    it('refuses a stranger, exactly as if the farm did not exist', async () => {
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');

      await expect(
        service.updateEnterpriseTypes(b.userId, a.farmId, { add: ['pigs'], remove: [] }),
      ).rejects.toThrow(NotFoundError);
    });

    it('refuses a member whose role does not permit it', async () => {
      const a = await tenant('Alpha');
      await service.invite(a.userId, a.farmId, {
        fullName: 'Sipho Ndlovu',
        email: 'sipho@werf.test',
        phone: null,
        role: 'manager',
      });
      const [invitee] = await elevated.db
        .select()
        .from(users)
        .where(eq(users.email, 'sipho@werf.test'));
      await service.acceptInvitation(invitee!.id, a.farmId);

      // A manager is genuinely on this farm — so this is a ROLE refusal, not a tenancy
      // one, and it must say so rather than pretending the farm does not exist.
      await expect(
        service.updateEnterpriseTypes(invitee!.id, a.farmId, { add: ['pigs'], remove: [] }),
      ).rejects.toThrow(TenancyError);
    });
  });

  describe('rest-period warning threshold (FR-152, 4e·2)', () => {
    it('sets the threshold', async () => {
      const a = await tenant('Alpha');

      const updated = await service.updateRestPeriodDays(a.userId, a.farmId, {
        restPeriodDays: 30,
      });

      expect(updated.restPeriodDays).toBe(30);
      const [row] = await elevated.db.select().from(farms).where(eq(farms.id, a.farmId));
      expect(row!.restPeriodDays).toBe(30);
    });

    it('clears the threshold back to null — a real choice, not a value the schema forbids', async () => {
      const a = await tenant('Alpha');
      await service.updateRestPeriodDays(a.userId, a.farmId, { restPeriodDays: 30 });

      const cleared = await service.updateRestPeriodDays(a.userId, a.farmId, {
        restPeriodDays: null,
      });

      expect(cleared.restPeriodDays).toBeNull();
    });

    it('refuses a stranger, exactly as if the farm did not exist', async () => {
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');

      await expect(
        service.updateRestPeriodDays(b.userId, a.farmId, { restPeriodDays: 30 }),
      ).rejects.toThrow(NotFoundError);
    });

    it('refuses a member whose role does not permit it', async () => {
      const a = await tenant('Alpha');
      await service.invite(a.userId, a.farmId, {
        fullName: 'Sipho Ndlovu',
        email: 'sipho@werf.test',
        phone: null,
        role: 'manager',
      });
      const [invitee] = await elevated.db
        .select()
        .from(users)
        .where(eq(users.email, 'sipho@werf.test'));
      await service.acceptInvitation(invitee!.id, a.farmId);

      await expect(
        service.updateRestPeriodDays(invitee!.id, a.farmId, { restPeriodDays: 30 }),
      ).rejects.toThrow(TenancyError);
    });
  });

  describe('inviting people (FR-005)', () => {
    const SIPHO = {
      fullName: 'Sipho Ndlovu',
      email: 'sipho@werf.test',
      phone: null,
      role: 'manager' as const,
    };

    /** The invitee's user id, read from the database — never from the invite response. */
    async function inviteeId(email: string): Promise<string> {
      const [user] = await elevated.db.select().from(users).where(eq(users.email, email));
      return user!.id;
    }

    it('records the invitation with the role it was sent for', async () => {
      const a = await tenant('Alpha');

      const result = await service.invite(a.userId, a.farmId, SIPHO);

      expect(result).toEqual({ status: 'pending', role: 'manager' });
      const [membership] = await elevated.db
        .select()
        .from(farmUsers)
        .where(
          and(eq(farmUsers.farmId, a.farmId), eq(farmUsers.userId, await inviteeId(SIPHO.email))),
        );
      expect(membership!.role).toBe('manager');
      expect(membership!.invitedAt).not.toBeNull();

      const [event] = await elevated.db
        .select()
        .from(authAuditLog)
        .where(eq(authAuditLog.event, 'invitation'));
      expect(event).toMatchObject({
        outcome: 'success',
        actorUserId: a.userId,
        subjectUserId: await inviteeId(SIPHO.email),
        farmId: a.farmId,
        metadata: { role: 'manager', reinvitation: false },
      });
      expect(JSON.stringify(event)).not.toContain(SIPHO.email);
    });

    it('grants nothing until the invitee accepts', async () => {
      const a = await tenant('Alpha');
      await service.invite(a.userId, a.farmId, SIPHO);
      const sipho = await inviteeId(SIPHO.email);

      // An invitation is a request, not an access grant. Until Sipho agrees, the farm is
      // not his and — just as importantly — his name and phone are not Alpha's.
      expect(await service.listForUser(sipho)).toEqual([]);
      await expect(
        service.updateEnterpriseTypes(sipho, a.farmId, { add: ['pigs'], remove: [] }),
      ).rejects.toThrow(NotFoundError);
    });

    it('does not disclose the invitee’s details to the inviter before they accept', async () => {
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');
      // Bravo's owner already exists, with a real name and locale of their own.
      await service.invite(a.userId, a.farmId, {
        fullName: 'Whoever',
        email: 'bravo@werf.test',
        phone: null,
        role: 'viewer',
      });

      // Alpha named an address belonging to someone in another tenant. Until that person
      // accepts, Alpha must not be able to read anything about them (POPIA). `id` only:
      // `werf_app` holds column-level grants on `users` (0029), not `SELECT *`.
      const visibleUsers = await app.asUser(a.userId, (tx) =>
        tx.select({ id: users.id }).from(users),
      );

      expect(visibleUsers.map((u) => u.id)).toEqual([a.userId]);
      expect(visibleUsers.map((u) => u.id)).not.toContain(b.userId);
    });

    it('gives the invitee the farm once they accept, and nothing more', async () => {
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');
      await service.invite(a.userId, a.farmId, SIPHO);
      const sipho = await inviteeId(SIPHO.email);

      await service.acceptInvitation(sipho, a.farmId);

      const visible = await service.listForUser(sipho);
      expect(visible.map((f) => f.id)).toEqual([a.farmId]);
      expect(visible.map((f) => f.id)).not.toContain(b.farmId);
      expect(visible[0]!.role).toBe('manager');
    });

    it('lets only the invitee accept their own invitation', async () => {
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');
      await service.invite(a.userId, a.farmId, SIPHO);

      await expect(service.acceptInvitation(b.userId, a.farmId)).rejects.toThrow(NotFoundError);
    });

    it('does not give an invited account a password to be guessed', async () => {
      const a = await tenant('Alpha');
      await service.invite(a.userId, a.farmId, SIPHO);

      const [user] = await elevated.db.select().from(users).where(eq(users.email, SIPHO.email));
      expect(user!.passwordHash).toBeNull();
    });

    it('reuses one identity across farms, with a different role on each (SRS-12)', async () => {
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');

      await service.invite(a.userId, a.farmId, SIPHO);
      await service.invite(b.userId, b.farmId, { ...SIPHO, role: 'viewer' });
      const sipho = await inviteeId(SIPHO.email);
      await service.acceptInvitation(sipho, a.farmId);
      await service.acceptInvitation(sipho, b.farmId);

      // One person, two farms, two different roles — managing two neighbours' farms is
      // normal, and the role is what is per-farm.
      const visible = await service.listForUser(sipho);
      expect(visible).toHaveLength(2);
      expect(visible.find((f) => f.id === a.farmId)!.role).toBe('manager');
      expect(visible.find((f) => f.id === b.farmId)!.role).toBe('viewer');
    });

    it('answers identically whether or not the address already had an account', async () => {
      const a = await tenant('Alpha');
      await tenant('Bravo');

      // A differing response would be a membership oracle: try an address, read the
      // answer, learn who banks with us.
      const known = await service.invite(a.userId, a.farmId, {
        fullName: 'Whoever',
        email: 'bravo@werf.test',
        phone: null,
        role: 'viewer',
      });
      const unknown = await service.invite(a.userId, a.farmId, {
        fullName: 'Nobody Yet',
        email: 'nobody@werf.test',
        phone: null,
        role: 'viewer',
      });

      expect(known).toEqual(unknown);
    });

    it('refuses to invite the same person to the same farm twice', async () => {
      const a = await tenant('Alpha');
      await service.invite(a.userId, a.farmId, SIPHO);

      await expect(service.invite(a.userId, a.farmId, SIPHO)).rejects.toThrow(ConflictError);
    });

    it('lets someone who left the farm be invited back', async () => {
      const a = await tenant('Alpha');
      await service.invite(a.userId, a.farmId, SIPHO);
      const sipho = await inviteeId(SIPHO.email);
      await service.acceptInvitation(sipho, a.farmId);

      // Removal is a tombstone, and (farm_id, user_id) is unique — so re-inviting has to
      // revive the row. A seasonal worker returning next season is not an edge case.
      await elevated.db
        .update(farmUsers)
        .set({ deletedAt: new Date() })
        .where(and(eq(farmUsers.farmId, a.farmId), eq(farmUsers.userId, sipho)));

      await expect(service.invite(a.userId, a.farmId, SIPHO)).resolves.toEqual({
        status: 'pending',
        role: 'manager',
      });

      // And it is genuinely pending again — coming back requires agreeing again.
      expect(await service.listForUser(sipho)).toEqual([]);
      await service.acceptInvitation(sipho, a.farmId);
      expect(await service.listForUser(sipho)).toHaveLength(1);
    });

    it('does not resurrect a soft-deleted (erased) identity into a live membership', async () => {
      const a = await tenant('Alpha');

      // Simulates a POPIA erasure: the row exists, tombstoned, with no way back through
      // login (which filters `deleted_at`) — the same shape `AuthService.register` already
      // refuses to reuse.
      const [erased] = await elevated.db
        .insert(users)
        .values({ email: SIPHO.email, fullName: 'Erased Person', deletedAt: new Date() })
        .returning();

      await expect(service.invite(a.userId, a.farmId, SIPHO)).rejects.toThrow(ConflictError);

      // Nothing was created pointing at the erased row, and it was not revived either —
      // the identity stays exactly as invisible as it was before the invite was attempted.
      const memberships = await elevated.db
        .select()
        .from(farmUsers)
        .where(eq(farmUsers.userId, erased!.id));
      expect(memberships).toHaveLength(0);
      const [row] = await elevated.db.select().from(users).where(eq(users.id, erased!.id));
      expect(row!.deletedAt).not.toBeNull();
    });

    it('refuses an invitation to a farm the caller is not on', async () => {
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');

      await expect(
        service.invite(b.userId, a.farmId, {
          fullName: 'Trojan Horse',
          email: 'trojan@werf.test',
          phone: null,
          role: 'owner',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    // ── Delivery (FR-005) ─────────────────────────────────────────────────────────────
    it('actually reaches the invitee, naming the farm and the role', async () => {
      // Before this, the membership existed and nothing ever reached the person it named.
      const a = await tenant('Alpha');

      await service.invite(a.userId, a.farmId, SIPHO);

      expect(mailer.sent).toHaveLength(1);
      const [message] = mailer.sent;
      expect(message!.to).toBe(SIPHO.email);
      // The farm and the role are in the message, because "someone has invited you to something"
      // is the shape of a phishing email AND the shape of an email people ignore.
      expect(message!.subject).toMatch(/Alpha Plaas/);
      expect(message!.body).toMatch(/Alpha Plaas/);
      expect(message!.body).toMatch(new RegExp(SIPHO.role));
      // It promises nothing until they accept, which is what the membership actually does.
      expect(message!.body).toMatch(/nothing is shared with you/i);
    });

    it('keeps the invitation when the relay fails — the membership is the durable fact', async () => {
      // Rolling back a real record to report a transient mail failure would be the wrong trade,
      // and it would do it after the invitee's user row had already been written. The invitation
      // stays pending and can be re-sent.
      const a = await tenant('Alpha');
      mailer.failing = true;

      const result = await service.invite(a.userId, a.farmId, SIPHO);

      expect(result.status).toBe('pending');
      expect(mailer.sent).toHaveLength(0);
      const [membership] = await elevated.db
        .select()
        .from(farmUsers)
        .where(
          and(eq(farmUsers.farmId, a.farmId), eq(farmUsers.userId, await inviteeId(SIPHO.email))),
        );
      expect(membership).toBeDefined();
      expect(membership!.acceptedAt).toBeNull();
    });

    it('sends nothing for a phone-only invitation, rather than falling back to SMS', async () => {
      // Deliberate. SIM swap is industrialised in South Africa (CLAUDE.md), and an invitation link
      // is a credential-shaped thing; the reasoning that rules SMS out as a second factor does not
      // stop applying because this one is not called a factor. The membership is still recorded —
      // a phone invitation is handed over in person.
      const a = await tenant('Alpha');

      const result = await service.invite(a.userId, a.farmId, {
        fullName: 'Nomsa Dlamini',
        email: null,
        phone: '+27821234567',
        role: 'worker',
      });

      expect(result.status).toBe('pending');
      expect(mailer.sent).toHaveLength(0);
    });
  });

  /**
   * These go straight at RLS through the scoped connection, deliberately bypassing
   * FarmsService. The point is what the DATABASE refuses, not what the service checks —
   * RLS is the layer that has to hold when the application code above it is wrong, and
   * every membership write today happens to run elevated, so nothing else exercises it.
   */
  describe("membership writes are an owner's act (RLS)", () => {
    /** Accepts an invitation the way the invitee would, so the membership is live. */
    async function joinedMember(farmId: string, role: 'manager' | 'worker') {
      const [user] = await elevated.db
        .insert(users)
        .values({ email: `${role}@rls.test`, fullName: 'Joined Member' })
        .returning();
      await elevated.db
        .insert(farmUsers)
        .values({ farmId, userId: user!.id, role, invitedAt: new Date(), acceptedAt: new Date() });
      return user!.id;
    }

    it('refuses to let a member promote themselves to owner', async () => {
      // The escalation: `farm_users` is where ROLE lives, so a policy that checks only the
      // farm lets the lowest role on it rewrite its own row into the highest.
      const a = await tenant('Alpha');
      const workerId = await joinedMember(a.farmId, 'worker');

      // Silently affects NOTHING rather than raising: the UPDATE policy's USING clause
      // filters the row out of the statement's scope before WITH CHECK is ever consulted,
      // so there is no row left to reject. That is the right shape — the escalation fails
      // whether or not the caller bothers to read the row count.
      const changed = await app.asUser(workerId, (tx) =>
        tx
          .update(farmUsers)
          .set({ role: 'owner' })
          .where(and(eq(farmUsers.farmId, a.farmId), eq(farmUsers.userId, workerId)))
          .returning({ id: farmUsers.id }),
      );
      expect(changed).toHaveLength(0);

      const [after] = await elevated.db
        .select()
        .from(farmUsers)
        .where(and(eq(farmUsers.farmId, a.farmId), eq(farmUsers.userId, workerId)));
      expect(after!.role).toBe('worker');
    });

    it('refuses to let a non-owner add anyone to the farm', async () => {
      const a = await tenant('Alpha');
      const managerId = await joinedMember(a.farmId, 'manager');
      const [stranger] = await elevated.db
        .insert(users)
        .values({ email: 'stranger@rls.test', fullName: 'Stranger' })
        .returning();

      await expect(
        app.asUser(managerId, (tx) =>
          tx.insert(farmUsers).values({
            farmId: a.farmId,
            userId: stranger!.id,
            role: 'owner',
            acceptedAt: new Date(),
          }),
        ),
      ).rejects.toThrow();
    });

    it('still lets a member READ who else is on the farm', async () => {
      // Narrowing the write predicate must not narrow the read one: FarmsService decides
      // authorisation by reading this table through the very same scoped connection, so a
      // too-tight USING clause would turn "wrong role" into "no such farm".
      const a = await tenant('Alpha');
      const workerId = await joinedMember(a.farmId, 'worker');

      const rows = await app.asUser(workerId, (tx) =>
        tx.select().from(farmUsers).where(eq(farmUsers.farmId, a.farmId)),
      );
      expect(rows.map((r) => r.role).sort()).toEqual(['owner', 'worker']);
    });
  });

  describe('switching the active farm (FR-004)', () => {
    it('changes farms without issuing a new session', async () => {
      const a = await tenant('Alpha');
      const second = await service.createFarm(a.userId, {
        businessId: a.businessId,
        name: 'Kudu Ranch',
        province: 'Northern Cape',
        district: null,
        enterpriseTypes: ['sheep'],
      });

      const [before] = await elevated.db.select().from(userSessions);
      await service.switchActiveFarm(a.userId, before!.id, second.id);

      const [after] = await elevated.db
        .select()
        .from(userSessions)
        .where(eq(userSessions.id, before!.id));

      // Same session row, same refresh token — the farmer was not asked to log in again.
      expect(after!.activeFarmId).toBe(second.id);
      expect(after!.refreshTokenHash).toBe(before!.refreshTokenHash);
      expect(after!.revokedAt).toBeNull();

      const [event] = await elevated.db
        .select()
        .from(authAuditLog)
        .where(eq(authAuditLog.event, 'farm_switch'));
      expect(event).toMatchObject({
        outcome: 'success',
        actorUserId: a.userId,
        subjectUserId: a.userId,
        farmId: second.id,
        sessionId: before!.id,
        sessionFamilyId: before!.familyId,
        metadata: { fromFarmId: a.farmId },
      });
    });

    it('refuses to switch to a farm the caller has no membership on', async () => {
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');
      const [session] = await elevated.db
        .select()
        .from(userSessions)
        .where(eq(userSessions.userId, b.userId));

      await expect(service.switchActiveFarm(b.userId, session!.id, a.farmId)).rejects.toThrow(
        NotFoundError,
      );

      const [unchanged] = await elevated.db
        .select()
        .from(userSessions)
        .where(eq(userSessions.id, session!.id));
      expect(unchanged!.activeFarmId).toBe(b.farmId);
    });
  });
});
