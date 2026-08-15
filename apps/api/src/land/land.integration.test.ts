/**
 * Creating a camp (FR-150) against a real Postgres. The cases a mock cannot see, and which are the
 * whole reason this endpoint was worth writing carefully:
 *
 *  • The client sends GeoJSON and the CANONICAL PostGIS `boundary` is populated from it. This is the
 *    half of the dual-write nothing enforced before: the `land_units_geojson` trigger only fires
 *    geometry→GeoJSON, so a service that stored the client's text and left `boundary` null would
 *    look correct from the client, pass every unit test, and silently break every spatial query.
 *  • The stored GeoJSON is PostGIS' own normalisation, not the text that arrived — which is what
 *    proves the two columns hold the same shape rather than two independently-authored ones.
 *  • RLS isolation and the WITH CHECK write-guard on a table that now takes field captures.
 *  • Idempotency on the client id (an at-least-once flush must not create the camp twice), and a
 *    DIFFERENT id reusing a code being a refusal rather than a second camp or a 500.
 *
 * We never mock the DB (CLAUDE.md).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { eq, sql } from 'drizzle-orm';
import {
  createAppDb,
  createElevatedDb,
  events,
  farmUsers,
  landUnits,
  users,
  type AppDb,
  type ElevatedDb,
} from '@werf/db';
import { startWerfTestDatabase, type WerfTestDatabase } from '@werf/db/testing';
import {
  ConflictError,
  NotFoundError,
  TenancyError,
  ValidationError,
  schemas,
  uuidv7,
} from '@werf/core';
import { APP_CONFIG, APP_DB, ELEVATED_DB } from '../db/db.module';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { TokenService } from '../auth/token.service';
import { TwoFactorService } from '../auth/two-factor.service';
import { PasskeyService } from '../auth/passkey.service';
import { RecoveryCodeService } from '../auth/recovery-code.service';
import { LandService } from './land.service';

const BOOT_TIMEOUT_MS = 180_000;

/** A small square near Bloemfontein — a real polygon, closed, in lon/lat order. */
const SQUARE = JSON.stringify({
  type: 'Polygon',
  coordinates: [
    [
      [26.2, -29.1],
      [26.3, -29.1],
      [26.3, -29.2],
      [26.2, -29.2],
      [26.2, -29.1],
    ],
  ],
});

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

/** A minimal valid camp; overlay the fields a test cares about. */
const campBody = (over: Partial<schemas.NewLandUnit> & { farmId: string }): schemas.NewLandUnit =>
  schemas.newLandUnitSchema.parse({
    id: uuidv7(),
    kind: 'camp',
    code: 'Camp 3',
    ...over,
  });

