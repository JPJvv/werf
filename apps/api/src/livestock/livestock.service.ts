/**
 * Livestock capture: the server-side write path for the things a farmer records in the field
 * (Phase 2). Four captures land here today — an animal (the herd row), and three append-only
 * `events`: a weight (FR-140), a death (FR-105) and a sale (FR-106). They are the server end of
 * the best-effort flush the client runs on reconnect, so the offline captures finally reach
 * Postgres ahead of the Phase 3 sync engine.
 *
 * Where the work actually happens: the pure domain functions (@werf/domain) build and validate
 * each event; this service only supplies the I/O they cannot — the authenticated author, the
 * RLS-bound insert, and the animal-status lookup a lifecycle guard needs. Everything runs
 * through `AppDb.asUser`, so a bug in this file still cannot write to another farm: the WITH
 * CHECK policy refuses an insert whose farm_id is not one of the caller's, exactly as the
 * tenancy tests prove. The membership check here is not the security boundary — RLS is — it
 * exists to turn "not your farm" into a clean 404 and "wrong role" into a 403.
 *
 * Every write is IDEMPOTENT on the client-generated id (`onConflictDoNothing`, then read the
 * existing row back). The flush is at-least-once — a POST whose 201 is lost on the way home is
 * retried on the next reconnect — and re-sending an already-stored capture must be a no-op, not
 * a duplicate row or a primary-key crash. The event log stays append-only; a re-flush changes
 * nothing.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, lte, or, type SQL } from 'drizzle-orm';
import {
  animalIdentifiers,
  animals,
  brandingRegisters,
  events,
  farms,
  mobs,
  theftIncidentAnimals,
  theftIncidents,
  veterinaryProducts,
  type AppDb,
} from '@werf/db';
import { ConflictError, NotFoundError, ValidationError, type schemas } from '@werf/core';
import {
  assembleEvidencePack,
  isWithinWithdrawal,
  projectHeadCount,
  recordBirth,
  recordDeath,
  recordDip,
  recordMissing,
  recordMobTally,
  recordMove,
  recordPurchase,
  recordSale,
  recordTreatment,
  recordVaccination,
  recordWeaning,
  recordWeight,
  validateAttributes,
} from '@werf/domain';
import { APP_DB } from '../db/db.module';
import {
  assertCanCapture,
  assertOwnedReferences,
  findEvent,
  herdOfSubject,
  insertEvent,
  type CaptureTx,
  type CapturedEvent,
} from '../common/event-capture';
import { farmLocalDay } from '../common/farm-time';

/** The `theft_incidents` columns returned to the caller — every column EXCEPT the PostGIS
 *  `last_seen_location`, which is geometry (neverSyncColumns) and never goes on the wire. */
const theftIncidentProjection = {
  id: theftIncidents.id,
  farmId: theftIncidents.farmId,
  discoveredAt: theftIncidents.discoveredAt,
  lastSeenAt: theftIncidents.lastSeenAt,
  lastSeenLocationGeojson: theftIncidents.lastSeenLocationGeojson,
  landUnitId: theftIncidents.landUnitId,
  headCount: theftIncidents.headCount,
  caseNumber: theftIncidents.caseNumber,
  reportingStation: theftIncidents.reportingStation,
  status: theftIncidents.status,
  observations: theftIncidents.observations,
  evidencePackKey: theftIncidents.evidencePackKey,
  createdBy: theftIncidents.createdBy,
  updatedBy: theftIncidents.updatedBy,
  createdAt: theftIncidents.createdAt,
  updatedAt: theftIncidents.updatedAt,
  deletedAt: theftIncidents.deletedAt,
} as const;

/** Postgres' unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505';

/**
 * Turns the live-rows-only unique violation on (farm_id, type, value) into a ConflictError a farmer
 * can act on. Anything else is rethrown untouched: swallowing an unexpected database error here
 * would turn a real failure into a silent success, and the flush would mark the capture sent when
 * it was not.
 */
function rethrowDuplicateIdentifier(value: string) {
  return (error: unknown): never => {
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === UNIQUE_VIOLATION &&
      String((error as { constraint?: unknown }).constraint ?? '').includes('animal_identifiers')
    ) {
      throw new ConflictError(
        `${value} is already on another animal on this farm. Check the number, or retire the old tag first.`,
      );
    }
    throw error;
  };
}

/** The persisted animal as returned to the caller. */
export type CapturedAnimal = Awaited<ReturnType<LivestockService['recordAnimal']>>;
/** The persisted mob as returned to the caller. */
export type CapturedMob = Awaited<ReturnType<LivestockService['recordMob']>>;
/** The persisted identifier as returned to the caller. */
export type CapturedIdentifier = Awaited<ReturnType<LivestockService['recordIdentifier']>>;
export type { CapturedEvent };
/** The persisted theft incident — the PostGIS `last_seen_location` column is never on the wire. */
export type CapturedTheftIncident = Awaited<ReturnType<LivestockService['createTheftIncident']>>;

@Injectable()
export class LivestockService {
  constructor(@Inject(APP_DB) private readonly app: AppDb) {}

