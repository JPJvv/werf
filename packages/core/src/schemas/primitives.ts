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

/** IDs are client-generated UUIDv7. We validate shape here; ordering is a storage concern. */
export const uuidSchema = z.string().uuid();

export const jurisdictionSchema = z.enum(SUPPORTED_JURISDICTIONS);

export const enterpriseTypeSchema = z.enum(ENTERPRISE_TYPES);

export const userRoleSchema = z.enum(USER_ROLES);

export const landUnitKindSchema = z.enum(LAND_UNIT_KINDS);

/** Money on the wire is integer cents. */
export const moneySchema = z.number().int();

/** Timestamps cross the wire as ISO-8601 UTC strings and parse to Date. */
export const timestampSchema = z.string().datetime({ offset: true }).pipe(z.coerce.date());

/**
 * Server-owned audit timestamps present on every persisted record. Spread into an entity's
 * record schema. `deletedAt` is a soft-delete tombstone — a hard DELETE breaks sync and
 * destroys audit history the BCEA requires us to keep. Single-sourced here so a new domain
 * schema cannot quietly omit or reshape it.
 */
export const auditTimestampsSchema = {
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: timestampSchema.nullable(),
} as const;

export type UuidInput = z.infer<typeof uuidSchema>;
export type JurisdictionInput = z.infer<typeof jurisdictionSchema>;
export type EnterpriseTypeInput = z.infer<typeof enterpriseTypeSchema>;
export type UserRoleInput = z.infer<typeof userRoleSchema>;
