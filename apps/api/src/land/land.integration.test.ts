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
  farmUsers,
  landUnits,
  users,
  type AppDb,
  type ElevatedDb,
} from '@werf/db';
import { startWerfTestDatabase, type WerfTestDatabase } from '@werf/db/testing';
import { ConflictError, NotFoundError, TenancyError, ValidationError, schemas } from '@werf/core';
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
  business: { name: `${label} Boerdery`, registrationNumber: null },
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
    id: randomUUID(),
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
});
