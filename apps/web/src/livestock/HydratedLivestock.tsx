/**
 * The down-sync half of mobs/tallies (phase-checklists.md 3e) — rows another device captured,
 * sent, and the server has already replicated to THIS device via PowerSync, read through the
 * `@werf/sync` adapter and never the SDK directly (ADR-0003). This is the fix for tripwire 3e:
 * before this file existed, `Outbox.tsx`'s `landed()` could only ever mean "did this device send
 * it", which is exact only while nothing hydrates — see `Outbox.tsx`'s own header for the full
 * account of the bug this closes.
 *
 * ⭐ Deliberately NOT a widening of `LocalMobs`/`LocalTallies`. Those stores hold what THIS DEVICE
 * captured, in the local-only `capture_records` table, and `Outbox.tsx`'s upload QUEUE reads them
 * unchanged — a hydrated row must never look like a pending local capture, or a device would
 * re-POST another device's already-landed work. This file is a second, independent read: the
 * canonical `mobs`/`events` tables PowerSync down-syncs into, farm-scoped so a multi-farm account's
 * other farms never leak into this one's fold (Sync Streams are per-user, not per-farm —
 * `packages/sync/src/connector.ts`'s header). Callers that need "everything this device knows
 * about, captured or heard about" merge the two explicitly — see `Outbox.tsx`'s `needsHead` and
 * `herd.ts`'s `useEffectiveMobs` for the two places that do.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createHydratedTableStore, type HydratedTableStore } from '@werf/sync';
import type { TallyRecord } from '@werf/domain';
import { schemas, type AnimalStatus } from '@werf/core';
import { useAuth } from '../auth/AuthProvider';
import { getLocalDatabase } from '../sync/local-db';
import type { StoredMob } from './LocalMobs';
import type { StoredAnimal } from './LocalHerd';
import type { StoredBrandingRegister } from './LocalBranding';
import type { StoredMove } from './LocalMoves';
import type { StoredIdentifier } from './LocalIdentifiers';
import type { StoredTheftIncident } from './LocalTheft';
import type { StoredWeight } from './LocalWeights';
import type {
  MatingMethod,
  PregnancyMethod,
  PregnancyResult,
  StoredBreedingEvent,
} from './LocalBreeding';

const MOBS_SQL =
  'SELECT id, farm_id, enterprise_id, land_unit_id, name, species, head_count, initial_head_count FROM mobs WHERE farm_id = ? AND deleted_at IS NULL';

// `type = 'tally'` and `deleted_at IS NULL` narrow the shared `events` table to exactly the rows
// `projectHeadCount` folds — every other event type is invisible to this query by construction.
const TALLY_EVENTS_SQL =
  "SELECT id, mob_id, occurred_at, payload FROM events WHERE farm_id = ? AND type = 'tally' AND deleted_at IS NULL";

const ANIMALS_SQL =
  'SELECT id, farm_id, enterprise_id, species, breed, sex, dob, dob_estimated, status, status_at, ' +
  'dam_id, sire_id, mob_id, land_unit_id, source, acquired_at, brand_id, brand_applied_at, ' +
  'attributes, photo_key FROM animals WHERE farm_id = ? AND deleted_at IS NULL';

const BRANDING_REGISTERS_SQL =
  'SELECT id, farm_id, jurisdiction, mark, mark_type, species, body_position, ' +
  'certificate_reference, registered_at FROM branding_registers ' +
  'WHERE farm_id = ? AND deleted_at IS NULL';

/** The lifecycle event types `projectHerd`/`residue.ts`/the weaning queue fold — see `herd.ts`. */
const LIFECYCLE_EVENT_TYPES = "('birth','death','sale','missing','purchase','weaning')";
const LIFECYCLE_EVENTS_SQL =
  `SELECT id, animal_id, type, occurred_at, payload FROM events ` +
  `WHERE farm_id = ? AND type IN ${LIFECYCLE_EVENT_TYPES} AND deleted_at IS NULL`;

const MOVE_EVENTS_SQL =
  'SELECT id, farm_id, animal_id, occurred_at, batch_id, payload FROM events ' +
  "WHERE farm_id = ? AND type = 'move' AND deleted_at IS NULL";

const HEALTH_EVENT_TYPES = "('treatment','vaccination','dip')";
const HEALTH_EVENTS_SQL =
  `SELECT id, animal_id, mob_id, payload FROM events ` +
  `WHERE farm_id = ? AND type IN ${HEALTH_EVENT_TYPES} AND deleted_at IS NULL`;

const IDENTIFIERS_SQL =
  'SELECT id, farm_id, animal_id, type, value, is_primary, applied_at FROM animal_identifiers ' +
  'WHERE farm_id = ? AND deleted_at IS NULL';

const THEFT_INCIDENTS_SQL =
  'SELECT id, farm_id, discovered_at, last_seen_at, last_seen_location_geojson, land_unit_id, ' +
  'head_count, case_number, reporting_station, observations FROM theft_incidents ' +
  'WHERE farm_id = ? AND deleted_at IS NULL';

// ⭐ The per-animal join (surrogate id added migration 0025, issue #10) — a SEPARATE table, watched
// separately and folded onto incidents in TS (`useHydratedTheftIncidents`), the same "no JOINs in a
// hydrated query" shape every other query in this file already uses. Deliberately not GROUP_CONCAT
// in a single joined query: it would be the only JOIN in this file and untestable against the fake
// local database (`@werf/sync/testing`), which recognizes queries by single-table shape.
const THEFT_INCIDENT_ANIMALS_SQL =
  'SELECT id, farm_id, incident_id, animal_id FROM theft_incident_animals ' +
  'WHERE farm_id = ? AND deleted_at IS NULL';

const WEIGHT_EVENTS_SQL =
  'SELECT id, farm_id, animal_id, occurred_at, payload FROM events ' +
  "WHERE farm_id = ? AND type = 'weight' AND deleted_at IS NULL";