  /**
   * Creates an animal (FR-101) as a herd row. This is the FK root the flush sends FIRST: a
   * weight, death or sale event references `animals(id)`, so an event that arrived before its
   * animal would fail the foreign key against a row Postgres has never seen. The body is the
   * client's own `newAnimal` shape — its UUIDv7 id and every field it captured offline; the
   * author is the session, never the body.
   */
  async recordAnimal(
    userId: string,
    input: schemas.RecordAnimalRequest,
  ): Promise<typeof animals.$inferSelect> {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      // Everything this animal POINTS AT must be on the same farm. The foreign keys do not check
      // that and RLS cannot — see `assertOwnedReferences`.
      await assertOwnedReferences(tx, input.farmId, {
        landUnitId: input.landUnitId,
        mobId: input.mobId,
        damId: input.damId,
        sireId: input.sireId,
        enterpriseId: input.enterpriseId,
        brandId: input.brandId,
      });

      const [row] = await tx
        .insert(animals)
        .values({
          id: input.id,
          farmId: input.farmId,
          enterpriseId: input.enterpriseId,
          species: input.species,
          breed: input.breed,
          sex: input.sex,
          dob: input.dob,
          dobEstimated: input.dobEstimated,
          status: input.status,
          statusAt: input.statusAt,
          damId: input.damId,
          sireId: input.sireId,
          mobId: input.mobId,
          landUnitId: input.landUnitId,
          source: input.source,
          acquiredAt: input.acquiredAt,
          brandId: input.brandId,
          brandAppliedAt: input.brandAppliedAt,
          // FR-107. Checked HERE rather than in the wire schema, because the rule is per SPECIES
          // and a Zod object cannot know the species until the whole body is parsed. A `woolClass`
          // on a cow is refused rather than stored: it means a screen or an importer has gone
          // wrong, and finding it in the data six months later is finding it too late.
          attributes: validateAttributes(input.species, input.attributes),
          photoKey: input.photoKey,
          createdBy: userId,
        })
        // Idempotent: a re-flush of an already-stored animal is a no-op, not a PK crash.
        .onConflictDoNothing({ target: animals.id })
        .returning();

      if (row) return row;

      // The row was already here (a retried flush). Read it back through the farm's RLS scope.
      const [existing] = await tx
        .select()
        .from(animals)
        .where(and(eq(animals.id, input.id), eq(animals.farmId, input.farmId)));
      return existing!;
    });
  }

  /**
   * Creates a mob / flock (FR-102) — the GROUP-ONLY model, and the one most South African
   * smallholders actually need. "Flock A: 300 head" is a complete, valid record with zero `animals`
   * rows behind it: a farmer with 300 sheep does not have 300 ear tags, and demanding individual
   * rows before the app is useful is how a product loses the user it was built for. The head count
   * feeds the live total exactly as individual animals do (FR-705).
   *
   * Idempotent on the client-generated id, and its camp must be on this farm.
   */
  async recordMob(userId: string, input: schemas.NewMob) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      await assertOwnedReferences(tx, input.farmId, {
        landUnitId: input.landUnitId,
        enterpriseId: input.enterpriseId,
      });

      const [row] = await tx
        .insert(mobs)
        .values({
          id: input.id,
          farmId: input.farmId,
          enterpriseId: input.enterpriseId,
          name: input.name,
          species: input.species,
          landUnitId: input.landUnitId,
          headCount: input.headCount,
          // The baseline the tally fold starts from (FR-102). Written once, here, and never again:
          // `head_count` moves with the log while this stays as first recorded, which is what lets
          // the server and an offline client derive the same number from the same events.
          initialHeadCount: input.headCount,
          createdBy: userId,
        })
        .onConflictDoNothing({ target: mobs.id })
        .returning();

      if (row) return row;

      const [existing] = await tx
        .select()
        .from(mobs)
        .where(and(eq(mobs.id, input.id), eq(mobs.farmId, input.farmId)));
      return existing!;
    });
  }

  /**
   * Changes a mob's head count, with a reason (FR-102) — the capture that was missing, and the
   * reason a 300-head flock could never become 297 by any path in the product. A death and a sale
   * are both recorded against an `animals.id`; a group-only mob has none.
   *
   * ⭐ Idempotency is checked BEFORE anything is validated or applied, for the reason `findEvent`
   * exists: this capture CHANGES THE STATE ITS OWN VALIDATION READS. The flush is at-least-once, so
   * a 201 lost on the way home is retried — and re-applying the delta would take the same three
   * dead ewes off the flock twice, on a re-send of a write that already succeeded.
   *
   * ⭐ The stored count is RE-DERIVED from the whole tally log, not stepped by this event's delta.
   * Incremental application is order-dependent and this product syncs out of order by design: a
   * recount that arrives before an older lambing from a second phone would otherwise be overwritten
   * by arithmetic it was meant to correct. The fold is the same `projectHeadCount` the client runs,
   * over the same baseline and — this is the part that actually makes it true — over the same TOTAL
   * ORDER. `occurred_at` alone is not one: the capture screen stamps every tally on a day with the
   * same instant, so ties are ordinary, and a fold containing a recount does not commute. The query
   * below orders by `(occurred_at, id)` and `projectHeadCount` sorts by the same pair, so the two
   * sides cannot disagree. Ordering by `occurred_at` alone left the result at the mercy of the query
   * plan on one side and the capture-store append order on the other.
   */
  async recordMobTally(userId: string, input: schemas.RecordMobTallyRequest) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);

      const already = await findEvent(tx, input.farmId, input.id);
      if (already) return already;

      const [mob] = await tx
        .select({
          headCount: mobs.headCount,
          initialHeadCount: mobs.initialHeadCount,
          enterpriseId: mobs.enterpriseId,
        })
        .from(mobs)
        .where(
          and(eq(mobs.id, input.mobId), eq(mobs.farmId, input.farmId), isNull(mobs.deletedAt)),
        );
      // Another farm's mob is invisible through the RLS-bound connection and reads as "not found",
      // the same answer as one that does not exist.
      if (!mob) throw new NotFoundError('Mob not found');

      // ⭐ The domain validates against the count AS AT `occurredAt`, not against the mob's current
      // row, and the difference is the whole offline case. Arrival order is not `occurred_at` order
      // here: a phone out of signal for a week syncs captures older than ones already stored. A
      // farmer who recorded "five died on the 18th" while the flock still stood at 300 must not
      // have that refused because another device has since sold all 300 — the capture is true, it
      // is simply late. Validating against the CURRENT count refuses it with a 400, which the
      // outbox sets aside permanently (FR-009), so an honest record of five dead sheep would be
      // lost to an accident of sync order.
      //
      // Folding to the instant answers the question the farmer was actually asked — "could five
      // leave the flock as it stood that day?" — and it is the same fold the row is written from,
      // so validation and projection cannot disagree about what the log says.
      // ⭐ FR-131 on the group path. A tally of `sale` or `slaughter` puts head into the food chain
      // exactly as an individual sale does, and until this line nothing checked the withdrawal for
      // it — so a plunge-dipped flock could be tallied to the abattoir the next day with no refusal
      // anywhere. The individual path has been guarded since the health slice; the group-only path,
      // which is how most South African smallholders run stock, was not.
      if (input.reason === 'sale' || input.reason === 'slaughter') {
        await assertMobClearOfMeatWithdrawal(tx, input.farmId, input.mobId, input.occurredAt);
      }

      const headAsAt = await deriveHeadCount(
        tx,
        input.farmId,
        input.mobId,
        mob.initialHeadCount,
        input.occurredAt,
      );

      const { event } = recordMobTally({
        id: input.id,
        farmId: input.farmId,
        mobId: input.mobId,
        occurredAt: input.occurredAt,
        reason: input.reason,
        count: input.count,
        currentHead: headAsAt,
        counterparty: input.counterparty,
        priceCents: input.priceCents,
        // FR-113: filed under the mob's own herd, derived here rather than trusted from the body.
        enterpriseId: mob.enterpriseId ?? input.enterpriseId,
        locationGeojson: input.locationGeojson,
        notes: input.notes,
        createdBy: userId,
      });

      const stored = await insertEvent(tx, event);

      await tx
        .update(mobs)
        .set({
          headCount: await deriveHeadCount(tx, input.farmId, input.mobId, mob.initialHeadCount),
          updatedBy: userId,
        })
        .where(and(eq(mobs.id, input.mobId), eq(mobs.farmId, input.farmId)));

      return stored;
    });
  }

  /**
   * Attaches an identifier to an animal (FR-109) — the ear tag, EID, tattoo or national id a
   * farmer actually calls the animal by. Many per animal, because an animal genuinely carries
   * several at once and any of them may be the one read in a crush.
   *
   * The uniqueness rule is the sharp part, and it is a PARTIAL unique index: unique per farm per
   * type among LIVE rows only, so a tag can be reissued once the animal carrying it is gone and its
   * identifier tombstoned. A collision is therefore not a retry — it means this number is currently
   * on a different animal — and it is refused with a message that says so, because in a crush the
   * cause is almost always a misread digit, and silently moving a tag between animals would corrupt
   * the identity chain an evidence pack and an export audit both rest on.
   */
  async recordIdentifier(userId: string, input: schemas.NewAnimalIdentifier) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      // The subject must be an animal this farm can see; another farm's animal is "not found",
      // indistinguishable from one that does not exist.
      await animalFacts(tx, input.farmId, input.animalId);

      const [row] = await tx
        .insert(animalIdentifiers)
        .values({
          id: input.id,
          farmId: input.farmId,
          animalId: input.animalId,
          type: input.type,
          value: input.value,
          isPrimary: input.isPrimary,
          appliedAt: input.appliedAt,
          createdBy: userId,
        })
        // Idempotent on the id ONLY — a bare onConflictDoNothing() would also swallow a genuine
        // duplicate VALUE, and the read-back would then return nothing for this id.
        .onConflictDoNothing({ target: animalIdentifiers.id })
        .returning()
        .catch(rethrowDuplicateIdentifier(input.value));

      if (row) return row;

      const [existing] = await tx
        .select()
        .from(animalIdentifiers)
        .where(and(eq(animalIdentifiers.id, input.id), eq(animalIdentifiers.farmId, input.farmId)));
      return existing!;
    });
  }

  /**
   * Records a weight reading (FR-140) as an append-only `events` row. Returns the persisted
   * event; the caller reads `occurredAt` (farm time) and `createdAt` (row written) as the two
   * distinct clocks the schema keeps apart.
   */
  async recordWeight(userId: string, input: schemas.RecordWeightRequest) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);

      // Pure domain: builds the envelope, validates the payload, enforces animal-xor-mob.
      const event = recordWeight({
        id: input.id,
        farmId: input.farmId,
        animalId: input.animalId,
        mobId: input.mobId,
        occurredAt: input.occurredAt,
        kg: input.kg,
        method: input.method,
        enterpriseId: (await herdOfSubject(tx, input.farmId, input)) ?? input.enterpriseId,
        batchId: input.batchId,
        locationGeojson: input.locationGeojson,
        notes: input.notes,
        createdBy: userId,
      });

      return insertEvent(tx, event);
    });
  }

  /**
   * Records a move (FR-103) — an animal walked to another camp and/or another mob.
   *
   * Two writes in one transaction, and they are NOT the same fact. The `move` event is the history:
   * append-only, holding the before AND after of both dimensions, and it is what a grazing rotation
   * or a stock-theft trail is read from. The animal row's `land_unit_id` / `mob_id` are a
   * DENORMALISED "where is it now", overwritten each time — the position, not the record of how it
   * got there (database-schema.md § 4). Losing the distinction is how a movement history quietly
   * becomes a single current value.
   *
   * The FROM side is read from the animal's own row here, never taken from the request: the animal
   * already knows where it is, and letting the client restate it only creates a way for the stored
   * history to disagree with reality.
   */
  async recordMove(userId: string, input: schemas.RecordMoveRequest) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);

      // Idempotency is checked FIRST here, unlike the append-only captures. A move overwrites the
      // animal's position, so on a retry the animal is already at the destination and the domain
      // would correctly refuse "a move that changes nothing" — jamming the queue behind a write
      // that actually succeeded. See `findEvent`.
      const already = await findEvent(tx, input.farmId, input.id);
      if (already) return already;

      // The destination must be on this farm — the foreign keys do not check that (see
      // `assertOwnedReferences`), and "walk the herd into the neighbour's camp" is not a move.
      await assertOwnedReferences(tx, input.farmId, {
        landUnitId: input.toLandUnitId,
        mobId: input.toMobId,
      });

      const [current] = await tx
        .select({
          status: animals.status,
          enterpriseId: animals.enterpriseId,
          landUnitId: animals.landUnitId,
          mobId: animals.mobId,
        })
        .from(animals)
        .where(
          and(
            eq(animals.id, input.animalId),
            eq(animals.farmId, input.farmId),
            isNull(animals.deletedAt),
          ),
        );
      if (!current) throw new NotFoundError('Animal not found');

      const { event, animalChange } = recordMove({
        id: input.id,
        farmId: input.farmId,
        animalId: input.animalId,
        occurredAt: input.occurredAt,
        currentStatus: current.status,
        enterpriseId: current.enterpriseId,
        fromLandUnitId: current.landUnitId,
        fromMobId: current.mobId,
        // Omit vs null is load-bearing all the way down: spreading an undefined key would make the
        // domain read it as "unchanged", which is what we want, but only if it is genuinely absent.
        ...(input.toLandUnitId === undefined ? {} : { toLandUnitId: input.toLandUnitId }),
        ...(input.toMobId === undefined ? {} : { toMobId: input.toMobId }),
        batchId: input.batchId,
        locationGeojson: input.locationGeojson,
        notes: input.notes,
        createdBy: userId,
      });

      const stored = await insertEvent(tx, event);

      // The denormalised position follows the history, not the other way round.
      await tx
        .update(animals)
        .set({
          landUnitId: animalChange.landUnitId,
          mobId: animalChange.mobId,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(and(eq(animals.id, input.animalId), eq(animals.farmId, input.farmId)));

      return stored;
    });
  }

  /**
   * Records a death (FR-105) as an append-only `events` row. The animal's current status is
   * read (RLS-scoped) so the domain state machine can guard the transition to 'dead'; a death
   * of an animal this farm cannot see is a 404. The event is the durable fact — materialising
   * the animal row's status from the event log is a Phase 3 read-model concern, exactly as the
   * client projects status rather than editing the append-only herd row.
   */
  async recordDeath(userId: string, input: schemas.RecordDeathRequest) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      const { status: currentStatus, enterpriseId } = await animalFacts(
        tx,
        input.farmId,
        input.animalId,
      );

      const base = {
        id: input.id,
        farmId: input.farmId,
        animalId: input.animalId,
        occurredAt: input.occurredAt,
        currentStatus,
        enterpriseId,
        cause: input.cause,
        createdBy: userId,
      };
      const { event } = recordDeath(
        input.disposal === undefined ? base : { ...base, disposal: input.disposal },
      );

      return insertEvent(tx, event);
    });
  }

  /**
   * Records a birth (FR-104) against the DAM — her timeline is where a calving belongs. The calf's
   * `animals` row is created through the ordinary create-animal path (the flush sends animals before
   * events, so it is already here); this event ties the two together and carries the calving facts.
   * The calf is checked to be on this farm for the same reason every reference is.
   */
  async recordBirth(userId: string, input: schemas.RecordBirthRequest) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      await assertOwnedReferences(tx, input.farmId, {
        calfId: input.calfId,
        ...(input.sireId === undefined ? {} : { sireId: input.sireId }),
      });
      const { status: currentStatus, enterpriseId } = await animalFacts(
        tx,
        input.farmId,
        input.animalId,
      );

      const base = {
        id: input.id,
        farmId: input.farmId,
        animalId: input.animalId,
        occurredAt: input.occurredAt,
        currentStatus,
        enterpriseId,
        calfId: input.calfId,
        easeScore: input.easeScore,
        multiples: input.multiples,
        createdBy: userId,
      };
      const { event } = recordBirth({
        ...base,
        ...(input.sireId === undefined ? {} : { sireId: input.sireId }),
        ...(input.birthWeightKg === undefined ? {} : { birthWeightKg: input.birthWeightKg }),
      });

      return insertEvent(tx, event);
    });
  }

  /** Records a weaning (FR-111): the weight at weaning and, if known, the age. No status change. */
  async recordWeaning(userId: string, input: schemas.RecordWeaningRequest) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      const { status: currentStatus, enterpriseId } = await animalFacts(
        tx,
        input.farmId,
        input.animalId,
      );

      const base = {
        id: input.id,
        farmId: input.farmId,
        animalId: input.animalId,
        occurredAt: input.occurredAt,
        currentStatus,
        enterpriseId,
        weightKg: input.weightKg,
        createdBy: userId,
      };
      const { event } = recordWeaning(
        input.ageDays === undefined ? base : { ...base, ageDays: input.ageDays },
      );

      return insertEvent(tx, event);
    });
  }

  /**
   * Records a purchase (FR-106) — an acquisition against an animal already in the herd. Unlike a
   * sale it changes nothing about the animal's status: it arrived alive and stays alive. The money
   * uses the same `trade` payload as a sale, so buying and selling cannot drift apart.
   */
  async recordPurchase(userId: string, input: schemas.RecordPurchaseRequest) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      const { status: currentStatus, enterpriseId } = await animalFacts(
        tx,
        input.farmId,
        input.animalId,
      );

      const base = {
        id: input.id,
        farmId: input.farmId,
        animalId: input.animalId,
        occurredAt: input.occurredAt,
        currentStatus,
        enterpriseId,
        counterparty: input.counterparty,
        priceCents: input.priceCents,
        createdBy: userId,
      };
      const { event } = recordPurchase(
        input.weightKg === undefined ? base : { ...base, weightKg: input.weightKg },
      );

      return insertEvent(tx, event);
    });
  }

  /**
   * Marks an animal missing (FR-605) — COMPLIANCE-GATED. Status → 'missing', timestamped by
   * `occurredAt` (when it was LAST SEEN, which is days before this is captured) and anchored to the
   * point it was last seen. The location is required by the contract, not merely encouraged: it is
   * the field the stock-theft evidence pack is built around, and a missing report without it is of
   * little use to the SAPS Stock Theft Unit.
   *
   * 'missing' is more final than 'alive' but less than sold or dead, so a sold animal cannot be
   * reported missing — the state machine says so, and that refusal is the point.
   */
  async recordMissing(userId: string, input: schemas.RecordMissingRequest) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      const { status: currentStatus, enterpriseId } = await animalFacts(
        tx,
        input.farmId,
        input.animalId,
      );

      const base = {
        id: input.id,
        farmId: input.farmId,
        animalId: input.animalId,
        occurredAt: input.occurredAt,
        currentStatus,
        enterpriseId,
        lastSeenGeojson: input.lastSeenGeojson,
        createdBy: userId,
      };
      const { event } = recordMissing(
        input.cause === undefined ? base : { ...base, cause: input.cause },
      );

      return insertEvent(tx, event);
    });
  }

  /**
   * Records a sale (FR-106) as an append-only `events` row. As with a death, the animal's
   * current status is read so the state machine can guard the transition to 'sold'. `priceCents`
   * is Money — integer cents, validated by the domain, never a float.
   */
  async recordSale(userId: string, input: schemas.RecordSaleRequest) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      const { status: currentStatus, enterpriseId } = await animalFacts(
        tx,
        input.farmId,
        input.animalId,
      );
      // FR-131: a meat sale within an active withdrawal is blocked at capture. The clear date was
      // computed and stored on the treatment event AT THE TIME OF TREATMENT (ADR-0005), so this
      // reads the rule that applied then, not today's registration.
      await assertClearOfMeatWithdrawal(tx, input.farmId, input.animalId, input.occurredAt);

      const base = {
        id: input.id,
        farmId: input.farmId,
        animalId: input.animalId,
        occurredAt: input.occurredAt,
        currentStatus,
        enterpriseId,
        counterparty: input.counterparty,
        priceCents: input.priceCents,
        createdBy: userId,
      };
      const { event } = recordSale(
        input.weightKg === undefined ? base : { ...base, weightKg: input.weightKg },
      );

      return insertEvent(tx, event);
    });
  }

  /**
   * Records a treatment (FR-130/131) — COMPLIANCE-GATED. The withdrawal period is NOT taken from the
   * request: the server resolves the selected veterinary product (by the FARM's jurisdiction, so a
   * ZA farm uses ZA registrations) and injects its registered meat/milk withdrawal into the pure
   * domain, which computes the clear dates from the treatment day and stores them ON the event. The
   * rule that applied is the rule at the time of treatment (ADR-0005): a later re-registration cannot
   * move this animal in or out of a withholding period, because the dates are already fixed here.
   */
  async recordTreatment(userId: string, input: schemas.RecordTreatmentRequest) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      const product = await resolveVetProduct(
        tx,
        input.farmId,
        input.productId,
        input.administeredOn,
      );

      const event = recordTreatment({
        ...healthBaseInput(userId, input, product, await herdOfSubject(tx, input.farmId, input)),
        ...(input.batch === undefined ? {} : { batch: input.batch }),
        ...(input.doseValue === undefined ? {} : { doseValue: input.doseValue }),
        ...(input.doseUnit === undefined ? {} : { doseUnit: input.doseUnit }),
        ...(input.route === undefined ? {} : { route: input.route }),
        ...(input.administeredBy === undefined ? {} : { administeredBy: input.administeredBy }),
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      });

      return insertEvent(tx, event);
    });
  }

  /**
   * Records a vaccination (FR-132). Same withdrawal discipline as a treatment — many vaccines carry
   * no withdrawal, in which case the resolved product has null periods and no clear date is stored.
   */
  async recordVaccination(userId: string, input: schemas.RecordVaccinationRequest) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      const product = await resolveVetProduct(
        tx,
        input.farmId,
        input.productId,
        input.administeredOn,
      );

      const event = recordVaccination({
        ...healthBaseInput(userId, input, product, await herdOfSubject(tx, input.farmId, input)),
        ...(input.programme === undefined ? {} : { programme: input.programme }),
        ...(input.batch === undefined ? {} : { batch: input.batch }),
        ...(input.administeredBy === undefined ? {} : { administeredBy: input.administeredBy }),
      });

      return insertEvent(tx, event);
    });
  }

  /**
   * Records a dip / tick treatment (FR-133), required in controlled areas (Animal Diseases Act 35 of
   * 1984). Same withdrawal discipline as a treatment.
   */
  async recordDip(userId: string, input: schemas.RecordDipRequest) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      const product = await resolveVetProduct(
        tx,
        input.farmId,
        input.productId,
        input.administeredOn,
      );

      const event = recordDip({
        ...healthBaseInput(userId, input, product, await herdOfSubject(tx, input.farmId, input)),
        ...(input.method === undefined ? {} : { method: input.method }),
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      });

      return insertEvent(tx, event);
    });
  }

  /**
   * Creates a stock-theft incident (FR-603/605) and links the animals it concerns. The farmer
   * captures this in the field, at the last-seen location, offline — so it is idempotent on the id
   * like every other capture. Every animal linked must be on THIS farm (checked RLS-scoped): an
   * evidence pack must never claim ownership of another farm's animal. There is no suspect field to
   * write. The PostGIS `last_seen_location` is never returned on the wire.
   */
  async createTheftIncident(userId: string, input: schemas.NewTheftIncident) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      // The camp the loss is pinned to must be this farm's. The animal links below are already
      // checked; this reference was not, and an evidence pack that names a neighbour's camp as the
      // scene is worse than one that names none.
      await assertOwnedReferences(tx, input.farmId, { landUnitId: input.landUnitId });

      if (input.animalIds.length > 0) {
        const found = await tx
          .select({ id: animals.id })
          .from(animals)
          .where(
            and(
              eq(animals.farmId, input.farmId),
              inArray(animals.id, input.animalIds),
              isNull(animals.deletedAt),
            ),
          );
        if (found.length !== new Set(input.animalIds).size) {
          throw new NotFoundError('One or more animals were not found on this farm');
        }
      }

      const [row] = await tx
        .insert(theftIncidents)
        .values({
          id: input.id,
          farmId: input.farmId,
          discoveredAt: input.discoveredAt,
          lastSeenAt: input.lastSeenAt,
          lastSeenLocationGeojson: input.lastSeenLocationGeojson,
          landUnitId: input.landUnitId,
          headCount: input.headCount,
          caseNumber: input.caseNumber,
          reportingStation: input.reportingStation,
          observations: input.observations,
          // Who filed it, from the session and never the body. Part of the evidence, not metadata.
          createdBy: userId,
        })
        .onConflictDoNothing({ target: theftIncidents.id })
        .returning(theftIncidentProjection);

      const incident =
        row ??
        (
          await tx
            .select(theftIncidentProjection)
            .from(theftIncidents)
            .where(and(eq(theftIncidents.id, input.id), eq(theftIncidents.farmId, input.farmId)))
        )[0]!;

      if (input.animalIds.length > 0) {
        await tx
          .insert(theftIncidentAnimals)
          .values(
            input.animalIds.map((animalId) => ({
              farmId: input.farmId,
              incidentId: input.id,
              animalId,
            })),
          )
          .onConflictDoNothing();
      }

      return incident;
    });
  }

  /**
   * Assembles the facts-only evidence pack for an incident (FR-603): the identification, ownership
   * chain, brand certificate, last-seen GPS + timestamp for each animal it concerns. Everything is
   * read through the RLS-bound connection, so an incident (or an animal) on another farm is invisible
   * and reads as "not found". The controller renders the returned pack to a PDF; keeping the assembly
   * here and the rendering at the edge means the FACTS are one pure, validated object with no suspect
   * field, however they are later drawn.
   */
  async buildEvidencePack(userId: string, incidentId: string): Promise<schemas.EvidencePack> {
    return this.app.asUser(userId, async (tx) => {
      const [incident] = await tx
        .select(theftIncidentProjection)
        .from(theftIncidents)
        .where(and(eq(theftIncidents.id, incidentId), isNull(theftIncidents.deletedAt)));
      if (!incident) throw new NotFoundError('Theft incident not found');
      const farmId = incident.farmId;

      // The linked animals, joined to their herd row (ownership facts) and their registered mark.
      // The join insists on the same farm, so a foreign animal — even if a link row pointed at one —
      // never contributes its data.
      const animalRows = await tx
        .select({
          animalId: animals.id,
          photoKey: animals.photoKey,
          acquiredAt: animals.acquiredAt,
          source: animals.source,
          mark: brandingRegisters.mark,
          certificateReference: brandingRegisters.certificateReference,
        })
        .from(theftIncidentAnimals)
        .innerJoin(
          animals,
          and(
            eq(animals.id, theftIncidentAnimals.animalId),
            eq(animals.farmId, theftIncidentAnimals.farmId),
          ),
        )
        // The brand join carries the same farm predicate as the animals join above it. Without it
        // a mark registered to another farm would print on this farm's evidence pack as its own
        // ownership claim — the one fact in the pack a Stock Theft Unit relies on most.
        .leftJoin(
          brandingRegisters,
          and(
            eq(brandingRegisters.id, animals.brandId),
            eq(brandingRegisters.farmId, animals.farmId),
          ),
        )
        .where(
          and(
            eq(theftIncidentAnimals.incidentId, incidentId),
            eq(theftIncidentAnimals.farmId, farmId),
          ),
        );

      const animalIds = animalRows.map((r) => r.animalId);
      const identifierRows =
        animalIds.length === 0
          ? []
          : await tx
              .select({
                animalId: animalIdentifiers.animalId,
                type: animalIdentifiers.type,
                value: animalIdentifiers.value,
              })
              .from(animalIdentifiers)
              .where(
                and(
                  eq(animalIdentifiers.farmId, farmId),
                  inArray(animalIdentifiers.animalId, animalIds),
                  isNull(animalIdentifiers.deletedAt),
                ),
              );

      const identifiersByAnimal = new Map<string, { type: string; value: string }[]>();
      for (const row of identifierRows) {
        const list = identifiersByAnimal.get(row.animalId) ?? [];
        list.push({ type: row.type, value: row.value });
        identifiersByAnimal.set(row.animalId, list);
      }

      // The ownership proof is the registered brand certificate the stolen stock carried — the first
      // one present among the linked animals (the common case is a single farm mark).
      const brandCertificateReference =
        animalRows.map((r) => r.certificateReference).find((ref) => ref !== null) ?? null;

      return assembleEvidencePack({
        farmId,
        discoveredAt: incident.discoveredAt,
        lastSeenAt: incident.lastSeenAt,
        lastSeenLocationGeojson: incident.lastSeenLocationGeojson,
        headCount: incident.headCount,
        brandCertificateReference,
        observations: incident.observations,
        caseNumber: incident.caseNumber,
        reportingStation: incident.reportingStation,
        animals: animalRows.map((r) => ({
          animalId: r.animalId,
          identifiers: identifiersByAnimal.get(r.animalId) ?? [],
          mark: r.mark ?? null,
          photoKey: r.photoKey,
          acquiredAt: r.acquiredAt,
          source: r.source,
        })),
      });
    });
  }
}