describe('creating a camp (FR-150)', () => {
  let pg: WerfTestDatabase;
  let app: AppDb;
  let elevated: ElevatedDb;
  let auth: AuthService;
  let service: LandService;

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
        LandService,
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
      ],
    }).compile();

    auth = moduleRef.get(AuthService);
    service = moduleRef.get(LandService);
  }, BOOT_TIMEOUT_MS);

  afterEach(async () => {
    await pg.reset();
  });

  afterAll(async () => {
    await app?.close();
    await elevated?.close();
    await pg?.stop();
  });

  /** Registers a tenant and returns its owner's id and farm id. */
  async function tenant(label: string) {
    const session = await auth.register(registration(label));
    const [owner] = await elevated.db
      .select()
      .from(users)
      .where(eq(users.email, registration(label).owner.email));
    return { userId: owner!.id, farmId: session.activeFarmId! };
  }

  it('creates a camp with the fields a farmer captures at the gate', async () => {
    const a = await tenant('Land');

    const camp = await service.createLandUnit(
      a.userId,
      campBody({ farmId: a.farmId, code: 'Camp 3', name: 'Fonteinkamp', hectares: 42.5 }),
    );

    expect(camp.code).toBe('Camp 3');
    expect(camp.name).toBe('Fonteinkamp');
    // numeric(10,2) round-trips as a string in the driver; the value must survive the conversion.
    expect(Number(camp.hectares)).toBe(42.5);
    expect(camp.createdBy).toBe(a.userId);
  });

  it('accepts a camp with no boundary — a farmer at a gate is not blocked on mapping it', async () => {
    const a = await tenant('Land');

    const camp = await service.createLandUnit(a.userId, campBody({ farmId: a.farmId }));

    expect(camp.boundaryGeojson).toBeNull();
  });

  it('derives the CANONICAL PostGIS boundary from the client GeoJSON, and mirrors it back', async () => {
    // The dual-write, in the direction only the server can do. If this ever regresses to storing
    // the client's text with a null geometry, every spatial query silently returns nothing.
    const a = await tenant('Land');

    const camp = await service.createLandUnit(
      a.userId,
      campBody({ farmId: a.farmId, boundaryGeojson: SQUARE }),
    );

    const [stored] = await elevated.db
      .select({
        hasGeometry: sql<boolean>`boundary is not null`,
        srid: sql<number>`ST_SRID(boundary)`,
        geometryType: sql<string>`GeometryType(boundary)`,
        // Recomputed from the geometry — the mirror must equal what PostGIS itself would emit.
        fromGeometry: sql<string>`ST_AsGeoJSON(boundary)`,
        mirror: landUnits.boundaryGeojson,
      })
      .from(landUnits)
      .where(eq(landUnits.id, camp.id));

    expect(stored!.hasGeometry).toBe(true);
    expect(stored!.srid).toBe(4326);
    expect(stored!.geometryType).toBe('POLYGON');
    expect(stored!.mirror).toBe(stored!.fromGeometry);
    // The mirror is PostGIS' normalisation, not the client's text — and it is still the same shape.
    expect(JSON.parse(stored!.mirror!)).toMatchObject({ type: 'Polygon' });
  });

  it('refuses a boundary that is not a Polygon with a message, not a 500', async () => {
    const a = await tenant('Land');
    const point = JSON.stringify({ type: 'Point', coordinates: [26.2, -29.1] });

    await expect(
      service.createLandUnit(a.userId, campBody({ farmId: a.farmId, boundaryGeojson: point })),
    ).rejects.toThrow(ValidationError);

    const rows = await elevated.db.select().from(landUnits);
    expect(rows).toHaveLength(0);
  });

  it('is idempotent on the client id, so a re-flush does not create the camp twice', async () => {
    const a = await tenant('Land');
    const body = campBody({ farmId: a.farmId, hectares: 12 });

    const first = await service.createLandUnit(a.userId, body);
    const again = await service.createLandUnit(a.userId, body);

    expect(again.id).toBe(first.id);
    const rows = await app.asUser(a.userId, (tx) => tx.select().from(landUnits));
    expect(rows).toHaveLength(1);
  });

  it('refuses a DIFFERENT camp reusing a code, and says which name is taken', async () => {
    const a = await tenant('Land');
    await service.createLandUnit(a.userId, campBody({ farmId: a.farmId, code: 'Camp 3' }));

    await expect(
      service.createLandUnit(a.userId, campBody({ farmId: a.farmId, code: 'Camp 3' })),
    ).rejects.toThrow(ConflictError);

    const rows = await app.asUser(a.userId, (tx) => tx.select().from(landUnits));
    expect(rows).toHaveLength(1);
  });

  it('lets two farms each have their own Camp 3, and hides one from the other', async () => {
    const a = await tenant('Land');
    const b = await tenant('Other');

    await service.createLandUnit(a.userId, campBody({ farmId: a.farmId, code: 'Camp 3' }));
    await service.createLandUnit(b.userId, campBody({ farmId: b.farmId, code: 'Camp 3' }));

    const seenByA = await service.listLandUnits(a.userId, a.farmId);
    expect(seenByA).toHaveLength(1);
    expect(seenByA[0]!.farmId).toBe(a.farmId);
  });

  it('refuses a stranger as "no such farm" and writes nothing', async () => {
    const a = await tenant('Land');
    const b = await tenant('Other');

    await expect(service.createLandUnit(b.userId, campBody({ farmId: a.farmId }))).rejects.toThrow(
      NotFoundError,
    );

    const rows = await elevated.db.select().from(landUnits);
    expect(rows).toHaveLength(0);
  });

  it('refuses a real member whose role may not capture, and says so', async () => {
    const a = await tenant('Land');
    const b = await tenant('Viewer');
    // A genuine, accepted membership — but read-only. A role refusal, not a 404.
    await elevated.db.insert(farmUsers).values({
      farmId: a.farmId,
      userId: b.userId,
      role: 'viewer',
      invitedAt: new Date(),
      acceptedAt: new Date(),
    });

    await expect(service.createLandUnit(b.userId, campBody({ farmId: a.farmId }))).rejects.toThrow(
      TenancyError,
    );

    const rows = await elevated.db.select().from(landUnits);
    expect(rows).toHaveLength(0);
  });

  /**
   * Walking a boundary with a GPS (FR-150, § 4 B7). The cases below are the reason this is an event
   * log with a re-derived column rather than a column write, and only a real Postgres can show it:
   * the ordering test puts two walks in the WRONG arrival order on purpose, which is the ordinary
   * case for two phones in a dead zone and the one a naive implementation gets backwards.
   */
  describe('walking a boundary (FR-150)', () => {
    /** A ~108 ha box in the Free State, walked anticlockwise. */
    const BOX = [
      { lon: 26.2, lat: -29.0, accuracyM: 4 },
      { lon: 26.21, lat: -29.0, accuracyM: 4 },
      { lon: 26.21, lat: -28.99, accuracyM: 5 },
      { lon: 26.2, lat: -28.99, accuracyM: 4 },
    ];

    /** The same camp walked again after the fence was moved east — a visibly different shape. */
    const MOVED_FENCE = [
      { lon: 26.2, lat: -29.0, accuracyM: 4 },
      { lon: 26.23, lat: -29.0, accuracyM: 4 },
      { lon: 26.23, lat: -28.99, accuracyM: 4 },
      { lon: 26.2, lat: -28.99, accuracyM: 4 },
    ];

    const walk = (over: {
      farmId: string;
      landUnitId: string;
      id?: string;
      occurredAt?: string;
      corners?: typeof BOX;
    }) =>
      schemas.recordBoundaryWalkRequestSchema.parse({
        id: over.id ?? uuidv7(),
        farmId: over.farmId,
        landUnitId: over.landUnitId,
        occurredAt: over.occurredAt ?? '2026-03-02T04:10:00Z',
        corners: over.corners ?? BOX,
      });

    /** The camp's stored geometry, read as GeoJSON through PostGIS itself. */
    async function storedBoundary(landUnitId: string) {
      const [row] = await elevated.db
        .select({
          geojson: sql<string | null>`ST_AsGeoJSON(${landUnits.boundary})`,
          mirror: landUnits.boundaryGeojson,
          /** Hectares off the SPHEROID, which is the canonical answer the device only estimates. */
          hectares: sql<string | null>`ST_Area(${landUnits.boundary}::geography) / 10000`,
        })
        .from(landUnits)
        .where(eq(landUnits.id, landUnitId));
      return row!;
    }

    async function campFor(tenantId: { userId: string; farmId: string }) {
      const camp = await service.createLandUnit(
        tenantId.userId,
        campBody({ farmId: tenantId.farmId }),
      );
      return camp.id;
    }

    it('puts the walked ring on the camp as canonical geometry AND as the mirror the device reads', async () => {
      const a = await tenant('Land');
      const campId = await campFor(a);

      await service.recordBoundaryWalk(a.userId, walk({ farmId: a.farmId, landUnitId: campId }));

      const stored = await storedBoundary(campId);
      expect(stored.geojson).not.toBeNull();
      // Both halves of the dual write, or it is not a dual write.
      expect(stored.mirror).not.toBeNull();
      expect(JSON.parse(stored.mirror!)).toMatchObject({ type: 'Polygon' });
      // And PostGIS agrees with what the device measured on the phone: ~108 ha.
      expect(Number(stored.hectares)).toBeGreaterThan(107);
      expect(Number(stored.hectares)).toBeLessThan(109);
    });

    it('keeps the corners and the accuracy each was taken at, as the evidence for the shape', async () => {
      const a = await tenant('Land');
      const campId = await campFor(a);

      const stored = await service.recordBoundaryWalk(
        a.userId,
        walk({ farmId: a.farmId, landUnitId: campId }),
      );

      const payload = stored.payload as { corners: Array<{ accuracyM: number }> };
      expect(payload.corners).toHaveLength(4);
      expect(payload.corners.map((c) => c.accuracyM)).toEqual([4, 4, 5, 4]);
    });

    it('⭐ takes the walk that HAPPENED last, not the one that ARRIVED last', async () => {
      // Two phones, both offline for a fortnight. The fence was moved on the 10th and re-walked;
      // the phone carrying that walk reconnects FIRST, and the phone carrying the old 1st-of-March
      // walk reconnects after it. Arrival order is not occurred_at order — it never is out here.
      const a = await tenant('Land');
      const campId = await campFor(a);

      await service.recordBoundaryWalk(
        a.userId,
        walk({
          farmId: a.farmId,
          landUnitId: campId,
          occurredAt: '2026-03-10T06:00:00Z',
          corners: MOVED_FENCE,
        }),
      );
      await service.recordBoundaryWalk(
        a.userId,
        walk({ farmId: a.farmId, landUnitId: campId, occurredAt: '2026-03-01T06:00:00Z' }),
      );

      // The 10th's shape is ~3× wider than the 1st's, so the two are not close: ~325 ha vs ~108 ha.
      // A server that stepped the column on each arrival would leave the camp at 108.
      const stored = await storedBoundary(campId);
      expect(Number(stored.hectares)).toBeGreaterThan(300);

      // And the loser is KEPT. It is a true fact about a fence that was really there in March.
      const log = await elevated.db.select().from(events).where(eq(events.landUnitId, campId));
      expect(log).toHaveLength(2);
    });

    it('breaks a same-day tie by id, so two walks on one day cannot resolve to the query plan', async () => {
      // Day-grained capture means both walks carry the SAME instant, which makes ties ordinary
      // rather than exotic. The id is a client UUIDv7 — time-ordered, and the same value here as on
      // the device — so both sides cut the same way.
      const a = await tenant('Land');
      const campId = await campFor(a);
      const sameInstant = '2026-03-02T12:00:00Z';

      await service.recordBoundaryWalk(
        a.userId,
        walk({
          farmId: a.farmId,
          landUnitId: campId,
          id: '01900000-0000-7000-8000-0000000000b2',
          occurredAt: sameInstant,
          corners: MOVED_FENCE,
        }),
      );
      await service.recordBoundaryWalk(
        a.userId,
        walk({
          farmId: a.farmId,
          landUnitId: campId,
          id: '01900000-0000-7000-8000-0000000000b1',
          occurredAt: sameInstant,
        }),
      );

      // ...b2 is the later id, so its shape wins however the rows happen to come back.
      expect(Number((await storedBoundary(campId)).hectares)).toBeGreaterThan(300);
    });

    it('absorbs a re-flushed walk instead of jamming the queue behind it', async () => {
      const a = await tenant('Land');
      const campId = await campFor(a);
      const body = walk({ farmId: a.farmId, landUnitId: campId });

      const first = await service.recordBoundaryWalk(a.userId, body);
      const again = await service.recordBoundaryWalk(a.userId, body);

      // At-least-once delivery: a 201 lost on the way home is retried, and must be a no-op.
      expect(again.id).toBe(first.id);
      const log = await elevated.db.select().from(events).where(eq(events.landUnitId, campId));
      expect(log).toHaveLength(1);
    });

    it('refuses a fence line that crosses itself, and stores nothing', async () => {
      const a = await tenant('Land');
      const campId = await campFor(a);
      const bowtie = [
        { lon: 26.2, lat: -29.0, accuracyM: 4 },
        { lon: 26.21, lat: -28.99, accuracyM: 4 },
        { lon: 26.21, lat: -29.0, accuracyM: 4 },
        { lon: 26.2, lat: -28.99, accuracyM: 4 },
      ];

      await expect(
        service.recordBoundaryWalk(
          a.userId,
          walk({ farmId: a.farmId, landUnitId: campId, corners: bowtie }),
        ),
      ).rejects.toThrow(ValidationError);

      expect(await elevated.db.select().from(events)).toHaveLength(0);
      expect((await storedBoundary(campId)).geojson).toBeNull();
    });

    it('refuses a walk filed against a NEIGHBOUR’s camp as "not found"', async () => {
      // The FK alone would allow this: `events.land_unit_id` references land_units with no farm
      // qualifier, and Postgres checks referential integrity as the system rather than as the role.
      const a = await tenant('Land');
      const b = await tenant('Other');
      const neighboursCamp = await campFor(b);

      await expect(
        service.recordBoundaryWalk(
          a.userId,
          walk({ farmId: a.farmId, landUnitId: neighboursCamp }),
        ),
      ).rejects.toThrow(NotFoundError);

      expect((await storedBoundary(neighboursCamp)).geojson).toBeNull();
    });

    it('refuses a real member whose role may not capture', async () => {
      const a = await tenant('Land');
      const b = await tenant('Viewer');
      const campId = await campFor(a);
      await elevated.db.insert(farmUsers).values({
        farmId: a.farmId,
        userId: b.userId,
        role: 'viewer',
        invitedAt: new Date(),
        acceptedAt: new Date(),
      });

      await expect(
        service.recordBoundaryWalk(b.userId, walk({ farmId: a.farmId, landUnitId: campId })),
      ).rejects.toThrow(TenancyError);
    });

    it('does not touch the hectares the FARMER declared', async () => {
      // A walk that clipped a corner must never silently replace a figure off a title deed. The
      // measured area is recorded on the event; the declared one is the farmer's and stays theirs.
      const a = await tenant('Land');
      const camp = await service.createLandUnit(
        a.userId,
        campBody({ farmId: a.farmId, hectares: 40 }),
      );

      await service.recordBoundaryWalk(a.userId, walk({ farmId: a.farmId, landUnitId: camp.id }));

      const [row] = await elevated.db
        .select({ hectares: landUnits.hectares })
        .from(landUnits)
        .where(eq(landUnits.id, camp.id));
      expect(Number(row!.hectares)).toBe(40);
    });

    it('will not let a client send a shape at all — the ring is derived from the corners', async () => {
      // An assertion that CAN fail: restore `boundaryGeojson` to the request schema and this reds.
      // Without it, "the shape never crosses the wire" is a claim in a comment.
      const parsed = schemas.recordBoundaryWalkRequestSchema.parse({
        id: uuidv7(),
        farmId: randomUUID(),
        landUnitId: randomUUID(),
        occurredAt: '2026-03-02T04:10:00Z',
        corners: BOX,
        boundaryGeojson: SQUARE,
        areaHectares: 9999,
      });

      expect('boundaryGeojson' in parsed).toBe(false);
      expect('areaHectares' in parsed).toBe(false);
    });

    it('keeps one farm’s boundary invisible to another', async () => {
      const a = await tenant('Land');
      const b = await tenant('Other');
      const campId = await campFor(a);
      await service.recordBoundaryWalk(a.userId, walk({ farmId: a.farmId, landUnitId: campId }));

      const seenByB = await service.listLandUnits(b.userId, b.farmId);
      expect(seenByB).toHaveLength(0);
    });
  });
});