const BREEDING_EVENT_TYPES = "('mating','pregnancy_test')";
const BREEDING_EVENTS_SQL =
  `SELECT id, farm_id, animal_id, type, occurred_at, payload FROM events ` +
  `WHERE farm_id = ? AND type IN ${BREEDING_EVENT_TYPES} AND deleted_at IS NULL`;

/** Tolerant per row — a row written by a future schema version this build does not understand is
 *  skipped, not fatal, same philosophy as `sqlite-capture-store.ts`'s payload parsing. */
function mapHydratedMob(row: Record<string, unknown>): StoredMob | null {
  const id = row['id'];
  const farmId = row['farm_id'];
  const name = row['name'];
  const species = row['species'];
  if (
    typeof id !== 'string' ||
    typeof farmId !== 'string' ||
    typeof name !== 'string' ||
    typeof species !== 'string'
  ) {
    return null;
  }
  const headCount = row['head_count'];
  const initialHeadCount = row['initial_head_count'];
  return {
    id,
    farmId,
    enterpriseId: typeof row['enterprise_id'] === 'string' ? row['enterprise_id'] : null,
    landUnitId: typeof row['land_unit_id'] === 'string' ? row['land_unit_id'] : null,
    name,
    species: species as StoredMob['species'],
    headCount: typeof headCount === 'number' ? headCount : null,
    initialHeadCount: typeof initialHeadCount === 'number' ? initialHeadCount : null,
  };
}

/** Same tolerance, plus a `JSON.parse` of the event payload — the same shape
 *  `recordMobTally` (`@werf/domain`) writes, read back rather than duplicated. */
function mapHydratedTally(row: Record<string, unknown>): TallyRecord | null {
  const id = row['id'];
  const mobId = row['mob_id'];
  const occurredAt = row['occurred_at'];
  const payloadJson = row['payload'];
  if (
    typeof id !== 'string' ||
    typeof mobId !== 'string' ||
    typeof occurredAt !== 'string' ||
    typeof payloadJson !== 'string'
  ) {
    return null;
  }
  // ⭐ Normalize to the exact `.toISOString()` format a local capture writes. Postgres's
  // `timestamptz` does not guarantee the SQLite column comes back as ISO-8601-with-`T` — a
  // `2026-07-25 12:00:00+00` (space, not `T`) byte-sorts BEFORE every local tally on the same
  // instant, silently breaking the `(occurredAt, id)` total order `projectHeadCount` depends on.
  // Parsing to a Date and re-emitting ISO makes the wire format a non-issue rather than a
  // load-bearing assumption.
  const occurredAtDate = new Date(occurredAt);
  if (Number.isNaN(occurredAtDate.getTime())) return null;
  const occurredAtIso = occurredAtDate.toISOString();
  try {
    const payload: unknown = JSON.parse(payloadJson);
    if (typeof payload !== 'object' || payload === null || !('reason' in payload)) return null;
    const {
      reason,
      delta,
      countedHead,
      counterpartMobId,
      carriedWithholdUntil,
      declaredWithdrawalUntil,
    } = payload as {
      reason: unknown;
      delta?: unknown;
      countedHead?: unknown;
      counterpartMobId?: unknown;
      carriedWithholdUntil?: unknown;
      declaredWithdrawalUntil?: unknown;
    };
    if (typeof reason !== 'string') return null;
    return {
      id,
      mobId,
      occurredAt: occurredAtIso,
      reason: reason as TallyRecord['reason'],
      ...(typeof delta === 'number' ? { delta } : {}),
      ...(typeof countedHead === 'number' ? { countedHead } : {}),
      // ⭐ sync-auditor Finding 1 (2026-08-10): these three were parsed off local captures
      // (`StoredTally`) but silently dropped for a HYDRATED tally, so `withdrawal.ts`'s guard was
      // blind to a withholding that arrived only via down-sync — see `withdrawal.ts` and the two
      // call sites that merge this store in (`AdjustMobScreen.tsx`, `Outbox.tsx`).
      ...(typeof counterpartMobId === 'string' ? { counterpartMobId } : {}),
      ...(typeof carriedWithholdUntil === 'string' ? { carriedWithholdUntil } : {}),
      ...(typeof declaredWithdrawalUntil === 'string' ? { declaredWithdrawalUntil } : {}),
    };
  } catch {
    return null;
  }
}

/** Tolerant per row, same shape `recordAnimal` (`@werf/domain`) writes. `dob_estimated`/`attributes`
 *  round-trip as SQLite INTEGER/TEXT — decoded the same way `sqlite-capture-store.ts` decodes any
 *  local row, not assumed. */
function mapHydratedAnimal(row: Record<string, unknown>): StoredAnimal | null {
  const id = row['id'];
  const farmId = row['farm_id'];
  const species = row['species'];
  const sex = row['sex'];
  if (
    typeof id !== 'string' ||
    typeof farmId !== 'string' ||
    typeof species !== 'string' ||
    typeof sex !== 'string'
  ) {
    return null;
  }
  const attributesJson = row['attributes'];
  let attributes: Record<string, unknown> = {};
  if (typeof attributesJson === 'string') {
    try {
      const parsed: unknown = JSON.parse(attributesJson);
      if (typeof parsed === 'object' && parsed !== null)
        attributes = parsed as Record<string, unknown>;
    } catch {
      // Tolerant: an unreadable attributes blob loses only the species-specific extras, not the row.
    }
  }
  const str = (key: string): string | null =>
    typeof row[key] === 'string' ? (row[key] as string) : null;
  // `statusAt` is the one `Date`-typed field here (`timestampSchema`, unlike the plain
  // YYYY-MM-DD `dateSchema` every other date on this row uses) — see primitives.ts.
  const statusAtRaw = row['status_at'];
  const statusAtDate = typeof statusAtRaw === 'string' ? new Date(statusAtRaw) : null;
  const status = row['status'];
  return {
    id,
    farmId,
    enterpriseId: str('enterprise_id'),
    species: species as StoredAnimal['species'],
    breed: str('breed'),
    sex: sex as StoredAnimal['sex'],
    dob: str('dob'),
    dobEstimated: row['dob_estimated'] === 1,
    status: (typeof status === 'string' ? status : 'alive') as StoredAnimal['status'],
    statusAt: statusAtDate !== null && !Number.isNaN(statusAtDate.getTime()) ? statusAtDate : null,
    damId: str('dam_id'),
    sireId: str('sire_id'),
    mobId: str('mob_id'),
    landUnitId: str('land_unit_id'),
    source: str('source'),
    acquiredAt: str('acquired_at'),
    brandId: str('brand_id'),
    brandAppliedAt: str('brand_applied_at'),
    attributes,
    photoKey: str('photo_key'),
  };
}