/**
 * The current status of an animal on this farm, through the RLS-bound connection — so an animal
 * on another farm is invisible and reads as "not found", indistinguishable from one that does
 * not exist. Two facts in one query: the status a lifecycle event needs as the FROM side of the
 * state-machine transition guard, and the herd the animal is in, which the event is filed under
 * (FR-113) — stamped from the animal's row at capture, never restated by the client.
 */
async function animalFacts(
  tx: CaptureTx,
  farmId: string,
  animalId: string,
): Promise<{ status: schemas.Animal['status']; enterpriseId: string | null }> {
  const [row] = await tx
    .select({ status: animals.status, enterpriseId: animals.enterpriseId })
    .from(animals)
    .where(and(eq(animals.id, animalId), eq(animals.farmId, farmId), isNull(animals.deletedAt)));
  if (!row) throw new NotFoundError('Animal not found');
  return row;
}

type VetProduct = typeof veterinaryProducts.$inferSelect;
type HealthRequest =
  schemas.RecordTreatmentRequest | schemas.RecordVaccinationRequest | schemas.RecordDipRequest;

/**
 * The registered veterinary product a health event used, resolved by the FARM's jurisdiction AND the
 * registration in force ON THE TREATMENT DAY — the source the withdrawal period is injected FROM,
 * never a number in code (FR-131). Reference data is world-readable to any app connection, so we
 * still scope by jurisdiction: a ZA farm resolves ZA registrations and cannot borrow another
 * country's (possibly shorter) withdrawal. And because the table is date-versioned (a re-registration
 * writes a new row and closes the old one's `effective_to`), we resolve the version whose
 * `[effective_from, effective_to)` window contains `administeredOn` — the rule that applied at the
 * time of treatment (ADR-0005), not whichever version a client happened to name. An unknown product,
 * one in another jurisdiction, or one not yet / no longer in force on that day reads as "not found".
 */
