/**
 * Zod schemas are the single source of truth for validation. Derive TS types with
 * `z.infer`; never hand-write a type that duplicates a schema. Client and server
 * validate with the identical schema object.
 *
 * This barrel holds the primitives every domain schema builds on. Entity schemas
 * (animals, events, employees) arrive with their phases.
 */

import { z } from 'zod';
import { SUPPORTED_JURISDICTIONS } from '../jurisdiction';
import { ENTERPRISE_TYPES } from '../enterprise';
import { USER_ROLES } from '../roles';

/** IDs are client-generated UUIDv7. We validate shape here; ordering is a storage concern. */
export const uuidSchema = z.string().uuid();

export const jurisdictionSchema = z.enum(SUPPORTED_JURISDICTIONS);

export const enterpriseTypeSchema = z.enum(ENTERPRISE_TYPES);

export const userRoleSchema = z.enum(USER_ROLES);

/** Money on the wire is integer cents. */
export const moneySchema = z.number().int();

/** Timestamps cross the wire as ISO-8601 UTC strings and parse to Date. */
export const timestampSchema = z.string().datetime({ offset: true }).pipe(z.coerce.date());

export type UuidInput = z.infer<typeof uuidSchema>;
export type JurisdictionInput = z.infer<typeof jurisdictionSchema>;
export type EnterpriseTypeInput = z.infer<typeof enterpriseTypeSchema>;
export type UserRoleInput = z.infer<typeof userRoleSchema>;
