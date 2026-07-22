/**
 * Postgres enums. These MUST match the `as const` arrays in @werf/core (ENTERPRISE_TYPES,
 * USER_ROLES) — the enum is the DB half, the array is the app half, and they are the same
 * vocabulary. Import the source of truth from @werf/core so a drift fails the build.
 */

import { pgEnum } from 'drizzle-orm/pg-core';
import { ENTERPRISE_TYPES, LAND_UNIT_KINDS, USER_ROLES } from '@werf/core';

export const enterpriseTypeEnum = pgEnum('enterprise_type', ENTERPRISE_TYPES);
export const userRoleEnum = pgEnum('user_role', USER_ROLES);
export const landUnitKindEnum = pgEnum('land_unit_kind', LAND_UNIT_KINDS);