async function resolveVetProduct(
  tx: CaptureTx,
  farmId: string,
  productId: string,
  administeredOn: string,
): Promise<VetProduct> {
  const jurisdiction = await farmJurisdiction(tx, farmId);
  const [row] = await tx
    .select()
    .from(veterinaryProducts)
    .where(
      and(
        eq(veterinaryProducts.id, productId),
        eq(veterinaryProducts.jurisdiction, jurisdiction),
        lte(veterinaryProducts.effectiveFrom, administeredOn),
        or(
          isNull(veterinaryProducts.effectiveTo),
          gt(veterinaryProducts.effectiveTo, administeredOn),
        ),
      ),
    );
  if (!row) throw new NotFoundError('Veterinary product not found');
  return row;
}

/**
 * A mob's current head count, folded from its whole tally log over the count it was created with
 * (FR-102) — the server half of the projection the offline client runs on the same events.
 *
 * Re-derived rather than stepped, because arrival order is not `occurred_at` order on this product
 * and never will be: a phone out of a signal for a week syncs captures that are older than ones
 * already stored. Reading the log back costs one indexed query per tally and removes a whole class
 * of "the number is wrong and nobody can say why" that an incremental update would create.
 */
async function deriveHeadCount(
  tx: CaptureTx,
  farmId: string,
  mobId: string,
  initialHead: number | null,
  /**
   * Fold only what happened up to and including this instant. Used to validate a capture against
   * the count AS AT the day it describes rather than against today's, so a back-dated tally
   * arriving from a phone that was out of signal is judged on the flock it was actually describing.
   * Omitted for the authoritative write, which folds the entire log.
   */
  asAt?: Date,
): Promise<number | null> {
  const rows = await tx
    .select({ id: events.id, occurredAt: events.occurredAt, payload: events.payload })
    .from(events)
    .where(
      and(
        eq(events.farmId, farmId),
        eq(events.mobId, mobId),
        eq(events.type, 'tally'),
        isNull(events.deletedAt),
        ...(asAt === undefined ? [] : [lte(events.occurredAt, asAt)]),
      ),
    )
    // ⭐ A TOTAL order, and it is load-bearing rather than tidiness. `occurred_at` alone has ties —
    // the capture screen gives every tally on a day the same instant — and a fold containing a
    // recount does not commute, so an unordered scan could store a different count from the one the
    // farmer's phone shows. The id is a client UUIDv7: identical on both sides, and time-ordered,
    // so it breaks the tie in capture order. `projectHeadCount` sorts by the same pair.
    .orderBy(events.occurredAt, events.id);

  return projectHeadCount(
    initialHead,
    rows.map(({ id, occurredAt, payload }) => {
      const p = payload as { reason: schemas.TallyReason; delta?: number; countedHead?: number };
      return {
        id,
        mobId,
        occurredAt: occurredAt.toISOString(),
        reason: p.reason,
        delta: p.delta,
        countedHead: p.countedHead,
      };
    }),
  );
}

