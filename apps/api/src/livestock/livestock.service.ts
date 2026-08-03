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
import { and, desc, eq, gt, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  animalIdentifiers,
  animals,
  brandingRegisters,
  events,
  farms,
  landUnits,
  mobs,
  speciesGestation,
  theftIncidentAnimals,
  theftIncidents,
  veterinaryProducts,
  type AppDb,
} from '@werf/db';
// `schemas` is imported as a VALUE, not just a type: the register below reads `TALLY_DECREASES`
// from it rather than restating which reasons take head out, so the two cannot drift apart.
import { ConflictError, NotFoundError, ValidationError, schemas } from '@werf/core';
import {
  assembleEvidencePack,
  isWithinWithdrawal,
  projectHeadCount,
  recordBirth,
  recordDeath,
  recordDip,
  recordMating,
  recordMissing,
  recordMobTally,
  recordMove,
  recordPregnancyDiagnosis,
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
          //
          // Taken from the COUNT THAT WAS CAPTURED, not from the body's own `initialHeadCount`.
          // The client carries the field too — its local fold needs the same baseline — but the two
          // are set from one number on each side rather than one being asked to restate the other,
          // which is the only way they cannot come to disagree.
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

      // ⭐ A TRANSFER is not a disposal and must not be guarded like one (§2.3b). Splitting a
      // dipped flock between two of your own camps puts nothing into the food chain — it is the
      // ordinary husbandry the sale-out/purchase-in workaround was being used to express, and
      // refusing it is what taught the workaround in the first place.
      //
      // What it MUST do instead is carry the withholding across, and that is the whole difficulty:
      // a counted flock has no `animals` rows, so head that walks out of a dipped mob leaves no
      // per-head record for the destination's guard to find. Forty dipped sheep would become clear
      // by passing through a gate. The source mob's clear date is resolved HERE and frozen onto the
      // event (ADR-0005, the same discipline as a treatment's), because the event is the only place
      // the fact can live when there are no individual animals to hang it on.
      let carriedWithholdUntil: string | undefined;
      if (input.counterpartMobId !== undefined) {
        // Both halves must be on this farm. A transfer naming a neighbour's mob would carry a
        // withholding across a tenancy boundary — and read as a real event forever.
        // Checked as an ordinary `mobId` — the question is the same one ("is this mob on this
        // farm?") and reusing the existing check means there is no second key for the reference
        // guard to be taught about and then forgotten. The SUBJECT mob is already proved above.
        await assertOwnedReferences(tx, input.farmId, { mobId: input.counterpartMobId });
        // The SOURCE is where the residue is: on the way out it is this mob, on the way in it is
        // the one the head came from. Reading the destination on a `transfer_in` would ask the
        // wrong mob and carry nothing, which is the laundering hole left open.
        const sourceMobId = input.reason === 'transfer_out' ? input.mobId : input.counterpartMobId;
        carriedWithholdUntil = await latestMeatClearForMob(
          tx,
          input.farmId,
          sourceMobId,
          input.occurredAt,
        );
      }

      // The reasons that are NOT refused still record the circumstance, for the same reason the
      // individual death path does: a blocked `slaughter` is one tap from an unblocked `death`.
      const mobWithinWithdrawal =
        input.reason !== 'sale' &&
        input.reason !== 'slaughter' &&
        (await mobIsWithinMeatWithdrawal(tx, input.farmId, input.mobId, input.occurredAt));

      const headAsAt = await deriveHeadCount(tx, input.farmId, input.mobId, mob.initialHeadCount, {
        occurredAt: input.occurredAt,
        id: input.id,
      });

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
        ...(mobWithinWithdrawal ? { withinWithdrawal: true } : {}),
        ...(input.counterpartMobId === undefined
          ? {}
          : { counterpartMobId: input.counterpartMobId }),
        // ⭐ Taken from the body, like the id itself and for the same reason: the two halves of a
        // move are captured on ONE device in one action, and the id that ties them has to be minted
        // where that action happens. The server cannot invent it — the halves arrive as separate
        // requests, possibly days apart, and there is nothing in the second to recognise the first
        // by. `recordMobTally` refuses a transfer half that arrives without one.
        batchId: input.batchId,
        ...(carriedWithholdUntil === undefined ? {} : { carriedWithholdUntil }),
        // ⭐ Taken from the body, which nothing else regulated in this file does. There is no
        // reference row to resolve a seller's word from — see the schema. It is recorded as what
        // was said, or not at all.
        ...(input.declaredWithdrawalUntil === undefined
          ? {}
          : { declaredWithdrawalUntil: input.declaredWithdrawalUntil }),
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

      // ⭐ The FROM side is reconstructed from the move log at this event's place in it, NOT read
      // off `animals.mob_id` / `animals.land_unit_id`. Those are the denormalised "where is it
      // now", and arrival order is not `occurred_at` order: a phone out of signal for a week sends
      // a move dated the 18th long after one dated the 20th has landed. Stamping the current column
      // onto it writes the 20th's destination as the 18th's origin — and it goes into an APPEND-ONLY
      // log that the withdrawal guard reconstructs membership from, so the wrong answer is baked in
      // permanently. Fixing the read path and leaving the write path is how a bug survives its fix.
      const before = await positionBefore(
        tx,
        input.farmId,
        input.animalId,
        { occurredAt: input.occurredAt, id: input.id },
        current,
      );

      const { event, animalChange } = recordMove({
        id: input.id,
        farmId: input.farmId,
        animalId: input.animalId,
        occurredAt: input.occurredAt,
        currentStatus: current.status,
        enterpriseId: current.enterpriseId,
        fromLandUnitId: before.landUnitId,
        fromMobId: before.mobId,
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

      // The denormalised position follows the history, not the other way round — and "the history"
      // means the LATEST move in the log, not the last one to arrive. A back-dated move that lands
      // behind one already stored describes where the animal was, not where it is; writing it to
      // the animal row would walk the herd backwards to last week's camp.
      if (before.isLatest) {
        await tx
          .update(animals)
          .set({
            landUnitId: animalChange.landUnitId,
            mobId: animalChange.mobId,
            updatedBy: userId,
            updatedAt: new Date(),
          })
          .where(and(eq(animals.id, input.animalId), eq(animals.farmId, input.farmId)));
      }

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

      // ⭐ FR-131 on the individual slaughter path. A death is not a food-safety event and must
      // never be refused — refusing to record a fact is worse than recording it — but a SLAUGHTER
      // is a disposal into the food chain exactly as a sale to an abattoir is. The group path has
      // blocked `slaughter` since FR-102; leaving the individual path open was the mirror image of
      // the hole that closed, and it is the path with a named animal and a stored clear date.
      if (input.slaughtered) {
        await assertClearOfMeatWithdrawal(tx, input.farmId, input.animalId, input.occurredAt);
      }

      // ⭐ And an ordinary DEATH inside a withholding is recorded with that circumstance attached.
      // "Died" is one tap from the blocked "Slaughtered", so saying nothing here would teach the
      // workaround: stopped on one button, the farmer taps the next, and the residue leaves with
      // nothing anywhere showing it was ever in question. The fact is kept; so is the context.
      const deathJurisdiction = await farmJurisdiction(tx, input.farmId);
      const deathDay = farmLocalDay(input.occurredAt, deathJurisdiction);
      const withinWithdrawal =
        input.slaughtered !== true &&
        isWithinWithdrawal(
          await latestMeatClearForAnimal(
            tx,
            input.farmId,
            input.animalId,
            deathJurisdiction,
            deathDay,
          ),
          deathDay,
        );

      const base = {
        id: input.id,
        farmId: input.farmId,
        animalId: input.animalId,
        occurredAt: input.occurredAt,
        currentStatus,
        enterpriseId,
        cause: input.cause,
        ...(input.slaughtered ? { slaughtered: true } : {}),
        ...(withinWithdrawal ? { withinWithdrawal: true } : {}),
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
   * Records a mating / service (FR-120) against the DAM. No status change — being served is not a
   * state in the lifecycle machine, it is something that happened to an animal that stays alive.
   *
   * The sire, when it is an animal on this farm, is checked to BE on this farm. That check is not
   * bookkeeping: a mating is the first link of a pedigree, and a sire pointing across a tenancy
   * boundary corrupts every ancestry read from it afterwards, unfixably once there is data on it.
   */
  async recordMating(userId: string, input: schemas.RecordMatingRequest) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      await assertOwnedReferences(tx, input.farmId, {
        ...(input.sireId === undefined ? {} : { sireId: input.sireId }),
      });
      const { enterpriseId } = await animalFacts(tx, input.farmId, input.animalId);

      const event = recordMating({
        id: input.id,
        farmId: input.farmId,
        animalId: input.animalId,
        occurredAt: input.occurredAt,
        method: input.method,
        enterpriseId,
        createdBy: userId,
        ...(input.sireId === undefined ? {} : { sireId: input.sireId }),
        ...(input.sireCode === undefined ? {} : { sireCode: input.sireCode }),
        ...(input.bullInAt === undefined ? {} : { bullInAt: input.bullInAt }),
        ...(input.bullOutAt === undefined ? {} : { bullOutAt: input.bullOutAt }),
      });

      return insertEvent(tx, event);
    });
  }

  /**
   * Records a pregnancy diagnosis (FR-121) against the DAM, and projects the due date HERE.
   *
   * ⭐ The due date is computed server-side from `species_gestation` and is not accepted from the
   * body. The client previews one from its cached copy so the farmer sees a date standing in the
   * race; this is the one that gets stored. Same division of labour as the withdrawal period
   * (ADR-0005) and for the same reason — a date a calving report is planned from must come from a
   * figure the server can vouch for, not from whatever a stale or edited device asserts.
   *
   * ⭐ It is computed AT CAPTURE and frozen onto the event. Correcting a gestation figure later
   * must never silently move a date a farmer has already written on a calendar.
   *
   * ⛔ A species with no gestation row RECORDS THE DIAGNOSIS and refuses only the PROJECTION. The
   * earlier version threw a 4xx for the whole request — but the client sends `matingDate` for every
   * positive test, so the game/poultry path was a capture the flush could never land: the outbox
   * set it aside forever (FR-009) while the screen said the test was saved. Refusing a real
   * observation to protect a due date that was never available is the worse trade. What is refused
   * is the fabrication of a figure, which is still refused: `gestationDaysFor` never guesses.
   *
   * The absence is not silent. The stored event keeps `matingDate` and a positive result, and the
   * caller is handed a `warning` naming the species so the reason "no calving date" travels with
   * the record rather than being inferred from a missing field later.
   */
  async recordPregnancyTest(userId: string, input: schemas.RecordPregnancyTestRequest) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      const { enterpriseId, species } = await animalFacts(tx, input.farmId, input.animalId);

      // Only a positive result with a known service date could project a due date. `null` from the
      // lookup means the species has no figure — the diagnosis is still recorded, without one.
      const projecting = input.result === 'pregnant' && input.matingDate !== undefined;
      const gestationDays = projecting ? await gestationDaysFor(tx, species) : undefined;

      const event = recordPregnancyDiagnosis({
        id: input.id,
        farmId: input.farmId,
        animalId: input.animalId,
        occurredAt: input.occurredAt,
        method: input.method,
        result: input.result,
        enterpriseId,
        createdBy: userId,
        ...(input.matingDate === undefined ? {} : { matingDate: input.matingDate }),
        ...(gestationDays == null ? {} : { gestationDays }),
      });

      const stored = await insertEvent(tx, event);
      if (projecting && gestationDays === null) {
        return {
          ...stored,
          warning:
            `No gestation period is recorded for ${species}, so no calving date could be ` +
            `projected. The diagnosis has been saved.`,
        };
      }
      return stored;
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
                deletedAt: animalIdentifiers.deletedAt,
              })
              .from(animalIdentifiers)
              // ⭐ RETIRED IDENTIFIERS INCLUDED, which is the opposite of what every other read
              // here does and is correct only for this document. A tag replaced after the loss is
              // the number the animal was WEARING when it walked off, and the number on it at a
              // roadblock. They are flagged rather than mixed in — every line in this pack is a
              // fact, including the fact that a number is no longer current.
              .where(
                and(
                  eq(animalIdentifiers.farmId, farmId),
                  inArray(animalIdentifiers.animalId, animalIds),
                ),
              );

      const identifiersByAnimal = new Map<
        string,
        { type: string; value: string; retired: boolean }[]
      >();
      for (const row of identifierRows) {
        const list = identifiersByAnimal.get(row.animalId) ?? [];
        list.push({ type: row.type, value: row.value, retired: row.deletedAt !== null });
        identifiersByAnimal.set(row.animalId, list);
      }

      // ⭐ The possession trail (legal-compliance.md § 3.2). Under the Stock Theft Act's reverse
      // onus this is the DEFENCE — a pack that identifies an animal and cannot show it was here,
      // being kept and treated, week after week, has omitted the part that does the legal work.
      const trail = await possessionTrail(
        tx,
        farmId,
        animalIds,
        await farmJurisdiction(tx, farmId),
      );

      return assembleEvidencePack({
        farmId,
        discoveredAt: incident.discoveredAt,
        lastSeenAt: incident.lastSeenAt,
        lastSeenLocationGeojson: incident.lastSeenLocationGeojson,
        headCount: incident.headCount,
        observations: incident.observations,
        caseNumber: incident.caseNumber,
        reportingStation: incident.reportingStation,
        animals: animalRows.map((r) => ({
          animalId: r.animalId,
          identifiers: identifiersByAnimal.get(r.animalId) ?? [],
          mark: r.mark ?? null,
          certificateReference: r.certificateReference ?? null,
          photoKey: r.photoKey,
          acquiredAt: r.acquiredAt,
          source: r.source,
          movements: trail.movements.get(r.animalId) ?? [],
          treatments: trail.treatments.get(r.animalId) ?? [],
        })),
      });
    });
  }

  /**
   * The residue register (FR-131) — COMPLIANCE-GATED. Every disposal on this farm that took head
   * out while something standing in it was still inside an active MEAT withholding.
   *
   * ⭐ This is the reader `withinWithdrawal` never had. The flag was being stamped on death and
   * tally payloads by the two paths above and read by nothing at all — no screen, no report, no
   * test — so the circumstance a farmer was warned about at the crush was recorded in a column an
   * auditor would have needed hand-written SQL to reach. A field written and never read is the
   * "null in every record because nothing ever asked" defect wearing the other hat.
   *
   * ⭐ AND IT IS RE-DERIVED FROM THE WHOLE LOG, never read off the stored flag. That is what closes
   * the cross-device race, which no send-ordering can: device A records Monday's dip, device B —
   * which has never seen it — tallies forty head to the abattoir on Tuesday. Both captures are
   * honest and offline; the server sees them in ARRIVAL order and the disposal may legitimately
   * land first, pass the guard, and be stored clean. Stamping the disposal when the dose later
   * arrives is the shape this repo has already ruled out for head counts and for the same reason:
   * it steps a stored value on arrival, so it depends on the order things turn up in and is wrong
   * whenever a dose is corrected, soft-deleted, or lands after the register was last read. Folding
   * the log answers the question from scratch every time and cannot drift.
   *
   * ⭐ It runs the SAME `latestMeatClearForAnimal` / `latestMeatClearForMob` the guards run. §2h's
   * sharpest lesson was two mechanisms judging one food-safety boundary through two computations,
   * one of them narrower; there is exactly one here, so the register cannot quietly disagree with
   * the refusal it explains.
   *
   * A death or a theft is on the register and is NOT a refusal, and the distinction is carried on
   * the row rather than by omitting it. Refusing to record a death would refuse a FACT, which is
   * worse than recording it and is how a guard teaches people to work around it — a blocked
   * "Slaughtered" sits one tap from an unblocked "Died". `intoFoodChain` is what separates the
   * residue question from the record.
   */
  async residueRegister(userId: string, farmId: string): Promise<schemas.ResidueFlag[]> {
    return this.app.asUser(userId, async (tx) => {
      // Membership and the law this farm runs under, in one lookup. A farm the caller cannot see is
      // invisible through the RLS-bound connection and reads as "not found" — the same answer as
      // one that does not exist.
      const jurisdiction = await farmJurisdiction(tx, farmId);

      // ⭐ The span of days ANY withholding on this farm can reach — given here by a dose, or
      // carried in on head that arrived already withheld. A disposal outside it cannot be inside any
      // withholding, so the per-subject derivation — which reconstructs mob membership — never runs
      // for it. A farm with no withholding of either kind costs two queries and returns an empty
      // register, which is the ordinary state of most farms most of the time.
      const withheld = await withholdingSpan(tx, farmId, jurisdiction);
      if (withheld === null) return [];

      const rows = await tx
        .select({
          id: events.id,
          type: events.type,
          animalId: events.animalId,
          mobId: events.mobId,
          occurredAt: events.occurredAt,
          payload: events.payload,
        })
        .from(events)
        .where(
          and(
            eq(events.farmId, farmId),
            inArray(events.type, ['sale', 'death', 'tally']),
            isNull(events.deletedAt),
          ),
        )
        // Newest first: a farmer opening this screen is dealing with what just happened, and an
        // auditor reads backwards from the consignment in front of them. A TOTAL order, `(occurred_at,
        // id)` reversed, because day-grained captures tie on the instant by construction.
        .orderBy(desc(events.occurredAt), desc(events.id));

      // The clear date depends only on the subject and the day, so it is worth remembering: a
      // dosing run produces many disposals out of one mob on one day, and each would otherwise
      // rebuild the same membership intervals.
      const clearCache = new Map<string, string | undefined>();
      const clearFor = async (
        subject: { animalId: string | null; mobId: string | null },
        day: string,
        occurredAt: Date,
      ): Promise<string | undefined> => {
        const key = `${subject.animalId ?? ''}|${subject.mobId ?? ''}|${day}`;
        if (clearCache.has(key)) return clearCache.get(key);
        const clear =
          subject.animalId !== null
            ? await latestMeatClearForAnimal(tx, farmId, subject.animalId, jurisdiction, day)
            : subject.mobId !== null
              ? await latestMeatClearForMob(tx, farmId, subject.mobId, occurredAt)
              : undefined;
        clearCache.set(key, clear);
        return clear;
      };

      const register: schemas.ResidueFlag[] = [];
      for (const row of rows) {
        const disposal = disposalOf(row);
        if (disposal === null) continue;

        const occurredOn = farmLocalDay(row.occurredAt, jurisdiction);
        // Outside the span no withholding can reach it — given or carried in. Cheap, and it is a
        // bound rather than a guess: derived from the farm's own history, not from a window
        // invented in code.
        const reachable = occurredOn >= withheld.from && occurredOn <= withheld.to;

        const clearFrom = reachable
          ? ((await clearFor(row, occurredOn, row.occurredAt)) ?? null)
          : null;
        const withinWithdrawal = isWithinWithdrawal(clearFrom ?? undefined, occurredOn);

        // ⭐ Both halves. The derived answer is the live one and catches the late-arriving dose; the
        // stored flag is kept because a flag that has stopped being derivable — its dose corrected
        // away since — is still something that was written into an audit trail, and dropping it
        // silently would erase the record instead of explaining it.
        if (!withinWithdrawal && !disposal.knownAtCapture) continue;

        register.push({
          eventId: row.id,
          eventType: disposal.eventType,
          animalId: row.animalId,
          mobId: row.mobId,
          ...(disposal.reason === undefined ? {} : { reason: disposal.reason }),
          occurredAt: row.occurredAt,
          occurredOn,
          intoFoodChain: disposal.intoFoodChain,
          clearFrom,
          withinWithdrawal,
          knownAtCapture: disposal.knownAtCapture,
        });
      }
      return register;
    });
  }
}