/** PostgreSQL arrays cross the SQLite boundary as JSON text; tolerate a native array in tests. */
export function mapHydratedBrandingRegister(
  row: Record<string, unknown>,
): StoredBrandingRegister | null {
  const speciesRaw = row['species'];
  let species: unknown = speciesRaw;
  if (typeof speciesRaw === 'string') {
    try {
      species = JSON.parse(speciesRaw) as unknown;
    } catch {
      return null;
    }
  }

  const parsed = schemas.newBrandingRegisterSchema.safeParse({
    id: row['id'],
    farmId: row['farm_id'],
    jurisdiction: row['jurisdiction'],
    mark: row['mark'],
    markType: row['mark_type'],
    species,
    bodyPosition: row['body_position'],
    certificateReference: row['certificate_reference'],
    registeredAt: row['registered_at'],
  });
  return parsed.success ? parsed.data : null;
}

/**
 * The fold's own minimal shape for a lifecycle event — everything `projectHerd`'s status fold
 * (`herd.ts`), the weaning queue's dedup, and `residue.ts`'s disposal scan read, and nothing a
 * hydrated row cannot supply. `status` is DERIVED from `type` here rather than read off the wire —
 * the server never stores it (a lifecycle event's status transition is a client+server READ-MODEL
 * projection, never a column — see `livestock.service.ts`'s `recordDeath`), so local and hydrated
 * events derive it the identical way.
 */
export interface HydratedLifecycleEvent {
  readonly id: string;
  readonly animalId: string;
  readonly type: 'birth' | 'death' | 'sale' | 'missing' | 'purchase' | 'weaning';
  readonly status: AnimalStatus | null;
  readonly occurredAt: string;
  /** Death only — whether the death was a slaughter (FR-131 food-chain disposal). */
  readonly slaughtered?: boolean;
}

function statusForLifecycleType(type: HydratedLifecycleEvent['type']): AnimalStatus | null {
  switch (type) {
    case 'death':
      return 'dead';
    case 'sale':
      return 'sold';
    case 'missing':
      return 'missing';
    default:
      return null;
  }
}

function mapHydratedLifecycleEvent(row: Record<string, unknown>): HydratedLifecycleEvent | null {
  const id = row['id'];
  const animalId = row['animal_id'];
  const type = row['type'];
  const occurredAtRaw = row['occurred_at'];
  if (
    typeof id !== 'string' ||
    typeof animalId !== 'string' ||
    typeof type !== 'string' ||
    typeof occurredAtRaw !== 'string'
  ) {
    return null;
  }
  if (
    type !== 'birth' &&
    type !== 'death' &&
    type !== 'sale' &&
    type !== 'missing' &&
    type !== 'purchase' &&
    type !== 'weaning'
  ) {
    return null;
  }
  const occurredAtDate = new Date(occurredAtRaw);
  if (Number.isNaN(occurredAtDate.getTime())) return null;
  let slaughtered: boolean | undefined;
  if (type === 'death') {
    const payloadJson = row['payload'];
    if (typeof payloadJson === 'string') {
      try {
        const payload: unknown = JSON.parse(payloadJson);
        if (typeof payload === 'object' && payload !== null && 'slaughtered' in payload) {
          const value = (payload as { slaughtered?: unknown }).slaughtered;
          if (value === true) slaughtered = true;
        }
      } catch {
        // Tolerant: an unreadable payload still yields the death fact itself, just not the flag.
      }
    }
  }
  return {
    id,
    animalId,
    type,
    status: statusForLifecycleType(type),
    occurredAt: occurredAtDate.toISOString(),
    ...(slaughtered === true ? { slaughtered: true } : {}),
  };
}

/**
 * Same tolerance as `mapHydratedTally`. `toLandUnitId`/`toMobId` come back from the wire ALWAYS
 * defined (the server resolves "unchanged" to the concrete prior value before storing — see
 * `movement.ts`'s `recordMove`), never `undefined` the way a fresh local capture's omitted field
 * is — so `herd.ts`'s `positionByAnimal` always treats a hydrated move as a real position, which is
 * exactly right: the wire's resolved destination IS the position, whether or not it changed.
 */
function mapHydratedMove(row: Record<string, unknown>): StoredMove | null {
  const id = row['id'];
  const farmId = row['farm_id'];
  const animalId = row['animal_id'];
  const occurredAtRaw = row['occurred_at'];
  const payloadJson = row['payload'];
  if (
    typeof id !== 'string' ||
    typeof farmId !== 'string' ||
    typeof animalId !== 'string' ||
    typeof occurredAtRaw !== 'string' ||
    typeof payloadJson !== 'string'
  ) {
    return null;
  }
  const occurredAtDate = new Date(occurredAtRaw);
  if (Number.isNaN(occurredAtDate.getTime())) return null;
  try {
    const payload: unknown = JSON.parse(payloadJson);
    if (typeof payload !== 'object' || payload === null) return null;
    const { toLandUnitId, toMobId, fromLandUnitId, fromMobId } = payload as {
      toLandUnitId?: unknown;
      toMobId?: unknown;
      fromLandUnitId?: unknown;
      fromMobId?: unknown;
    };
    const batchId = row['batch_id'];
    return {
      id,
      farmId,
      animalId,
      occurredAt: occurredAtDate.toISOString(),
      toLandUnitId: typeof toLandUnitId === 'string' ? toLandUnitId : null,
      toMobId: typeof toMobId === 'string' ? toMobId : null,
      // `movePayloadSchema` always carries these two explicitly (never omitted, per
      // `movement.ts`'s `recordMove`) — present so `withdrawal.ts`'s `mobMembership` can seed the
      // animal's TRUE opening mob from the wire rather than from a hydrated animal's own
      // denormalised (and therefore CURRENT, not opening) `mobId`. Local captures never set these.
      fromLandUnitId: typeof fromLandUnitId === 'string' ? fromLandUnitId : null,
      fromMobId: typeof fromMobId === 'string' ? fromMobId : null,
      batchId: typeof batchId === 'string' ? batchId : null,
    };
  } catch {
    return null;
  }
}

