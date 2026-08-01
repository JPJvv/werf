/**
 * The livestock capture endpoints — the paths a QUEUED local capture is sent to, once there is a
 * signal. This is emphatically NOT the capture path: a farmer's Save writes to the local store with
 * no network in it (LocalHerd / LocalWeights / LocalLifecycle). These run LATER, in the background,
 * from the outbox flush. `sync/captureApi.ts` holds the transport and the error taxonomy every
 * capture client shares, and explains the at-least-once contract in full.
 */

import type { schemas } from '@werf/core';
import { postCapture as post, readFromApi } from '../sync/captureApi';
import type { StoredWeight } from './LocalWeights';
import type {
  StoredBirth,
  StoredDeath,
  StoredMissing,
  StoredPurchase,
  StoredSale,
  StoredWeaning,
} from './LocalLifecycle';
import type { StoredHealthEvent } from './LocalHealth';
import type { StoredMating, StoredPregnancyTest } from './LocalBreeding';
import type { StoredMove } from './LocalMoves';
import type { StoredTally } from './LocalTallies';
import type { StoredTheftIncident } from './LocalTheft';

/**
 * The capture endpoints, one per thing the client can compose offline. Each takes the stored
 * local record and the current access token, and resolves when the server has stored it (or
 * throws so the flush can decide what to do). The animal endpoint is sent FIRST by the flush:
 * a weight, death or sale event references `animals(id)`, and an event that arrived before its
 * animal would fail the foreign key.
 */
/** One endpoint per health kind, keyed by the union so a new kind cannot be silently misrouted. */
const HEALTH_ENDPOINTS: Record<StoredHealthEvent['kind'], string> = {
  treatment: '/livestock/treatments',
  vaccination: '/livestock/vaccinations',
  dip: '/livestock/dips',
};