/**
 * What kind of disposal a stored event is, or `null` when it is not one.
 *
 * A `purchase`, a `birth` and a `recount` are tally reasons that do not take head out of the herd,
 * so no residue question arises for them — and a `recount` inside a withholding is noise on a
 * register whose whole value is that every line on it is worth reading. `TALLY_DECREASES` is read
 * from the schema rather than restated here, so a reason added later cannot quietly miss this.
 *
 * ⛔ And reading the constant was NOT sufficient, which is the sharper half of the lesson. A reason
 * added later did not miss this — it was mis-classified BY it. `transfer_out` joined
 * `TALLY_DECREASES` in §2.3b, widening the constant's meaning underneath a reader asking the wrong
 * question of it: it decreases a MOB, while this register is about head leaving the HERD. Head that
 * walks through a gate into another of your own camps has not been disposed of, and its withholding
 * travels with it — that is the entire point of the reason existing. `TALLY_TRANSFERS` is the
 * schema's own name for that distinction, so it is subtracted here rather than restated.
 */
function disposalOf(row: { type: string; payload: unknown }): {
  readonly eventType: 'sale' | 'death' | 'tally';
  readonly reason?: schemas.TallyReason;
  readonly intoFoodChain: boolean;
  readonly knownAtCapture: boolean;
} | null {
  const payload = row.payload as {
    reason?: schemas.TallyReason;
    slaughtered?: unknown;
    withinWithdrawal?: unknown;
  };
  const knownAtCapture = payload.withinWithdrawal === true;

  switch (row.type) {
    case 'sale':
      // A sale is refused at capture inside a withholding, so a flagged one is ALWAYS a late
      // discovery — there is no `withinWithdrawal` on the trade payload to read and there should
      // not be. That is the shape of the cross-device race, and it is why this register exists.
      return { eventType: 'sale', intoFoodChain: true, knownAtCapture: false };
    case 'death':
      return {
        eventType: 'death',
        // A slaughter puts meat into the food chain; a death does not, and must never be refused.
        intoFoodChain: payload.slaughtered === true,
        knownAtCapture,
      };
    case 'tally': {
      const reason = payload.reason;
      if (reason === undefined) return null;
      if (!(schemas.TALLY_DECREASES as readonly string[]).includes(reason)) return null;
      if ((schemas.TALLY_TRANSFERS as readonly string[]).includes(reason)) return null;
      return {
        eventType: 'tally',
        reason,
        intoFoodChain: reason === 'sale' || reason === 'slaughter',
        knownAtCapture,
      };
    }
    default:
      return null;
  }
}