/** What the FR-131 withdrawal guard needs from a hydrated dose — `WithholdDose`'s hydrated half.
 *  No `productId`: the wire payload never carries one (see `withdrawal.ts`'s module header). */
export interface HydratedHealthDose {
  readonly id: string;
  readonly animalId: string | null;
  readonly mobId: string | null;
  readonly administeredOn: string;
  readonly meatWithholdUntil?: string;
}

function mapHydratedHealthDose(row: Record<string, unknown>): HydratedHealthDose | null {
  const id = row['id'];
  const payloadJson = row['payload'];
  if (typeof id !== 'string' || typeof payloadJson !== 'string') return null;
  try {
    const payload: unknown = JSON.parse(payloadJson);
    if (typeof payload !== 'object' || payload === null || !('administeredOn' in payload)) {
      return null;
    }
    const { administeredOn, meatWithholdUntil } = payload as {
      administeredOn: unknown;
      meatWithholdUntil?: unknown;
    };
    if (typeof administeredOn !== 'string') return null;
    const animalId = row['animal_id'];
    const mobId = row['mob_id'];
    return {
      id,
      animalId: typeof animalId === 'string' ? animalId : null,
      mobId: typeof mobId === 'string' ? mobId : null,
      administeredOn,
      ...(typeof meatWithholdUntil === 'string' ? { meatWithholdUntil } : {}),
    };
  } catch {
    return null;
  }
}

function mapHydratedIdentifier(row: Record<string, unknown>): StoredIdentifier | null {
  const id = row['id'];
  const farmId = row['farm_id'];
  const animalId = row['animal_id'];
  const type = row['type'];
  const value = row['value'];
  if (
    typeof id !== 'string' ||
    typeof farmId !== 'string' ||
    typeof animalId !== 'string' ||
    typeof type !== 'string' ||
    typeof value !== 'string'
  ) {
    return null;
  }
  const appliedAt = row['applied_at'];
  return {
    id,
    farmId,
    animalId,
    type: type as StoredIdentifier['type'],
    value,
    isPrimary: row['is_primary'] === 1,
    appliedAt: typeof appliedAt === 'string' ? appliedAt : null,
  };
}

/** `animalIds` is always `[]` here — a hydrated incident row carries no join. It is filled in by
 *  `useHydratedTheftIncidents`, which folds `theftIncidentAnimalLinks` on afterward (issue #10,
 *  closed migration 0025). */
function mapHydratedTheftIncident(row: Record<string, unknown>): StoredTheftIncident | null {
  const id = row['id'];
  const farmId = row['farm_id'];
  const discoveredAt = row['discovered_at'];
  const headCount = row['head_count'];
  if (
    typeof id !== 'string' ||
    typeof farmId !== 'string' ||
    typeof discoveredAt !== 'string' ||
    typeof headCount !== 'number'
  ) {
    return null;
  }
  const str = (key: string): string | null =>
    typeof row[key] === 'string' ? (row[key] as string) : null;
  return {
    id,
    farmId,
    discoveredAt,
    lastSeenAt: str('last_seen_at'),
    lastSeenLocationGeojson: str('last_seen_location_geojson'),
    landUnitId: str('land_unit_id'),
    headCount,
    caseNumber: str('case_number'),
    reportingStation: str('reporting_station'),
    observations: str('observations'),
    animalIds: [],
  };
}

/** One row of the per-animal join a theft incident concerns (issue #10, migration 0025). Not
 *  exported as its own hook — folded onto incidents by `useHydratedTheftIncidents` before any
 *  screen sees it, the same way a hydrated move's `fromMobId` is derived rather than read raw.
 *  Exported as a TYPE only, for `attachAnimalIds`'s unit tests. */
export interface HydratedTheftIncidentAnimalLink {
  readonly id: string;
  readonly farmId: string;
  readonly incidentId: string;
  readonly animalId: string;
}

function mapHydratedTheftIncidentAnimalLink(
  row: Record<string, unknown>,
): HydratedTheftIncidentAnimalLink | null {
  const id = row['id'];
  const farmId = row['farm_id'];
  const incidentId = row['incident_id'];
  const animalId = row['animal_id'];
  if (
    typeof id !== 'string' ||
    typeof farmId !== 'string' ||
    typeof incidentId !== 'string' ||
    typeof animalId !== 'string'
  ) {
    return null;
  }
  return { id, farmId, incidentId, animalId };
}

function mapHydratedWeight(row: Record<string, unknown>): StoredWeight | null {
  const id = row['id'];
  const farmId = row['farm_id'];
  const animalId = row['animal_id'];
  const occurredAtRaw = row['occurred_at'];
  const payloadJson = row['payload'];
  if (
    typeof id !== 'string' ||
    typeof farmId !== 'string' ||
    typeof animalId !== 'string' ||
    typeof occurredAtRaw !== 'string' ||
    typeof payloadJson !== 'string'
  ) {
    return null;
  }
  const occurredAtDate = new Date(occurredAtRaw);
  if (Number.isNaN(occurredAtDate.getTime())) return null;
  try {
    const payload: unknown = JSON.parse(payloadJson);
    if (typeof payload !== 'object' || payload === null) return null;
    const { kg, method } = payload as { kg?: unknown; method?: unknown };
    if (typeof kg !== 'number' || typeof method !== 'string') return null;
    return {
      id,
      farmId,
      animalId,
      kg,
      method: method as StoredWeight['method'],
      occurredAt: occurredAtDate.toISOString(),
    };
  } catch {
    return null;
  }
}