/** The law this farm operates under, through the RLS-bound connection. Jurisdiction is the FARM's,
 *  never the user's or the browser's (.claude/rules/domain.md, FR-019). */
async function farmJurisdiction(tx: CaptureTx, farmId: string): Promise<string> {
  const [row] = await tx
    .select({ jurisdiction: farms.jurisdiction })
    .from(farms)
    .where(eq(farms.id, farmId));
  if (!row) throw new NotFoundError('Farm not found');
  return row.jurisdiction;
}

/**
 * FR-131 sale guard: refuses a sale whose farm-local day falls inside an active MEAT withdrawal.
 * It reads the `meatWithholdUntil` dates already stored on the animal's health events (computed at
 * treatment time), takes the latest, and blocks if the sale day is before it. Health events with no
 * meat withdrawal contribute nothing, so an untreated or long-cleared animal sells freely. This is
 * the "block at capture" the compliance spec requires — catching it at slaughter is too late.
 */
async function assertClearOfMeatWithdrawal(
  tx: CaptureTx,
  farmId: string,
  animalId: string,
  occurredAt: Date,
): Promise<void> {
  const latestClear = await latestMeatClearForAnimal(tx, farmId, animalId);
  const saleDay = farmLocalDay(occurredAt, await farmJurisdiction(tx, farmId));
  if (isWithinWithdrawal(latestClear, saleDay)) {
    throw new ValidationError(
      `This animal is within its meat withdrawal period until ${latestClear}; it cannot be sold for slaughter before then`,
    );
  }
}