export const livestockApi = {
  /**
   * The residue register (FR-131) — the ONE inbound read in this client, and the only livestock
   * question the device cannot answer for itself. Every guard here runs locally because a rule the
   * server alone can apply arrives after the truck has left; this one is different in kind, because
   * it is about a capture made on ANOTHER phone that this one has never seen. The cache provider
   * calls it opportunistically, never a capture path.
   */
  listResidueRegister: (farmId: string, token: string): Promise<schemas.ResidueFlagJson[]> =>
    readFromApi<schemas.ResidueFlagJson[]>(
      `/livestock/residue-register?farmId=${encodeURIComponent(farmId)}`,
      token,
      'Could not read the residue register',
    ),

  createAnimal: (animal: schemas.NewAnimal, token: string): Promise<void> =>
    post('/livestock/animals', animal, token),

  /** Sent after land units (a mob can carry `land_unit_id`) and before animals (FR-102). */
  createMob: (mob: schemas.NewMob, token: string): Promise<void> =>
    post('/livestock/mobs', mob, token),

  /**
   * A head-count adjustment (FR-102). Sent after its mob, which it references.
   *
   * Only the positive `count` and the reason cross the wire — never the signed delta the store
   * holds. The sign is the server's to apply, from the reason, so nothing a client sends can make
   * a birth remove head; and the server re-derives the whole count from its own log rather than
   * trusting an arithmetic result computed on a phone that may be a week behind.
   */
  recordTally: (tally: StoredTally, token: string): Promise<void> =>
    post(
      '/livestock/mob-tallies',
      {
        id: tally.id,
        farmId: tally.farmId,
        mobId: tally.mobId,
        occurredAt: tally.occurredAt,
        reason: tally.reason,
        count: tally.count,
        ...(tally.counterparty === undefined ? {} : { counterparty: tally.counterparty }),
        ...(tally.priceCents === undefined ? {} : { priceCents: tally.priceCents }),
      },
      token,
    ),

  /** Sent after its animal: an identifier references `animals(id)` (FR-109). */
  createIdentifier: (identifier: schemas.NewAnimalIdentifier, token: string): Promise<void> =>
    post('/livestock/identifiers', identifier, token),

  recordWeight: (weight: StoredWeight, token: string): Promise<void> =>
    post(
      '/livestock/weights',
      {
        id: weight.id,
        farmId: weight.farmId,
        animalId: weight.animalId,
        occurredAt: weight.occurredAt,
        kg: weight.kg,
        method: weight.method,
      },
      token,
    ),

  /** A move (FR-103). Only the DESTINATION is sent; the server reads where the animal is from its
   *  own row, so the stored history cannot disagree with the herd. */
  recordMove: (move: StoredMove, token: string): Promise<void> =>
    post(
      '/livestock/moves',
      {
        id: move.id,
        farmId: move.farmId,
        animalId: move.animalId,
        occurredAt: move.occurredAt,
        batchId: move.batchId,
        // Omitted vs null is load-bearing all the way to the wire: an absent destination means
        // "leave that dimension alone", and sending null instead would clear it.
        ...(move.toLandUnitId === undefined ? {} : { toLandUnitId: move.toLandUnitId }),
        ...(move.toMobId === undefined ? {} : { toMobId: move.toMobId }),
      },
      token,
    ),

  recordDeath: (death: StoredDeath, token: string): Promise<void> =>
    post(
      '/livestock/deaths',
      {
        id: death.id,
        farmId: death.farmId,
        animalId: death.animalId,
        occurredAt: death.occurredAt,
        cause: death.cause,
        // FR-131. The server refuses a slaughter inside an active withdrawal, so the flag has to
        // cross the wire — a flag the device keeps to itself is a guard the boundary cannot run.
        ...(death.slaughtered === true ? { slaughtered: true } : {}),
      },
      token,
    ),

  recordSale: (sale: StoredSale, token: string): Promise<void> =>
    post(
      '/livestock/sales',
      {
        id: sale.id,
        farmId: sale.farmId,
        animalId: sale.animalId,
        occurredAt: sale.occurredAt,
        counterparty: sale.counterparty,
        priceCents: sale.priceCents,
        ...(sale.weightKg === undefined ? {} : { weightKg: sale.weightKg }),
      },
      token,
    ),

  /** A birth (FR-104), filed against the DAM. The calf's herd row is sent ahead of it. */
  recordBirth: (birth: StoredBirth, token: string): Promise<void> =>
    post(
      '/livestock/births',
      {
        id: birth.id,
        farmId: birth.farmId,
        animalId: birth.animalId,
        occurredAt: birth.occurredAt,
        calfId: birth.calfId,
        easeScore: birth.easeScore,
        multiples: birth.multiples,
        ...(birth.birthWeightKg === undefined ? {} : { birthWeightKg: birth.birthWeightKg }),
      },
      token,
    ),

  /** A weaning (FR-111). */
  recordWeaning: (weaning: StoredWeaning, token: string): Promise<void> =>
    post(
      '/livestock/weanings',
      {
        id: weaning.id,
        farmId: weaning.farmId,
        animalId: weaning.animalId,
        occurredAt: weaning.occurredAt,
        weightKg: weaning.weightKg,
        ...(weaning.ageDays === undefined ? {} : { ageDays: weaning.ageDays }),
      },
      token,
    ),

  /**
   * A mating / service (FR-120), filed against the DAM. The sire, when it is an animal on this
   * farm, is sent as an id the server checks to BE on this farm — a mating is the first link of a
   * pedigree, and a sire pointing across a tenancy boundary corrupts every ancestry read from it.
   */
  recordMating: (mating: StoredMating, token: string): Promise<void> =>
    post(
      '/livestock/matings',
      {
        id: mating.id,
        farmId: mating.farmId,
        animalId: mating.animalId,
        occurredAt: mating.occurredAt,
        method: mating.method,
        ...(mating.sireId === undefined ? {} : { sireId: mating.sireId }),
        ...(mating.sireCode === undefined ? {} : { sireCode: mating.sireCode }),
        ...(mating.bullInAt === undefined ? {} : { bullInAt: mating.bullInAt }),
        ...(mating.bullOutAt === undefined ? {} : { bullOutAt: mating.bullOutAt }),
      },
      token,
    ),

  /**
   * A pregnancy diagnosis (FR-121), filed against the DAM. Note what is NOT sent: no due date,
   * only the SERVICE DATE the server projects it from. The device previews a date from its cached
   * gestation figures so the farmer sees one standing at the gate; a device that could send the
   * date could assert a calving date nothing on the server can check, into the field a calving
   * report is planned from. Same division of labour as the withdrawal period (ADR-0005).
   */
  recordPregnancyTest: (test: StoredPregnancyTest, token: string): Promise<void> =>
    post(
      '/livestock/pregnancy-tests',
      {
        id: test.id,
        farmId: test.farmId,
        animalId: test.animalId,
        occurredAt: test.occurredAt,
        method: test.method,
        result: test.result,
        ...(test.matingDate === undefined ? {} : { matingDate: test.matingDate }),
      },
      token,
    ),

  /** A purchase (FR-106) — money in, no status change. Money crosses as integer cents. */
  recordPurchase: (purchase: StoredPurchase, token: string): Promise<void> =>
    post(
      '/livestock/purchases',
      {
        id: purchase.id,
        farmId: purchase.farmId,
        animalId: purchase.animalId,
        occurredAt: purchase.occurredAt,
        counterparty: purchase.counterparty,
        priceCents: purchase.priceCents,
        ...(purchase.weightKg === undefined ? {} : { weightKg: purchase.weightKg }),
      },
      token,
    ),

  /**
   * A health event (FR-130/131/132/133). Each kind has its own endpoint. Note what is NOT sent: no
   * withdrawal period, only the `productId` the server resolves it from. A client that could send
   * the number could claim a shorter withhold by relabelling.
   */
  recordHealth: (event: StoredHealthEvent, token: string): Promise<void> =>
    post(
      HEALTH_ENDPOINTS[event.kind],
      {
        id: event.id,
        farmId: event.farmId,
        // Animal XOR mob — the server refuses both and refuses neither. A whole-mob dip carries
        // the mob and no animal.
        animalId: event.animalId,
        mobId: event.mobId ?? null,
        occurredAt: event.occurredAt,
        administeredOn: event.administeredOn,
        productId: event.productId,
        batchId: event.batchId,
        ...(event.doseValue === undefined ? {} : { doseValue: event.doseValue }),
        ...(event.doseUnit === undefined ? {} : { doseUnit: event.doseUnit }),
        ...(event.route === undefined ? {} : { route: event.route }),
        ...(event.administeredBy === undefined ? {} : { administeredBy: event.administeredBy }),
        ...(event.reason === undefined ? {} : { reason: event.reason }),
        ...(event.programme === undefined ? {} : { programme: event.programme }),
        ...(event.method === undefined ? {} : { method: event.method }),
      },
      token,
    ),

  /**
   * A stock-theft incident (FR-603/605). Sent AFTER animals and land units — it points at both —
   * and it is a capture like any other: filed at the fence with no signal, sent later. The one
   * action that is NOT here is generating the evidence pack, which is online-only and lives in
   * `theftApi.ts` for exactly that reason.
   */
  createTheftIncident: (incident: StoredTheftIncident, token: string): Promise<void> =>
    post(
      '/livestock/theft-incidents',
      {
        id: incident.id,
        farmId: incident.farmId,
        discoveredAt: incident.discoveredAt,
        lastSeenAt: incident.lastSeenAt,
        lastSeenLocationGeojson: incident.lastSeenLocationGeojson,
        landUnitId: incident.landUnitId,
        headCount: incident.headCount,
        caseNumber: incident.caseNumber,
        reportingStation: incident.reportingStation,
        observations: incident.observations,
        animalIds: incident.animalIds,
        // ⛔ Note what is absent and must stay absent: there is no suspect field anywhere in this
        // chain — not in the store, not on the wire, not in the pack. See LocalTheft.tsx.
      },
      token,
    ),

  /** A missing report (FR-605). The last-seen point is required all the way to the wire. */
  recordMissing: (missing: StoredMissing, token: string): Promise<void> =>
    post(
      '/livestock/missing',
      {
        id: missing.id,
        farmId: missing.farmId,
        animalId: missing.animalId,
        occurredAt: missing.occurredAt,
        lastSeenGeojson: missing.lastSeenGeojson,
        ...(missing.cause === undefined ? {} : { cause: missing.cause }),
      },
      token,
    ),
};