function mapHydratedBreedingEvent(row: Record<string, unknown>): StoredBreedingEvent | null {
  const id = row['id'];
  const farmId = row['farm_id'];
  const animalId = row['animal_id'];
  const type = row['type'];
  const occurredAtRaw = row['occurred_at'];
  const payloadJson = row['payload'];
  if (
    typeof id !== 'string' ||
    typeof farmId !== 'string' ||
    typeof animalId !== 'string' ||
    (type !== 'mating' && type !== 'pregnancy_test') ||
    typeof occurredAtRaw !== 'string' ||
    typeof payloadJson !== 'string'
  ) {
    return null;
  }
  const occurredAtDate = new Date(occurredAtRaw);
  if (Number.isNaN(occurredAtDate.getTime())) return null;
  const occurredAt = occurredAtDate.toISOString();
  try {
    const payload: unknown = JSON.parse(payloadJson);
    if (typeof payload !== 'object' || payload === null) return null;
    if (type === 'mating') {
      const { method, sireId, sireCode, bullInAt, bullOutAt } = payload as {
        method?: unknown;
        sireId?: unknown;
        sireCode?: unknown;
        bullInAt?: unknown;
        bullOutAt?: unknown;
      };
      if (typeof method !== 'string') return null;
      return {
        id,
        farmId,
        animalId,
        occurredAt,
        kind: 'mating',
        method: method as MatingMethod,
        ...(typeof sireId === 'string' ? { sireId } : {}),
        ...(typeof sireCode === 'string' ? { sireCode } : {}),
        ...(typeof bullInAt === 'string' ? { bullInAt } : {}),
        ...(typeof bullOutAt === 'string' ? { bullOutAt } : {}),
      };
    }
    const { method, result, matingDate } = payload as {
      method?: unknown;
      result?: unknown;
      matingDate?: unknown;
    };
    if (typeof method !== 'string' || typeof result !== 'string') return null;
    return {
      id,
      farmId,
      animalId,
      occurredAt,
      kind: 'pregnancyTest',
      method: method as PregnancyMethod,
      result: result as PregnancyResult,
      ...(typeof matingDate === 'string' ? { matingDate } : {}),
    };
  } catch {
    return null;
  }
}

interface HydratedLivestockValue {
  readonly mobs: HydratedTableStore<StoredMob>;
  readonly tallies: HydratedTableStore<TallyRecord>;
  readonly animals: HydratedTableStore<StoredAnimal>;
  readonly brandingRegisters: HydratedTableStore<StoredBrandingRegister>;
  readonly lifecycleEvents: HydratedTableStore<HydratedLifecycleEvent>;
  readonly moves: HydratedTableStore<StoredMove>;
  readonly healthEvents: HydratedTableStore<HydratedHealthDose>;
  readonly identifiers: HydratedTableStore<StoredIdentifier>;
  readonly theftIncidents: HydratedTableStore<StoredTheftIncident>;
  readonly theftIncidentAnimalLinks: HydratedTableStore<HydratedTheftIncidentAnimalLink>;
  readonly weights: HydratedTableStore<StoredWeight>;
  readonly breedingEvents: HydratedTableStore<StoredBreedingEvent>;
}

/** Permanently unsettled, no subscription to close — safe to construct during render (StrictMode's
 *  render-phase double-invoke is harmless against pure, side-effect-free code, unlike
 *  `createHydratedTableStore` itself, which fires a real `db.watch()`). Exists only for the single
 *  render before the effect below constructs the real pair — `settled()` already starts `false` by
 *  design, so this is one more tick of a state every consumer already tolerates, not a new one.
 *  `all()` returns the SAME empty array every call — `useSyncExternalStore` compares snapshots by
 *  reference, so a fresh `[]` literal per call reads as "always changed" and warns/loops. */
function emptyHydratedTableStore<T>(): HydratedTableStore<T> {
  const empty: readonly T[] = [];
  return {
    all: () => empty,
    subscribe: () => () => {},
    settled: () => false,
    hydrationFailed: () => false,
    close: () => {},
  };
}

const HydratedLivestockContext = createContext<HydratedLivestockValue | null>(null);