/**
 * The span of farm-local days any meat withholding on this farm covers — the earliest day a
 * withholding starts and the latest day one runs to. `null` when nothing on the farm withholds meat
 * at all.
 *
 * This is a NARROWING, not a rule: a disposal outside the span provably cannot sit inside any
 * withholding, so skipping it changes no answer. It is derived from the farm's own history rather
 * than being a "last 90 days" window typed into code, which would be a regulated number in disguise
 * and would silently drop the disposal an auditor came looking for.
 *
 * ⛔ A withholding has THREE sources, not one, and this function knew about one of them for exactly
 * one commit. It originally read health events alone — true when written, false as soon as §2.3b
 * let a withholding ARRIVE WITH head (`transfer_in` carrying one across, or a purchase whose seller
 * declared one). Neither is a health event, so a farm that has never recorded a dose produced no
 * span, took the `null` path, and got an EMPTY register — on the smallholder's farm, where bought-in
 * head is the whole herd and the register is the only thing that can speak. The narrowing must be
 * derived from every source the per-subject derivation reads, or it is not a narrowing, it is a
 * silent filter.
 */
async function withholdingSpan(
  tx: CaptureTx,
  farmId: string,
  jurisdiction: string,
): Promise<{ readonly from: string; readonly to: string } | null> {
  let from: string | undefined;
  let to: string | undefined;
  const widen = (start: string, clear: string): void => {
    if (from === undefined || start < from) from = start;
    if (to === undefined || clear > to) to = clear;
  };

  const doses = await tx
    .select({ payload: events.payload, occurredAt: events.occurredAt })
    .from(events)
    .where(
      and(
        eq(events.farmId, farmId),
        inArray(events.type, ['treatment', 'vaccination', 'dip']),
        isNull(events.deletedAt),
      ),
    );
  for (const row of doses) {
    const clear = (row.payload as { meatWithholdUntil?: unknown }).meatWithholdUntil;
    if (typeof clear !== 'string') continue;
    widen(doseDayOf(row, jurisdiction), clear);
  }

  // Head that ARRIVED already withheld. It starts withholding the mob on the day it walks in, which
  // is the same bound `latestArrivedWithhold` applies when it asks whether the arrival preceded the
  // disposal — so the span and the per-subject rule cannot disagree about the edge.
  const arrivals = await tx
    .select({ payload: events.payload, occurredAt: events.occurredAt })
    .from(events)
    .where(and(eq(events.farmId, farmId), eq(events.type, 'tally'), isNull(events.deletedAt)));
  for (const row of arrivals) {
    const payload = row.payload as {
      reason?: string;
      carriedWithholdUntil?: unknown;
      declaredWithdrawalUntil?: unknown;
    };
    if (payload.reason !== 'transfer_in' && payload.reason !== 'purchase') continue;
    for (const candidate of [payload.carriedWithholdUntil, payload.declaredWithdrawalUntil]) {
      if (typeof candidate !== 'string') continue;
      widen(farmLocalDay(row.occurredAt, jurisdiction), candidate);
    }
  }

  return from === undefined || to === undefined ? null : { from, to };
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
): Promise<{
  status: schemas.Animal['status'];
  enterpriseId: string | null;
  species: string;
}> {
  const [row] = await tx
    .select({
      status: animals.status,
      enterpriseId: animals.enterpriseId,
      // The species is read from the animal's own row rather than taken from the request for the
      // same reason the herd is: it is already recorded, and letting a client restate it only
      // creates a way to project a cow's due date off a sheep's gestation.
      species: animals.species,
    })
    .from(animals)
    .where(and(eq(animals.id, animalId), eq(animals.farmId, farmId), isNull(animals.deletedAt)));
  if (!row) throw new NotFoundError('Animal not found');
  return row;
}

