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
