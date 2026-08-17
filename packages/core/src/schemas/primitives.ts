/**
 * The primitive schemas every domain schema builds on. Kept in their own module (not the
 * barrel) so entity schemas can import them without a barrel⇄entity import cycle — that
 * cycle is invisible under ESM but throws "cannot access before initialization" the moment
 * a CJS loader (drizzle-kit) evaluates it.
 */

import { z } from 'zod';
import { SUPPORTED_JURISDICTIONS } from '../jurisdiction';
import { ENTERPRISE_TYPES } from '../enterprise';
import { USER_ROLES } from '../roles';
import { LAND_UNIT_KINDS } from '../land';
import { ANIMAL_SEXES, ANIMAL_STATUSES, IDENTIFIER_TYPES, SPECIES } from '../animals';
import { EVENT_TYPES } from '../events';
import { ATTACHMENT_STATUSES, ATTACHMENT_SUBJECT_TYPES } from '../attachments';

/** IDs are client-generated UUIDv7. We validate shape here; ordering is a storage concern. */
export const uuidSchema = z.string().uuid();

/**
 * A client-generated entity id, specifically UUIDv7 — not merely a well-formed UUID. Use this for
 * the `id` field of a capture a client composes offline (a new animal, event, land unit, ...);
 * keep `uuidSchema` for a FIELD THAT REFERENCES an existing row (a foreign key), which only needs
 * to be a valid UUID, not assert the referenced row's own id format (CLAUDE.md, P2.9).
 *
 * The version nibble (index 14) is '7' and the variant nibble (index 19) is one of 8/9/a/b — the
 * two bits RFC 4122 fixes for any UUID, v7 included. `uuidSchema`'s plain `.uuid()` accepts v4,
 * which a stray `crypto.randomUUID()` in client code would otherwise pass silently.
 */
export const uuidV7Schema = z
  .string()
  .uuid()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'expected a UUIDv7 (client-generated ids are v7, never v4)',
  );

export const jurisdictionSchema = z.enum(SUPPORTED_JURISDICTIONS);

export const enterpriseTypeSchema = z.enum(ENTERPRISE_TYPES);

export const userRoleSchema = z.enum(USER_ROLES);

export const landUnitKindSchema = z.enum(LAND_UNIT_KINDS);

export const animalStatusSchema = z.enum(ANIMAL_STATUSES);

export const animalSexSchema = z.enum(ANIMAL_SEXES);

export const identifierTypeSchema = z.enum(IDENTIFIER_TYPES);

export const speciesSchema = z.enum(SPECIES);

export const eventTypeSchema = z.enum(EVENT_TYPES);

export const attachmentSubjectTypeSchema = z.enum(ATTACHMENT_SUBJECT_TYPES);

export const attachmentStatusSchema = z.enum(ATTACHMENT_STATUSES);

/** Money on the wire is integer cents. */
export const moneySchema = z.number().int();

/** Timestamps cross the wire as ISO-8601 UTC strings and parse to Date. */
export const timestampSchema = z.string().datetime({ offset: true }).pipe(z.coerce.date());

/**
 * A calendar date with no time and no zone: 'YYYY-MM-DD'. A date of birth or an acquisition
 * date is a day on the farm, not an instant — coercing it to a Date (which lands at midnight
 * in SOME zone) is the classic off-by-one. It stays a string; the display layer formats it.
 */
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a YYYY-MM-DD date');

/**
 * A GeoJSON geometry encoded as a string — the way geometry crosses the wire, never as the
 * PostGIS `geometry` type, which SQLite on the device has no notion of (offline-sync.md,
 * .claude/rules/db.md). We validate that it parses as a JSON object carrying a `type`, not the
 * full GeoJSON grammar: deep geometry validation is the mapping feature's job, not this
 * contract's. Call `.nullable()` where the geometry is optional (an unmapped camp, an event
 * captured with no GPS fix). Shared by land boundaries and event locations.
 */
export const geoJsonStringSchema = z.string().refine(
  (value) => {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === 'object' && parsed !== null && 'type' in parsed;
    } catch {
      return false;
    }
  },
  { message: 'expected a JSON object with a "type" (GeoJSON geometry)' },
);

/**
 * Server-owned audit timestamps present on every persisted record. Spread into an entity's
 * record schema. `deletedAt` is a soft-delete tombstone — a hard DELETE breaks sync and
 * destroys audit history we are legally required to retain. Single-sourced here so a new
 * domain schema cannot quietly omit or reshape it.
 */
export const auditTimestampsSchema = {
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: timestampSchema.nullable(),
} as const;

export type UuidInput = z.infer<typeof uuidSchema>;
export type UuidV7Input = z.infer<typeof uuidV7Schema>;
export type JurisdictionInput = z.infer<typeof jurisdictionSchema>;
export type EnterpriseTypeInput = z.infer<typeof enterpriseTypeSchema>;
export type UserRoleInput = z.infer<typeof userRoleSchema>;
