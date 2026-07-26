/**
 * Event vocabulary (Phase 2). Everything that happens on the farm is an event, and `events`
 * is the append-only heart of the system (database-schema.md § 5). This array is the app half
 * of the `event_type` Postgres enum; the DB half is generated from it in @werf/db, so the two
 * cannot drift. Adding a value is a code release AND a migration — the enum is enumerated on
 * purpose (unlike `species`, which is free `text`), because every event type has a payload
 * shape the system must know how to validate.
 *
 * Grouped by domain, but ONE table and ONE enum hold them all: the append-only log is the
 * single source of history for animals, land, and labour alike. Only the livestock group is in
 * Phase 2 scope; the crop and labour types exist in the enum from day one (so no ALTER TYPE is
 * needed across partitioned farms later) but their payloads are tightened in their own phases.
 * `rainfall` is the exception that proves the rule — it was not foreseen, so it cost a migration.
 */

export const EVENT_TYPES = [
  // ── Livestock (Phase 2) ──────────────────────────────────────────────────
  'birth',
  'death',
  'weight',
  'treatment',
  'vaccination',
  'dip',
  'move',
  'sale',
  'purchase',
  'weaning',
  'mating',
  'pregnancy_test',
  'condition_score',
  'missing',
  'recovered',
  // ── Crop (later phase) ───────────────────────────────────────────────────
  'planting',
  'spray',
  'fertiliser',
  'irrigation',
  'harvest',
  'scouting',
  'soil_test',
  // ── Labour (later phase) ─────────────────────────────────────────────────
  'attendance',
  'piece_work',
  'task_complete',
  // ── Cross-cutting: the farm itself, not one enterprise ───────────────────
  // Appended LAST on purpose. This value did not exist when the enum was created (rainfall was
  // surfaced by the 2026-07-23 mockup review), so it arrives by `ALTER TYPE … ADD VALUE`, which is
  // the one enum DDL that is safe across partitioned farms: it rewrites no table and takes no
  // exclusive lock. Appending here keeps this array in the same order as the Postgres enum, so a
  // future schema diff sees no change. Adding a value in the MIDDLE would not.
  'rainfall',
  // A mob's head count changing, and WHY (FR-102). Appended after `rainfall` for the same reason
  // `rainfall` was appended after the crop and labour types: `ALTER TYPE … ADD VALUE` can only
  // append, so the array must stay in the Postgres enum's order or a later schema diff sees a
  // change that is not one. Filing it beside `birth`/`death` would read better and be wrong.
  'tally',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * The livestock event types Phase 2 owns. Kept separate from the full enum so a report or a
 * capture screen can iterate only the types a livestock farmer sees, without hard-coding a
 * slice of the array by index.
 */
/**
 * The event types that belong to the FARM rather than to a herd — the closed list of exceptions to
 * FR-113 herd scoping. Every other event must file under the herd it concerns (an animal, a mob, or
 * an enterprise), because a mixed farm that cannot tell its cattle events from its sheep events has
 * no usable history. These cannot: rain falls on the whole farm, and both the grazing and the
 * cropping side read the same reading — filing it under one enterprise would hide it from the other.
 *
 * Kept as a list rather than a per-capture decision so the rule has one home. Adding a type here is
 * a deliberate statement that the fact is not about a herd; the FR-113 guard in @werf/domain reads
 * it, so a new event type is herd-scoped by default and must be named here to escape that.
 */
export const FARM_SCOPED_EVENT_TYPES = ['rainfall'] as const satisfies readonly EventType[];
export type FarmScopedEventType = (typeof FARM_SCOPED_EVENT_TYPES)[number];

export function isFarmScopedEventType(type: EventType): type is FarmScopedEventType {
  return (FARM_SCOPED_EVENT_TYPES as readonly EventType[]).includes(type);
}

export const LIVESTOCK_EVENT_TYPES = [
  'birth',
  'death',
  'weight',
  'treatment',
  'vaccination',
  'dip',
  'move',
  'sale',
  'purchase',
  'weaning',
  'mating',
  'pregnancy_test',
  'condition_score',
  'missing',
  'recovered',
] as const satisfies readonly EventType[];
export type LivestockEventType = (typeof LIVESTOCK_EVENT_TYPES)[number];