/**
 * The gestation period for a species, from the `species_gestation` reference table (FR-121) — the
 * source `projectDueDate` is injected FROM, so that no number is ever typed into the projection.
 *
 * A species with no row THROWS. It does not fall back to a nearby species and it does not quietly
 * return undefined, and the reasoning is the same one the domain rules give for a missing regulated
 * rate: a loud failure is a five-minute fix, and a silent one produces a whole season of wrong
 * calving dates that nobody knows to distrust. `poultry` has no row because a hen does not gestate,
 * and `game` has none because a springbok and a kudu are a hundred days apart — for both, refusing
 * is the correct answer rather than a gap.
 */
/**
 * The gestation figure for a species, or `null` when none is recorded.
 *
 * ⭐ `null` is not "guess a nearby species" — that would be the fabricated-regulated-number defect,
 * and it stays forbidden. It means "no due date can be projected", which the caller records as an
 * honest absence rather than throwing away the diagnosis that came with it. A `poultry` bird does
 * not gestate and a `game` doe spans a hundred days between a springbok and a kudu, so there is no
 * one figure to record and pretending otherwise is worse than saying so.
 */
async function gestationDaysFor(tx: CaptureTx, species: string): Promise<number | null> {
  const [row] = await tx
    .select({ gestationDays: speciesGestation.gestationDays })
    .from(speciesGestation)
    .where(eq(speciesGestation.species, species));
  return row?.gestationDays ?? null;
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
   * Fold only what the projection places BEFORE this event. Used to validate a capture against the
   * count as at the day it describes rather than against today's, so a back-dated tally arriving
   * from a phone that was out of signal is judged on the flock it was actually describing.
   * Omitted for the authoritative write, which folds the entire log.
   *
   * ⭐ It takes the whole `(occurredAt, id)` pair, not just the instant, because that is the order
   * the projection below runs in and a cut must agree with it. Cutting on `occurred_at <= asAt`
   * folded in same-instant tallies the projection places AFTER this one — and ties are ordinary
   * here, since the capture screen stamps every tally on a day with the same instant. The visible
   * cost was not a wrong count but a wrong REFUSAL: an honest back-dated capture judged against
   * head that had not left yet gets a 400, and FR-009 sets a 400 aside permanently.
   */
  asAt?: { readonly occurredAt: Date; readonly id: string },
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
        ...(asAt === undefined
          ? []
          : [
              or(
                lt(events.occurredAt, asAt.occurredAt),
                and(eq(events.occurredAt, asAt.occurredAt), lt(events.id, asAt.id)),
              )!,
            ]),
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
  const jurisdiction = await farmJurisdiction(tx, farmId);
  const saleDay = farmLocalDay(occurredAt, jurisdiction);
  const latestClear = await latestMeatClearForAnimal(
    tx,
    farmId,
    animalId,
    jurisdiction,
    // The day being judged bounds the doses that can judge it. See `latestMeatClearForAnimal`.
    saleDay,
  );
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
 *
 * ⭐ A dose reaches the head in this mob by TWO routes and the guard reads both, because health
 * events are animal-XOR-mob. Filtering `events.mob_id` alone finds the plunge dip and misses the
 * cow that was treated individually — that event stores `mob_id = NULL` — so a mixed mob holding
 * one individually-dosed animal tallied to slaughter with nothing firing. The question this asks is
 * not "was this mob dosed" but "is anything standing in it today still inside a withholding", which
 * is the question the truck at the gate actually poses.
 */
async function assertMobClearOfMeatWithdrawal(
  tx: CaptureTx,
  farmId: string,
  mobId: string,
  occurredAt: Date,
): Promise<void> {
  const latestClear = await latestMeatClearForMob(tx, farmId, mobId, occurredAt);
  const day = farmLocalDay(occurredAt, await farmJurisdiction(tx, farmId));
  if (isWithinWithdrawal(latestClear, day)) {
    throw new ValidationError(
      `This group is within its meat withdrawal period until ${latestClear}; none of it can go for slaughter or sale before then`,
    );
  }
}

/** The same question without the refusal — for the tally reasons that are recorded, not refused. */
async function mobIsWithinMeatWithdrawal(
  tx: CaptureTx,
  farmId: string,
  mobId: string,
  occurredAt: Date,
): Promise<boolean> {
  const latestClear = await latestMeatClearForMob(tx, farmId, mobId, occurredAt);
  return isWithinWithdrawal(
    latestClear,
    farmLocalDay(occurredAt, await farmJurisdiction(tx, farmId)),
  );
}

/**
 * The latest meat clear date reaching anything standing in this mob on the day.
 *
 * `visited` carries the mobs already on the current chain, so a transfer that eventually leads back
 * here terminates instead of recursing forever. A→B→A is an ordinary thing for a farmer to do with
 * two camps and a week between.
 */
async function latestMeatClearForMob(
  tx: CaptureTx,
  farmId: string,
  mobId: string,
  occurredAt: Date,
  visited: ReadonlySet<string> = new Set(),
): Promise<string | undefined> {
  const jurisdiction = await farmJurisdiction(tx, farmId);
  const day = farmLocalDay(occurredAt, jurisdiction);
  const seen = new Set(visited).add(mobId);

  // Route 1: doses given to the MOB — the plunge dip, the mob vaccination. Bounded by the disposal
  // day for the same reason the individual route is: head that left on the 1st cannot be carrying a
  // dose drawn on the 10th, and measuring it against one refuses an honest back-dated capture.
  let latestClear = await latestMeatClear(
    tx,
    farmId,
    eq(events.mobId, mobId),
    (row) => doseDayOf(row, jurisdiction) <= day,
  );

  // Route 2: doses that reached an animal STANDING IN this mob on the day. Its own treatments, and
  // any mob dose from a flock it was in at the time — an animal dipped in the dip camp and since
  // walked into this one carries its withholding with it.
  for (const memberId of await mobMembersOn(tx, farmId, mobId, day, jurisdiction)) {
    const clear = await latestMeatClearForAnimal(tx, farmId, memberId, jurisdiction, day);
    if (clear !== undefined && (latestClear === undefined || clear > latestClear)) {
      latestClear = clear;
    }
  }

  // ⭐ Route 3: withholdings that arrived WITH head rather than being given to it (§2.3b).
  //
  // The two routes above are both "was something here dosed". Neither can see head that walked in
  // already withheld, and for a counted flock nothing else can either — there are no `animals` rows
  // to carry the fact, so a `transfer_in` from a dipped camp, or a purchase whose seller declared a
  // withdrawal, would otherwise be clear the moment it arrived. That is precisely the laundering
  // the sale-out/purchase-in workaround performed, and closing it is the reason `transfer_in`
  // exists at all.
  const arrived = await latestArrivedWithhold(tx, farmId, mobId, day, jurisdiction, seen);
  if (arrived !== undefined && (latestClear === undefined || arrived > latestClear)) {
    latestClear = arrived;
  }

  return latestClear;
}

/**
 * The latest withholding carried INTO a mob by head arriving on or before `day` — a `transfer_in`
 * whose source was under one, or a `purchase` whose seller declared one.
 *
 * Bounded by the day for the same reason every other route is: head that arrives next week cannot
 * withhold a consignment that left today, and judging one against the other would refuse an honest
 * back-dated capture.
 *
 * ⛔ An undeclared purchase contributes NOTHING, and that is the decision rather than a gap. The
 * honest answer for an animal whose treatment nobody here witnessed is "unknown history"; inventing
 * a period would be a fabricated regulated number, and assuming clear would be the laundering this
 * exists to stop. So it neither withholds nor claims — it simply is not evidence either way.
 */
async function latestArrivedWithhold(
  tx: CaptureTx,
  farmId: string,
  mobId: string,
  day: string,
  jurisdiction: string,
  visited: ReadonlySet<string>,
): Promise<string | undefined> {
  const rows = await tx
    .select({ payload: events.payload, occurredAt: events.occurredAt })
    .from(events)
    .where(
      and(
        eq(events.farmId, farmId),
        eq(events.mobId, mobId),
        eq(events.type, 'tally'),
        isNull(events.deletedAt),
      ),
    );

  let latest: string | undefined;
  for (const row of rows) {
    const payload = row.payload as {
      reason?: string;
      carriedWithholdUntil?: unknown;
      declaredWithdrawalUntil?: unknown;
      counterpartMobId?: unknown;
    };
    // Only the halves that bring head IN. A `transfer_out` carries the same date — deliberately, so
    // a later reader can see what left under a withholding — but reading it here would withhold the
    // mob the head departed FROM for a residue that departed with it.
    if (payload.reason !== 'transfer_in' && payload.reason !== 'purchase') continue;
    // Head that arrives AFTER the day being judged cannot withhold what left before it.
    if (farmLocalDay(row.occurredAt, jurisdiction) > day) continue;
    for (const candidate of [payload.carriedWithholdUntil, payload.declaredWithdrawalUntil]) {
      if (typeof candidate === 'string' && (latest === undefined || candidate > latest)) {
        latest = candidate;
      }
    }

    // ⛔ THE STORED DATE IS A FLOOR, NEVER A CEILING, and reading it alone was a food-safety hole.
    //
    // It is computed from the source mob's log AS IT STOOD WHEN THE TRANSFER LANDED — which is
    // stepping a stored value on arrival, the exact shape this repo ruled out for head counts and
    // for camp boundaries, applied here to residue. Arrival order is not `occurred_at` order: one
    // phone can carry the dip and another the transfer, and whichever reconnects first decides what
    // gets frozen. So the source mob is asked AGAIN, live, as at the day the head walked out — a
    // dose that lands next week but was given before the gate opened still reaches this flock.
    //
    // A purchase has no counterpart on this farm to ask, so its declared date is all there is; that
    // is the honest limit of "what the seller said", not a gap.
    if (payload.reason !== 'transfer_in') continue;
    const source = payload.counterpartMobId;
    if (typeof source !== 'string' || visited.has(source)) continue;
    const live = await latestMeatClearForMob(tx, farmId, source, row.occurredAt, visited);
    if (live !== undefined && (latest === undefined || live > latest)) latest = live;
  }
  return latest;
}

/**
 * The animals standing in a mob on a given farm-local day, from the move log (FR-103).
 *
 * The candidates are narrowed in SQL first — an animal is only ever in this mob if it points at it
 * now or if some move of its own names it — so a group-only flock costs one query that returns
 * nothing, which is the case this guard exists for and the one that must stay cheap. Membership is
 * then reconstructed per candidate rather than read off `animals.mob_id`, for the same reason it is
 * everywhere else here: that column is overwritten by every move and is wrong in both directions
 * the moment stock is walked out of a camp.
 */
async function mobMembersOn(
  tx: CaptureTx,
  farmId: string,
  mobId: string,
  day: string,
  jurisdiction: string,
): Promise<readonly string[]> {
  const touched = await tx
    .selectDistinct({ animalId: events.animalId })
    .from(events)
    .where(
      and(
        eq(events.farmId, farmId),
        eq(events.type, 'move'),
        // A move's own `mob_id` column is the DESTINATION, so it finds the arrivals. The departures
        // are in the payload's `fromMobId` — and they matter, because a tally can be back-dated to
        // a day the animal had not left yet.
        or(eq(events.mobId, mobId), sql`${events.payload}->>'fromMobId' = ${mobId}`),
        isNull(events.deletedAt),
      ),
    );
  const pointing = await tx
    .select({ id: animals.id })
    .from(animals)
    .where(and(eq(animals.farmId, farmId), eq(animals.mobId, mobId), isNull(animals.deletedAt)));

  const candidates = [
    ...new Set([
      ...pointing.map((row) => row.id),
      ...touched.map((row) => row.animalId).filter((id): id is string => id !== null),
    ]),
  ];

  const members: string[] = [];
  for (const animalId of candidates) {
    const wasIn = await mobMembership(tx, farmId, animalId, jurisdiction);
    const inIt = wasIn.some(
      (m) => m.mobId === mobId && day >= m.fromDay && (m.toDay === null || day <= m.toDay),
    );
    if (inIt) members.push(animalId);
  }
  return members;
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
  jurisdiction: string,
  /**
   * ⭐ The day being judged. A dose given AFTER it cannot withhold it, and until this parameter
   * existed nothing said so: the query took the latest clear date on the animal regardless of when
   * the dose was given, so a disposal on the 1st was measured against a dip on the 10th.
   *
   * The visible cost was a refusal of an honest back-dated capture — sell five head on the 1st,
   * remember it on the 20th, and the flock dipped on the 10th makes the record unsaveable — which
   * is the same class this repo has already closed twice for the as-at fold. It is safe in the
   * direction that matters: an animal that left the herd five days before a dose was drawn cannot
   * be carrying that residue, so nothing is released early. The comparison is INCLUSIVE, because
   * dipped-and-sold on one day is a real residue question and a food-safety boundary fails toward
   * blocking.
   */
  onOrBefore: string,
): Promise<string | undefined> {
  const wasIn = await mobMembership(tx, farmId, animalId, jurisdiction);

  // Every mob the animal has ever been in, so one query fetches the candidates; the interval check
  // below decides which of them were actually its mob on the day of the dose.
  const mobIds = [...new Set(wasIn.map((m) => m.mobId))];
  const subjectFilter =
    mobIds.length === 0
      ? eq(events.animalId, animalId)
      : or(eq(events.animalId, animalId), inArray(events.mobId, mobIds));

  return latestMeatClear(tx, farmId, subjectFilter, (row) => {
    const doseDay = doseDayOf(row, jurisdiction);
    if (doseDay > onOrBefore) return false;
    // An animal-subject event is the animal's own dose and always counts. A mob-subject event
    // counts only if the animal was in that mob on the DAY it was given.
    if (row.mobId === null) return true;
    return wasIn.some(
      (m) =>
        m.mobId === row.mobId && doseDay >= m.fromDay && (m.toDay === null || doseDay <= m.toDay),
    );
  });
}

/**
 * The farm-local DAY a dose was given, from the day the farmer recorded rather than the instant
 * stored to hold it.
 *
 * `administeredOn` is on the payload for exactly this. The fallback covers health events written
 * before it was stored: converting `occurred_at` to a farm-local day recovers the same answer for
 * both capture branches (a back-dated dose is stamped midday UTC on its own day, a same-day dose
 * carries a real instant on today), which an instant comparison did not.
 */
function doseDayOf(row: { payload: unknown; occurredAt: Date }, jurisdiction: string): string {
  const administeredOn = (row.payload as { administeredOn?: unknown }).administeredOn;
  return typeof administeredOn === 'string'
    ? administeredOn
    : farmLocalDay(row.occurredAt, jurisdiction);
}

/**
 * One stretch of FARM-LOCAL DAYS during which an animal belonged to a particular mob.
 * `toDay === null` = still in it.
 *
 * ⭐ Days, and INCLUSIVE AT BOTH ENDS, and both halves of that are load-bearing.
 *
 * Days, because the other side of the comparison is a dose, and a dose is day-grained: a back-dated
 * one carries an instant that was invented to store it. Comparing an invented instant against a real
 * move instant decides a residue question on which of two arbitrary clock readings is larger — dip
 * the flock at 06:00, walk them out of the dip camp at 12:00, record the dip that evening, and the
 * dip lands after the interval closed and the animal is CLEAR the next morning.
 *
 * Inclusive at both ends, because on the day of a move the animal was genuinely in both mobs, and
 * because a boundary in a food-safety guard must fail toward BLOCKING. Over-withholding costs a
 * farmer a day of a sale; under-withholding is a residue traceback from an abattoir.
 */
interface MobInterval {
  readonly mobId: string;
  readonly fromDay: string;
  readonly toDay: string | null;
}

/**
 * The possession trail for a set of animals — where each was walked and what each was dosed with,
 * in occurrence order (FR-603, legal-compliance.md § 3.2).
 *
 * ⭐ This is the reverse-onus defence, not a nicety. Identification proves an animal is yours;
 * continuous possession proves it was HERE, being kept, right up to the loss — a movement log
 * across camps and a treatment log nobody performs on stolen stock. Two queries for the whole
 * incident rather than two per animal, because a pack is generated for a herd, not a head.
 *
 * Camps are rendered as CODES. A pack goes to a police station, and a UUID tells them nothing.
 */
async function possessionTrail(
  tx: CaptureTx,
  farmId: string,
  animalIds: readonly string[],
  jurisdiction: string,
): Promise<{
  movements: Map<string, { occurredAt: Date; from: string | null; to: string | null }[]>;
  treatments: Map<string, { occurredAt: Date; kind: string; product: string }[]>;
}> {
  const movements = new Map<
    string,
    { occurredAt: Date; from: string | null; to: string | null }[]
  >();
  const treatments = new Map<string, { occurredAt: Date; kind: string; product: string }[]>();
  if (animalIds.length === 0) return { movements, treatments };

  const camps = await tx
    .select({ id: landUnits.id, code: landUnits.code })
    .from(landUnits)
    .where(eq(landUnits.farmId, farmId));
  const codeOf = new Map(camps.map((c) => [c.id, c.code]));
  const named = (id: unknown): string | null =>
    typeof id === 'string' ? (codeOf.get(id) ?? null) : null;

  const rows = await tx
    .select({
      animalId: events.animalId,
      type: events.type,
      occurredAt: events.occurredAt,
      payload: events.payload,
    })
    .from(events)
    .where(
      and(
        eq(events.farmId, farmId),
        inArray(events.animalId, [...animalIds]),
        inArray(events.type, ['move', 'treatment', 'vaccination', 'dip']),
        isNull(events.deletedAt),
      ),
    )
    .orderBy(events.occurredAt, events.id);

  for (const row of rows) {
    if (row.animalId === null) continue;
    if (row.type === 'move') {
      const p = row.payload as StoredMovePayload;
      const list = movements.get(row.animalId) ?? [];
      list.push({
        occurredAt: row.occurredAt,
        from: named(p.fromLandUnitId),
        to: named(p.toLandUnitId),
      });
      movements.set(row.animalId, list);
      continue;
    }
    // The product NAME is stamped onto the event server-side at capture, so the pack prints what
    // was actually given rather than resolving a registration that may since have been superseded.
    const product = (row.payload as { product?: unknown }).product;
    if (typeof product !== 'string') continue;
    const list = treatments.get(row.animalId) ?? [];
    list.push({ occurredAt: row.occurredAt, kind: row.type, product });
    treatments.set(row.animalId, list);
  }

  // ⭐ AND THE WHOLE-FLOCK DOSES, which the query above cannot see: a dip or a mob vaccination
  // stores `animal_id = NULL`, so an animal plunge-dipped with its flock every month would print
  // "Treatment history: None recorded." in the one document whose value is showing continuous
  // husbandry. That is the smallholder's animal, and it is the smallholder's defence.
  //
  // Which mob doses reached which animal is the same question the withdrawal guard answers, so it
  // is answered by the same reconstruction rather than a second one that could disagree.
  for (const animalId of animalIds) {
    const wasIn = await mobMembership(tx, farmId, animalId, jurisdiction);
    if (wasIn.length === 0) continue;
    const mobDoses = await tx
      .select({
        occurredAt: events.occurredAt,
        type: events.type,
        payload: events.payload,
        mobId: events.mobId,
      })
      .from(events)
      .where(
        and(
          eq(events.farmId, farmId),
          inArray(
            events.mobId,
            wasIn.map((m) => m.mobId),
          ),
          inArray(events.type, ['treatment', 'vaccination', 'dip']),
          isNull(events.deletedAt),
        ),
      )
      .orderBy(events.occurredAt, events.id);

    const list = treatments.get(animalId) ?? [];
    for (const dose of mobDoses) {
      const product = (dose.payload as { product?: unknown }).product;
      if (typeof product !== 'string') continue;
      const day = doseDayOf(dose, jurisdiction);
      const reached = wasIn.some(
        (m) => m.mobId === dose.mobId && day >= m.fromDay && (m.toDay === null || day <= m.toDay),
      );
      if (reached) list.push({ occurredAt: dose.occurredAt, kind: dose.type, product });
    }
    if (list.length > 0) {
      // One history, in occurrence order, however the dose was given — a farmer reading this to an
      // officer should not have to merge two lists in their head.
      list.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
      treatments.set(animalId, list);
    }
  }

  return { movements, treatments };
}

/** One `move` event's before/after, as the domain always writes all four sides of it. */
interface StoredMovePayload {
  readonly fromLandUnitId?: string | null;
  readonly toLandUnitId?: string | null;
  readonly fromMobId?: string | null;
  readonly toMobId?: string | null;
}

/**
 * Where an animal was immediately BEFORE `at`, reconstructed from the move log (FR-103), and
 * whether `at` is the latest move it has.
 *
 * Ordered by the same `(occurredAt, id)` total order everything else here uses, so "before" means
 * the same thing to this function as it does to the projections. With no moves at all the animal's
 * own columns are the honest answer: nothing has overwritten them.
 *
 * A back-dated move landing behind existing ones does leave those later moves carrying a `fromMobId`
 * that is now stale — an append-only log cannot go back and correct them. It does not matter, and
 * that is by construction rather than luck: `mobMembership` reads a `fromMobId` only off the FIRST
 * move, and takes every later position from the preceding move's `toMobId`.
 */
async function positionBefore(
  tx: CaptureTx,
  farmId: string,
  animalId: string,
  at: { readonly occurredAt: Date; readonly id: string },
  current: { readonly landUnitId: string | null; readonly mobId: string | null },
): Promise<{ landUnitId: string | null; mobId: string | null; isLatest: boolean }> {
  const moves = await tx
    .select({ id: events.id, occurredAt: events.occurredAt, payload: events.payload })
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

  if (moves.length === 0) return { ...current, isLatest: true };

  const precedes = (move: { occurredAt: Date; id: string }) =>
    move.occurredAt < at.occurredAt ||
    (move.occurredAt.getTime() === at.occurredAt.getTime() && move.id < at.id);

  const prior = moves.filter(precedes);
  const isLatest = prior.length === moves.length;

  if (prior.length > 0) {
    const p = prior[prior.length - 1]!.payload as StoredMovePayload;
    return { landUnitId: p.toLandUnitId ?? null, mobId: p.toMobId ?? null, isLatest };
  }

  // Nothing precedes it, so the animal was still wherever it was before the log begins — which the
  // earliest move records as its own FROM side.
  const earliest = moves[0]!.payload as StoredMovePayload;
  return {
    landUnitId: earliest.fromLandUnitId ?? null,
    mobId: earliest.fromMobId ?? null,
    isLatest,
  };
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
  jurisdiction: string,
): Promise<readonly MobInterval[]> {
  const dayOf = (instant: Date) => farmLocalDay(instant, jurisdiction);
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
      // Soft-delete respected here as everywhere else — this was the one read of `animals` in this
      // file that omitted it.
      .where(and(eq(animals.id, animalId), eq(animals.farmId, farmId), isNull(animals.deletedAt)));
    return row?.mobId ? [{ mobId: row.mobId, fromDay: dayOf(new Date(0)), toDay: null }] : [];
  }

  const intervals: MobInterval[] = [];
  let openMob = (moves[0]!.payload as { fromMobId?: string | null }).fromMobId ?? null;
  let openedOn = dayOf(new Date(0));

  for (const move of moves) {
    const { fromMobId, toMobId } = move.payload as StoredMovePayload;
    // A move that names no mob change leaves the animal where it is: it walked to another camp
    // without leaving its flock. The domain resolves an omitted destination to the origin before
    // it writes, so the payload always carries BOTH sides and "no mob change" is the two being
    // EQUAL — testing for an absent key here tested for something that never occurs, and split one
    // membership interval into two adjacent ones on every camp-only move.
    const to = toMobId ?? null;
    if (to === (fromMobId ?? null)) continue;
    const movedOn = dayOf(move.occurredAt);
    // Both intervals claim the move DAY: the animal was in the source mob that morning and the
    // destination mob that afternoon, and a dose recorded against either on that day reached it.
    if (openMob !== null) {
      intervals.push({ mobId: openMob, fromDay: openedOn, toDay: movedOn });
    }
    openMob = to;
    openedOn = movedOn;
  }
  if (openMob !== null) intervals.push({ mobId: openMob, fromDay: openedOn, toDay: null });

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
  applies: (row: { mobId: string | null; occurredAt: Date; payload: unknown }) => boolean = () =>
    true,
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
