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
import { and, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
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
  recordDeath,
  recordDip,
  recordMove,
  recordSale,
  recordTreatment,
  recordVaccination,
  recordWeight,
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
          attributes: input.attributes,
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
      await assertOwnedReferences(tx, input.farmId, { landUnitId: input.landUnitId });

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
        .leftJoin(brandingRegisters, eq(brandingRegisters.id, animals.brandId))
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

/** The IANA timezone a jurisdiction keeps farm time in — needed to turn a sale INSTANT into the
 *  farm-local DAY a withdrawal clear date is expressed in. A jurisdiction fact, not a regulated
 *  number; unknown jurisdictions THROW rather than defaulting (a silent default is a compliance
 *  hole). v1 is ZA-only, so this is the one entry. */
const JURISDICTION_TIMEZONE: Readonly<Record<string, string>> = { ZA: 'Africa/Johannesburg' };

/** The farm-local calendar day (YYYY-MM-DD) an instant falls on. `en-CA` renders ISO order. */
function farmLocalDay(instant: Date, jurisdiction: string): string {
  const timeZone = JURISDICTION_TIMEZONE[jurisdiction];
  if (!timeZone) {
    throw new ValidationError(`No timezone configured for jurisdiction ${jurisdiction}`);
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
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
  const rows = await tx
    .select({ payload: events.payload })
    .from(events)
    .where(
      and(
        eq(events.farmId, farmId),
        eq(events.animalId, animalId),
        inArray(events.type, ['treatment', 'vaccination', 'dip']),
        isNull(events.deletedAt),
      ),
    );

  let latestClear: string | undefined;
  for (const { payload } of rows) {
    const clear = (payload as { meatWithholdUntil?: unknown }).meatWithholdUntil;
    if (typeof clear === 'string' && (latestClear === undefined || clear > latestClear)) {
      latestClear = clear;
    }
  }

  const saleDay = farmLocalDay(occurredAt, await farmJurisdiction(tx, farmId));
  if (isWithinWithdrawal(latestClear, saleDay)) {
    throw new ValidationError(
      `This animal is within its meat withdrawal period until ${latestClear}; it cannot be sold for slaughter before then`,
    );
  }
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