export function HydratedLivestockProvider({ children }: { children: ReactNode }) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const [value, setValue] = useState<HydratedLivestockValue>(() => ({
    mobs: emptyHydratedTableStore<StoredMob>(),
    tallies: emptyHydratedTableStore<TallyRecord>(),
    animals: emptyHydratedTableStore<StoredAnimal>(),
    brandingRegisters: emptyHydratedTableStore<StoredBrandingRegister>(),
    lifecycleEvents: emptyHydratedTableStore<HydratedLifecycleEvent>(),
    moves: emptyHydratedTableStore<StoredMove>(),
    healthEvents: emptyHydratedTableStore<HydratedHealthDose>(),
    identifiers: emptyHydratedTableStore<StoredIdentifier>(),
    theftIncidents: emptyHydratedTableStore<StoredTheftIncident>(),
    theftIncidentAnimalLinks: emptyHydratedTableStore<HydratedTheftIncidentAnimalLink>(),
    weights: emptyHydratedTableStore<StoredWeight>(),
    breedingEvents: emptyHydratedTableStore<StoredBreedingEvent>(),
  }));

  // ⭐ sync-auditor re-pass (2026-08-10): the store pair used to be built in a `useMemo` above this
  // effect, whose cleanup closed it. That is NOT symmetric under React 18 StrictMode: mount → run
  // this effect → immediately simulate an unmount (run the cleanup) → remount (re-run the effect) —
  // all against the SAME memoized pair, since `farmId` never changed across that synthetic cycle.
  // The cleanup closed it; nothing reconstructed it; `AbortController.abort()` has no undo — down-
  // sync hydration died permanently after the FIRST real mount in `pnpm dev` (`main.tsx` wraps
  // `<App/>` in `<StrictMode>`), invisibly, because production strips the double-invoke and every
  // existing test rendered without it. Fixed by moving construction INSIDE the effect, mirroring
  // `SyncConnection.tsx`'s already-established shape for exactly this class of resource: this
  // effect's own setup and cleanup are now symmetric, so a StrictMode synthetic cycle closes one
  // pair and builds a fresh one, precisely as it does for a real farm switch or unmount.
  useEffect(() => {
    const pair: HydratedLivestockValue = {
      mobs: createHydratedTableStore({
        database: getLocalDatabase(),
        sql: MOBS_SQL,
        params: [farmId],
        mapRow: mapHydratedMob,
      }),
      tallies: createHydratedTableStore({
        database: getLocalDatabase(),
        sql: TALLY_EVENTS_SQL,
        params: [farmId],
        mapRow: mapHydratedTally,
      }),
      animals: createHydratedTableStore({
        database: getLocalDatabase(),
        sql: ANIMALS_SQL,
        params: [farmId],
        mapRow: mapHydratedAnimal,
      }),
      brandingRegisters: createHydratedTableStore({
        database: getLocalDatabase(),
        sql: BRANDING_REGISTERS_SQL,
        params: [farmId],
        mapRow: mapHydratedBrandingRegister,
      }),
      lifecycleEvents: createHydratedTableStore({
        database: getLocalDatabase(),
        sql: LIFECYCLE_EVENTS_SQL,
        params: [farmId],
        mapRow: mapHydratedLifecycleEvent,
      }),
      moves: createHydratedTableStore({
        database: getLocalDatabase(),
        sql: MOVE_EVENTS_SQL,
        params: [farmId],
        mapRow: mapHydratedMove,
      }),
      healthEvents: createHydratedTableStore({
        database: getLocalDatabase(),
        sql: HEALTH_EVENTS_SQL,
        params: [farmId],
        mapRow: mapHydratedHealthDose,
      }),
      identifiers: createHydratedTableStore({
        database: getLocalDatabase(),
        sql: IDENTIFIERS_SQL,
        params: [farmId],
        mapRow: mapHydratedIdentifier,
      }),
      theftIncidents: createHydratedTableStore({
        database: getLocalDatabase(),
        sql: THEFT_INCIDENTS_SQL,
        params: [farmId],
        mapRow: mapHydratedTheftIncident,
      }),
      theftIncidentAnimalLinks: createHydratedTableStore({
        database: getLocalDatabase(),
        sql: THEFT_INCIDENT_ANIMALS_SQL,
        params: [farmId],
        mapRow: mapHydratedTheftIncidentAnimalLink,
      }),
      weights: createHydratedTableStore({
        database: getLocalDatabase(),
        sql: WEIGHT_EVENTS_SQL,
        params: [farmId],
        mapRow: mapHydratedWeight,
      }),
      breedingEvents: createHydratedTableStore({
        database: getLocalDatabase(),
        sql: BREEDING_EVENTS_SQL,
        params: [farmId],
        mapRow: mapHydratedBreedingEvent,
      }),
    };
    setValue(pair);
    return () => {
      pair.mobs.close();
      pair.tallies.close();
      pair.animals.close();
      pair.brandingRegisters.close();
      pair.lifecycleEvents.close();
      pair.moves.close();
      pair.healthEvents.close();
      pair.identifiers.close();
      pair.theftIncidents.close();
      pair.theftIncidentAnimalLinks.close();
      pair.weights.close();
      pair.breedingEvents.close();
    };
  }, [farmId]);
  return (
    <HydratedLivestockContext.Provider value={value}>{children}</HydratedLivestockContext.Provider>
  );
}

function useHydratedLivestock(): HydratedLivestockValue {
  const ctx = useContext(HydratedLivestockContext);
  if (!ctx) throw new Error('useHydrated* must be used inside a HydratedLivestockProvider');
  return ctx;
}

/** Mobs another device created and the server has replicated to this one. */
export function useHydratedMobs(): readonly StoredMob[] {
  const { mobs } = useHydratedLivestock();
  return useSyncExternalStore(mobs.subscribe, mobs.all);
}

/** Whether the first local read of the down-synced `mobs` table has completed — see
 *  `hydrated-table-store.ts`'s header for why this is never `waitForFirstSync()`. */
export function useHydratedMobsSettled(): boolean {
  const { mobs } = useHydratedLivestock();
  return useSyncExternalStore(mobs.subscribe, mobs.settled);
}

export function useHydratedMobsHydrationFailed(): boolean {
  const { mobs } = useHydratedLivestock();
  return useSyncExternalStore(mobs.subscribe, mobs.hydrationFailed);
}

/** Tallies another device sent and the server has replicated to this one, in `TallyRecord` shape
 *  — everything `projectHeadCount` needs, nothing this device did not verify (no `count`, which
 *  only the capturing device's `StoredTally` carries). */
export function useHydratedTallies(): readonly TallyRecord[] {
  const { tallies } = useHydratedLivestock();
  return useSyncExternalStore(tallies.subscribe, tallies.all);
}

export function useHydratedTalliesSettled(): boolean {
  const { tallies } = useHydratedLivestock();
  return useSyncExternalStore(tallies.subscribe, tallies.settled);
}

export function useHydratedTalliesHydrationFailed(): boolean {
  const { tallies } = useHydratedLivestock();
  return useSyncExternalStore(tallies.subscribe, tallies.hydrationFailed);
}

/** Animals another device registered and the server has replicated to this one. */
export function useHydratedAnimals(): readonly StoredAnimal[] {
  const { animals } = useHydratedLivestock();
  return useSyncExternalStore(animals.subscribe, animals.all);
}