/**
 * FR-131 group guard: the same rule for a whole-mob disposal (FR-102). A tally of `sale` or
 * `slaughter` takes head OUT of a flock and into the food chain exactly as an individual sale does,
 * and it was doing so with nothing checking the withdrawal at all.
 *
 * ⭐ This is the SMALLHOLDER path, and it was the unguarded one. A group-only flock has no
 * `animals` rows, so every individual guard in this file was structurally incapable of firing for
 * it — dip the flock on Monday, tally forty to the abattoir on Tuesday, and nothing anywhere said
 * no. The farm most likely to run stock as an uncounted mob is also the one least likely to have a
 * second system catching it, so the absence landed hardest where it mattered most.
 */
async function assertMobClearOfMeatWithdrawal(
  tx: CaptureTx,
  farmId: string,
  mobId: string,
  occurredAt: Date,
): Promise<void> {
  const latestClear = await latestMeatClear(tx, farmId, eq(events.mobId, mobId));
  const day = farmLocalDay(occurredAt, await farmJurisdiction(tx, farmId));
  if (isWithinWithdrawal(latestClear, day)) {
    throw new ValidationError(
      `This group is within its meat withdrawal period until ${latestClear}; none of it can go for slaughter or sale before then`,
    );
  }
}

/**
 * The latest meat clear date that applies to ONE animal — from doses given to it directly, and from
 * doses given to a mob WHILE THAT ANIMAL WAS IN IT.
 *
 * ⭐ A dose reaches an animal by two routes and the guard has to read both. A plunge dip or a mob
 * vaccination is captured against the MOB — the API accepts animal-xor-mob on every health capture
 * precisely because that is how dosing actually happens — and writes its `meatWithholdUntil` onto
 * an event with `animal_id = NULL`.
 *
 * ⭐ And membership is read from the append-only MOVE LOG, never from `animals.mob_id`. That column
 * is the denormalised "where is it now", overwritten by every move, so asking it produces the wrong
 * answer in both directions on the most ordinary workflow there is — you dip a mob and then walk
 * the stock out of the dip camp:
 *
 *   • An animal dipped in mob A and since moved to mob B was CLEARED by the old check, because the
 *     dip event names mob A and the animal now names mob B. That is residue reaching the abattoir,
 *     which is the entire thing this gate exists to prevent.
 *   • An animal moved INTO a recently-dipped mob was BLOCKED by it, though it was never dosed —
 *     costing a farmer a sale for no reason, which is how a guard teaches people to distrust it.
 *
 * Reconstructing the intervals fixes both, and it is possible only because `recordMove` stores the
 * before AND after of both dimensions rather than just the destination.
 */
