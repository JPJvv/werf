/**
 * Postgres enums. These MUST match the `as const` arrays in @werf/core (ENTERPRISE_TYPES,
 * USER_ROLES) — the enum is the DB half, the array is the app half, and they are the same
 * vocabulary. Import the source of truth from @werf/core so a drift fails the build.
 */

import { pgEnum } from 'drizzle-orm/pg-core';
import {
  ANIMAL_SEXES,
  ANIMAL_STATUSES,
  ATTACHMENT_STATUSES,
  ATTACHMENT_SUBJECT_TYPES,
  ENTERPRISE_TYPES,
  EVENT_TYPES,
  IDENTIFIER_TYPES,
  INVENTORY_ITEM_CATEGORIES,
  LAND_UNIT_KINDS,
  USER_ROLES,
} from '@werf/core';

export const enterpriseTypeEnum = pgEnum('enterprise_type', ENTERPRISE_TYPES);
export const userRoleEnum = pgEnum('user_role', USER_ROLES);
export const landUnitKindEnum = pgEnum('land_unit_kind', LAND_UNIT_KINDS);
export const animalStatusEnum = pgEnum('animal_status', ANIMAL_STATUSES);
export const animalSexEnum = pgEnum('animal_sex', ANIMAL_SEXES);
export const identifierTypeEnum = pgEnum('identifier_type', IDENTIFIER_TYPES);
export const eventTypeEnum = pgEnum('event_type', EVENT_TYPES);
export const attachmentSubjectTypeEnum = pgEnum(
  'attachment_subject_type',
  ATTACHMENT_SUBJECT_TYPES,
);
export const attachmentStatusEnum = pgEnum('attachment_status', ATTACHMENT_STATUSES);
export const inventoryItemCategoryEnum = pgEnum(
  'inventory_item_category',
  INVENTORY_ITEM_CATEGORIES,
);