export function useHydratedAnimalsSettled(): boolean {
  const { animals } = useHydratedLivestock();
  return useSyncExternalStore(animals.subscribe, animals.settled);
}

export function useHydratedAnimalsHydrationFailed(): boolean {
  const { animals } = useHydratedLivestock();
  return useSyncExternalStore(animals.subscribe, animals.hydrationFailed);
}

/** Registered marks sent by this or another device and replicated back down. */
export function useHydratedBrandingRegisters(): readonly StoredBrandingRegister[] {
  const { brandingRegisters } = useHydratedLivestock();
  return useSyncExternalStore(brandingRegisters.subscribe, brandingRegisters.all);
}

/** Births/deaths/sales/missing reports/purchases/weanings another device sent, already replicated
 *  to this one — everything `herd.ts`'s `projectHerd` status fold reads. */
export function useHydratedLifecycleEvents(): readonly HydratedLifecycleEvent[] {
  const { lifecycleEvents } = useHydratedLivestock();
  return useSyncExternalStore(lifecycleEvents.subscribe, lifecycleEvents.all);
}

export function useHydratedLifecycleEventsSettled(): boolean {
  const { lifecycleEvents } = useHydratedLivestock();
  return useSyncExternalStore(lifecycleEvents.subscribe, lifecycleEvents.settled);
}

export function useHydratedLifecycleEventsHydrationFailed(): boolean {
  const { lifecycleEvents } = useHydratedLivestock();
  return useSyncExternalStore(lifecycleEvents.subscribe, lifecycleEvents.hydrationFailed);
}

/** Walks another device recorded and the server has replicated to this one — what `herd.ts`'s
 *  `positionByAnimal` and `withdrawal.ts`'s mob-membership reconstruction both fold over. */
export function useHydratedMoves(): readonly StoredMove[] {
  const { moves } = useHydratedLivestock();
  return useSyncExternalStore(moves.subscribe, moves.all);
}

export function useHydratedMovesSettled(): boolean {
  const { moves } = useHydratedLivestock();
  return useSyncExternalStore(moves.subscribe, moves.settled);
}

export function useHydratedMovesHydrationFailed(): boolean {
  const { moves } = useHydratedLivestock();
  return useSyncExternalStore(moves.subscribe, moves.hydrationFailed);
}

/** Treatments/vaccinations/dips another device gave and the server has replicated to this one, in
 *  `HydratedHealthDose` shape — the FR-131 withdrawal guard's authoritative half (`withdrawal.ts`). */
export function useHydratedHealthEvents(): readonly HydratedHealthDose[] {
  const { healthEvents } = useHydratedLivestock();
  return useSyncExternalStore(healthEvents.subscribe, healthEvents.all);
}

export function useHydratedHealthEventsSettled(): boolean {
  const { healthEvents } = useHydratedLivestock();
  return useSyncExternalStore(healthEvents.subscribe, healthEvents.settled);
}

export function useHydratedHealthEventsHydrationFailed(): boolean {
  const { healthEvents } = useHydratedLivestock();
  return useSyncExternalStore(healthEvents.subscribe, healthEvents.hydrationFailed);
}

/** Identifiers another device applied and the server has replicated to this one — what the
 *  duplicate-tag guard (`LocalIdentifiers.tsx`'s `useTakenValues`) must check against. */
export function useHydratedIdentifiers(): readonly StoredIdentifier[] {
  const { identifiers } = useHydratedLivestock();
  return useSyncExternalStore(identifiers.subscribe, identifiers.all);
}

export function useHydratedIdentifiersSettled(): boolean {
  const { identifiers } = useHydratedLivestock();
  return useSyncExternalStore(identifiers.subscribe, identifiers.settled);
}

export function useHydratedIdentifiersHydrationFailed(): boolean {
  const { identifiers } = useHydratedLivestock();
  return useSyncExternalStore(identifiers.subscribe, identifiers.hydrationFailed);
}

/** Groups `links` by `incidentId` and replaces each incident's `animalIds` with the matching
 *  group — pure, so `useHydratedTheftIncidents` can memoize it. An incident with no links keeps
 *  the `[]` `mapHydratedTheftIncident` already set. Exported for unit testing, the same reason
 *  `mergeById`/`mergeByIdPreferHydrated` are: no React, no fake database, no farm scoping to
 *  thread through — the property this fold has to hold is a fact about the function alone. */
export function attachAnimalIds(
  incidents: readonly StoredTheftIncident[],
  links: readonly HydratedTheftIncidentAnimalLink[],
): readonly StoredTheftIncident[] {
  if (links.length === 0) return incidents;
  const byIncident = new Map<string, string[]>();
  for (const link of links) {
    const group = byIncident.get(link.incidentId);
    if (group) group.push(link.animalId);
    else byIncident.set(link.incidentId, [link.animalId]);
  }
  return incidents.map((incident) => {
    const animalIds = byIncident.get(incident.id);
    return animalIds === undefined ? incident : { ...incident, animalIds };
  });
}

/** Theft incidents another device filed and the server has replicated to this one, `animalIds`
 *  included: folded on here from the separately watched `theft_incident_animals` join (issue #10,
 *  closed migration 0025) rather than read raw off either store — no screen should have to know
 *  the ownership chain is two tables under the hood, the same "derive, don't read the column
 *  raw" rule `herd.ts` applies to a hydrated animal's `status`/position. */
export function useHydratedTheftIncidents(): readonly StoredTheftIncident[] {
  const { theftIncidents, theftIncidentAnimalLinks } = useHydratedLivestock();
  const incidents = useSyncExternalStore(theftIncidents.subscribe, theftIncidents.all);
  const links = useSyncExternalStore(
    theftIncidentAnimalLinks.subscribe,
    theftIncidentAnimalLinks.all,
  );
  return useMemo(() => attachAnimalIds(incidents, links), [incidents, links]);
}