async function latestMeatClearForAnimal(
  tx: CaptureTx,
  farmId: string,
  animalId: string,
): Promise<string | undefined> {
  const wasIn = await mobMembership(tx, farmId, animalId);

  // Every mob the animal has ever been in, so one query fetches the candidates; the interval check
  // below decides which of them were actually its mob on the day of the dose.
  const mobIds = [...new Set(wasIn.map((m) => m.mobId))];
  const subjectFilter =
    mobIds.length === 0
      ? eq(events.animalId, animalId)
      : or(eq(events.animalId, animalId), inArray(events.mobId, mobIds));

  return latestMeatClear(tx, farmId, subjectFilter, (row) => {
    // An animal-subject event is the animal's own dose and always counts. A mob-subject event
    // counts only if the animal was in that mob when it was given.
    if (row.mobId === null) return true;
    return wasIn.some(
      (m) =>
        m.mobId === row.mobId &&
        row.occurredAt >= m.from &&
        (m.to === null || row.occurredAt < m.to),
    );
  });
}

/** One stretch of time during which an animal belonged to a particular mob. `to === null` = still. */
interface MobInterval {
  readonly mobId: string;
  readonly from: Date;
  readonly to: Date | null;
}

/**
 * When an animal was in which mob, reconstructed from its `move` events (FR-103).
 *
 * The move log holds `fromMobId` and `toMobId` on every move, so the whole history is derivable:
 * the mob it was in before the FIRST move is that move's `fromMobId`, and each move closes one
 * interval and opens the next. With no moves at all the animal has been in its current mob for its
 * whole life, which is the common case and costs one extra query rather than a join.
 *
 * The opening interval starts at the epoch rather than at the animal's creation: a dose recorded
 * against a mob before the animal's row was written is still a dose that animal received, and
 * dating the interval from a row's `created_at` would be dating it from when someone got to a
 * phone.
 */
