/**
 * The choices a farm is described by: its province, and what it farms.
 *
 * Extracted from `RegisterScreen` when a SECOND screen needed them (adding a farm to an existing
 * business, FR-004). Two copies of the enterprise list is exactly the kind of duplication that ends
 * with one screen offering an option the other does not.
 */

import type { EnterpriseType } from '@werf/core';

/** The nine provinces. Jurisdiction is NOT chosen here — it comes from the farm, always 'ZA'. */
export const PROVINCES = [
  'Eastern Cape',
  'Free State',
  'Gauteng',
  'KwaZulu-Natal',
  'Limpopo',
  'Mpumalanga',
  'North West',
  'Northern Cape',
  'Western Cape',
];

/**
 * Enterprise names as a farmer says them. Not translated yet — this intersects the terminology
 * engine (a "camp" for cattle, a "block" for vines), which owns the whole vocabulary and lands with
 * the modules that use it. Translating these here would fork that vocabulary in two places. Moving
 * them into the dictionaries is a real remainder, not an oversight, and it is now ONE move rather
 * than two.
 */
export const ENTERPRISE_LABELS: Record<EnterpriseType, string> = {
  beef_cattle: 'Beef cattle',
  dairy: 'Dairy',
  sheep: 'Sheep',
  goats: 'Goats',
  pigs: 'Pigs',
  poultry: 'Poultry',
  game: 'Game',
  row_crops: 'Row crops',
  vegetables: 'Vegetables',
  orchards: 'Orchards',
  vineyards: 'Vineyards',
  other: 'Other',
};
