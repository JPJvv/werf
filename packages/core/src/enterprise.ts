/**
 * Enterprise types — the kinds of farming a farm does. This is the single most
 * load-bearing enum in the product: `farm.enterprise_types` drives the whole UI
 * (the home grid, the terminology, the compliance obligations). See FR-002 and
 * docs/03-architecture/database-schema.md (CREATE TYPE enterprise_type).
 *
 * Values match the Postgres enum exactly. Order here is the canonical DB order,
 * NOT a display order — the home grid decides display order itself.
 */

import type { Species } from './animals';

export const ENTERPRISE_TYPES = [
  'beef_cattle',
  'dairy',
  'sheep',
  'goats',
  'pigs',
  'poultry',
  'game',
  'row_crops',
  'vegetables',
  'orchards',
  'vineyards',
  'other',
] as const;

export type EnterpriseType = (typeof ENTERPRISE_TYPES)[number];

export function isEnterpriseType(value: string): value is EnterpriseType {
  return (ENTERPRISE_TYPES as readonly string[]).includes(value);
}

/** The enterprise types that keep and move animals. */
export const LIVESTOCK_ENTERPRISES: readonly EnterpriseType[] = [
  'beef_cattle',
  'dairy',
  'sheep',
  'goats',
  'pigs',
  'poultry',
  'game',
];

/** The enterprise types that grow things in the ground. */
export const CROP_ENTERPRISES: readonly EnterpriseType[] = [
  'row_crops',
  'vegetables',
  'orchards',
  'vineyards',
];

export function isLivestockEnterprise(type: EnterpriseType): boolean {
  return LIVESTOCK_ENTERPRISES.includes(type);
}

export function isCropEnterprise(type: EnterpriseType): boolean {
  return CROP_ENTERPRISES.includes(type);
}

/**
 * The animal species an enterprise keeps — the vocabulary link that lets a capture screen
 * offer only the species a farm actually runs. Both beef and dairy are cattle; a crop
 * enterprise keeps none, so it returns null. Kept here, next to the enterprise enum, so the
 * client and any future server-side derivation read the one mapping and cannot disagree.
 */
export function enterpriseSpecies(type: EnterpriseType): Species | null {
  switch (type) {
    case 'beef_cattle':
    case 'dairy':
      return 'cattle';
    case 'sheep':
      return 'sheep';
    case 'goats':
      return 'goat';
    case 'pigs':
      return 'pig';
    case 'poultry':
      return 'poultry';
    case 'game':
      return 'game';
    default:
      return null;
  }
}