export function useHydratedTheftIncidentsSettled(): boolean {
  const { theftIncidents, theftIncidentAnimalLinks } = useHydratedLivestock();
  const incidentsSettled = useSyncExternalStore(theftIncidents.subscribe, theftIncidents.settled);
  const linksSettled = useSyncExternalStore(
    theftIncidentAnimalLinks.subscribe,
    theftIncidentAnimalLinks.settled,
  );
  return incidentsSettled && linksSettled;
}

export function useHydratedTheftIncidentsHydrationFailed(): boolean {
  const { theftIncidents, theftIncidentAnimalLinks } = useHydratedLivestock();
  const incidentsFailed = useSyncExternalStore(
    theftIncidents.subscribe,
    theftIncidents.hydrationFailed,
  );
  const linksFailed = useSyncExternalStore(
    theftIncidentAnimalLinks.subscribe,
    theftIncidentAnimalLinks.hydrationFailed,
  );
  return incidentsFailed || linksFailed;
}

/** Weigh readings another device took and the server has replicated to this one. */
export function useHydratedWeights(): readonly StoredWeight[] {
  const { weights } = useHydratedLivestock();
  return useSyncExternalStore(weights.subscribe, weights.all);
}

export function useHydratedWeightsSettled(): boolean {
  const { weights } = useHydratedLivestock();
  return useSyncExternalStore(weights.subscribe, weights.settled);
}

export function useHydratedWeightsHydrationFailed(): boolean {
  const { weights } = useHydratedLivestock();
  return useSyncExternalStore(weights.subscribe, weights.hydrationFailed);
}

/** Matings/pregnancy diagnoses another device recorded and the server has replicated to this one. */
export function useHydratedBreedingEvents(): readonly StoredBreedingEvent[] {
  const { breedingEvents } = useHydratedLivestock();
  return useSyncExternalStore(breedingEvents.subscribe, breedingEvents.all);
}

export function useHydratedBreedingEventsSettled(): boolean {
  const { breedingEvents } = useHydratedLivestock();
  return useSyncExternalStore(breedingEvents.subscribe, breedingEvents.settled);
}

export function useHydratedBreedingEventsHydrationFailed(): boolean {
  const { breedingEvents } = useHydratedLivestock();
  return useSyncExternalStore(breedingEvents.subscribe, breedingEvents.hydrationFailed);
}

/**
 * Merges a device's own captures with the hydrated copies of the same canonical rows, local
 * winning on a shared id — the two are two views of the SAME row once the server has both, and
 * only one of them should ever reach a fold. Used by both `Outbox.tsx`'s `needsHead` arithmetic
 * and `herd.ts`'s read projection, so the two cannot disagree about what "this device knows about"
 * means. Local wins on a collision because it can never be staler than the hydrated copy for the
 * fields a LOCAL capture actually carries.
 *
 * That caveat matters: for most tables the local and hydrated shapes are identical, so "local
 * wins" and "hydrated wins" pick the same values. But `StoredMove` and `WithholdDose` are NOT
 * that case — the hydrated echo carries fields (`fromMobId`/`fromLandUnitId`, `meatWithholdUntil`)
 * that a local capture never populates, because the server derives them at write time and never
 * sends them back down as an app-authored field. `mergeById`'s local-wins here permanently
 * shadows that enrichment once this device's own capture has synced and echoed back with the same
 * id — a compliance-checker finding on FR-131 (see `mergeByIdPreferHydrated` below). Use THIS
 * function only for tables where the local and hydrated shapes carry the same information.
 */
export function mergeById<T extends { id: string }>(
  local: readonly T[],
  hydrated: readonly T[],
): readonly T[] {
  if (hydrated.length === 0) return local;
  const seen = new Set(local.map((row) => row.id));
  const extra = hydrated.filter((row) => !seen.has(row.id));
  return extra.length === 0 ? local : [...local, ...extra];
}

/**
 * Same fold as `mergeById`, but the HYDRATED copy wins on a shared id.
 *
 * The criterion is not "every field local carries, hydrated carries too" — `WithholdDose` already
 * breaks that (hydrated drops `productId`). The real test is: does every FOLD CONSUMER's read of
 * this shape still resolve correctly if hydrated wins? For `StoredMove`/`WithholdDose` it does,
 * because the fields hydrated adds (`fromMobId`/`fromLandUnitId`, `meatWithholdUntil`) are the ones
 * FR-131's withdrawal guard actually reads, and `clearDateFor` (`withdrawal.ts`) already prefers
 * `meatWithholdUntil` over `productId` when both exist — so losing `productId` on a hydrated-wins
 * dose is never load-bearing. Once this device's own write has round-tripped through the server and
 * come back down as a hydrated row with the SAME id, the hydrated copy is strictly more informative
 * for what the guard reads — never staler, sometimes richer — so preferring it closes the
 * false-CLEAR gap `mergeById`'s local-wins leaves open.
 *
 * Do NOT reach for this on a table where the hydrated shape is a REDUCTION of a field a consumer
 * DOES trust directly (e.g. `TallyRecord`, whose hydrated projection drops `count`, which every
 * consumer trusts directly). Animals are a subtler case: the server DOES mutate `mob_id`/
 * `land_unit_id`/status on the row (`livestock.service.ts`'s `recordMove`/lifecycle writes) — this
 * is not a single-creation row — but no fold trusts an animal's position/status straight off the
 * row either way (`herd.ts` re-derives both from the merged move/event logs), so `mergeById` stays
 * correct there too, for the same "what does the consumer actually read" reason, not because the
 * row never changes. Swapping the winner on a table a consumer DOES trust directly would trade one
 * false-CLEAR bug for a different data-loss bug. `mergeById`'s local-wins is still correct — and
 * still the default — everywhere else.
 *
 * A local-only row (not yet synced, so it has no hydrated twin) is unaffected: it has no id
 * collision, so it always survives the fold untouched, pending or not.
 */
export function mergeByIdPreferHydrated<T extends { id: string }>(
  local: readonly T[],
  hydrated: readonly T[],
): readonly T[] {
  return mergeById(hydrated, local);
}