async function mobMembership(
  tx: CaptureTx,
  farmId: string,
  animalId: string,
): Promise<readonly MobInterval[]> {
  const moves = await tx
    .select({ occurredAt: events.occurredAt, payload: events.payload })
    .from(events)
    .where(
      and(
        eq(events.farmId, farmId),
        eq(events.animalId, animalId),
        eq(events.type, 'move'),
        isNull(events.deletedAt),
      ),
    )
    .orderBy(events.occurredAt, events.id);

  if (moves.length === 0) {
    const [row] = await tx
      .select({ mobId: animals.mobId })
      .from(animals)
      .where(and(eq(animals.id, animalId), eq(animals.farmId, farmId)));
    return row?.mobId ? [{ mobId: row.mobId, from: new Date(0), to: null }] : [];
  }

  const intervals: MobInterval[] = [];
  let openMob = (moves[0]!.payload as { fromMobId?: string | null }).fromMobId ?? null;
  let openedAt = new Date(0);

  for (const move of moves) {
    const { fromMobId, toMobId } = move.payload as {
      fromMobId?: string | null;
      toMobId?: string | null;
    };
    // A move that names no mob change leaves the animal where it is — `recordMove` sends only the
    // dimensions that changed, so an absent `toMobId` means "same mob, different camp".
    if (toMobId === undefined) continue;
    if (openMob !== null) {
      intervals.push({ mobId: openMob, from: openedAt, to: move.occurredAt });
    }
    openMob = toMobId ?? (fromMobId === undefined ? openMob : null);
    openedAt = move.occurredAt;
  }
  if (openMob !== null) intervals.push({ mobId: openMob, from: openedAt, to: null });

  return intervals;
}

/**
 * The latest `meatWithholdUntil` across the health events matching `subjectFilter`, optionally
 * narrowed by a predicate the SQL cannot express. Health events with no meat withdrawal contribute
 * nothing, so an untreated or long-cleared subject sells freely.
 */
async function latestMeatClear(
  tx: CaptureTx,
  farmId: string,
  subjectFilter: SQL | undefined,
  applies: (row: { mobId: string | null; occurredAt: Date }) => boolean = () => true,
): Promise<string | undefined> {
  const rows = await tx
    .select({ payload: events.payload, mobId: events.mobId, occurredAt: events.occurredAt })
    .from(events)
    .where(
      and(
        eq(events.farmId, farmId),
        subjectFilter,
        inArray(events.type, ['treatment', 'vaccination', 'dip']),
        isNull(events.deletedAt),
      ),
    );

  let latestClear: string | undefined;
  for (const row of rows) {
    if (!applies(row)) continue;
    const clear = (row.payload as { meatWithholdUntil?: unknown }).meatWithholdUntil;
    if (typeof clear === 'string' && (latestClear === undefined || clear > latestClear)) {
      latestClear = clear;
    }
  }
  return latestClear;
}

/**
 * The fields every health capture shares, with the withdrawal period injected from the resolved
 * product. `product` (the name) and the withdrawal come from the reference row, never the request,
 * so a client cannot claim a shorter withhold by relabelling. The domain computes and stores the
 * clear dates from these — this function supplies the inputs, it does not do the arithmetic.
 */
function healthBaseInput(
  userId: string,
  input: HealthRequest,
  product: VetProduct,
  herdId: string | null,
) {
  return {
    id: input.id,
    farmId: input.farmId,
    animalId: input.animalId,
    mobId: input.mobId,
    occurredAt: input.occurredAt,
    administeredOn: input.administeredOn,
    product: product.name,
    // FR-113: the herd the subject is in, stamped at capture. A herd-wide dose with no individual
    // subject falls back to the enterprise the farmer selected — which the FR-113 guard requires.
    enterpriseId: herdId ?? input.enterpriseId,
    batchId: input.batchId,
    locationGeojson: input.locationGeojson,
    notes: input.notes,
    createdBy: userId,
    ...(product.meatWithdrawalDays === null
      ? {}
      : { meatWithdrawalDays: product.meatWithdrawalDays }),
    // Milk withdrawals are published in HOURS; the domain reasons in calendar days to match a
    // day-grained capture. Round UP so a partial day never under-withholds — milk is never
    // released early. (A 96h withdrawal clears in 4 days; an 84h one conservatively in 4, not 3.)
    ...(product.milkWithdrawalHours === null
      ? {}
      : { milkWithdrawalDays: Math.ceil(product.milkWithdrawalHours / 24) }),
  };
}
