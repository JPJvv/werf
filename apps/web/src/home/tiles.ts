/**
 * The home grid IS the enterprise adaptation (FR-017, ux-design-system §5.4). Tiles are
 * GENERATED from farm.enterprise_types — a static array of tiles is the bug the frontend
 * rules warn about. A cattle farm never gets a Sprays tile; a vineyard never gets Herd.
 * The land tile is "Camps" for animals and "Blocks" for crops — terminology from the
 * enterprise types, never hardcoded per screen.
 *
 * Pure logic, no React, so the adaptation is unit-tested directly. Live numbers/badges
 * arrive with each module in Phases 2+; here a tile is a door with a stable identity.
 *
 * Order is FIXED and never personalised — muscle memory is the entire value of the grid.
 */

import { isCropEnterprise, isLivestockEnterprise, type EnterpriseType } from '@werf/core';

export const HOME_TILE_KEYS = [
  'animals',
  'land',
  'health',
  'sprays',
  'harvest',
  'labour',
  'money',
  'compliance',
] as const;

export type HomeTileKey = (typeof HOME_TILE_KEYS)[number];

export interface HomeTile {
  key: HomeTileKey;
  /** Terminology-adapted, user-facing label, e.g. "Herd" vs "Flock", "Camps" vs "Blocks". */
  label: string;
  /** Decorative glyph; the label is the accessible name, the icon is aria-hidden. */
  icon: string;
  /** Target route. The destinations themselves land with their phases. */
  to: string;
}

/**
 * The species that make a "flock" rather than a "herd". Sheep, goats and poultry flock;
 * cattle, pigs and game are a herd. A farm running only flock species sees "Flock".
 */
const FLOCK_SPECIES: readonly EnterpriseType[] = ['sheep', 'goats', 'poultry'];

function animalsLabel(livestock: EnterpriseType[]): string {
  const allFlock = livestock.every((t) => FLOCK_SPECIES.includes(t));
  const noneFlock = livestock.every((t) => !FLOCK_SPECIES.includes(t));
  if (allFlock) return 'Flock';
  if (noneFlock) return 'Herd';
  return 'Livestock';
}

function animalsIcon(label: string): string {
  return label === 'Flock' ? '🐑' : '🐄';
}

/**
 * Derive the ordered, de-duplicated home tiles for a farm's enterprise types.
 *
 * Rules (ux-design-system §5.4):
 * - animals + health when any livestock is kept;
 * - sprays + harvest when any crop is grown;
 * - one land tile always, labelled "Blocks" when crops are present else "Camps";
 * - Labour, Money and Compliance are shared by every enterprise.
 */
export function homeTiles(enterpriseTypes: readonly EnterpriseType[]): HomeTile[] {
  const livestock = enterpriseTypes.filter(isLivestockEnterprise);
  const crops = enterpriseTypes.filter(isCropEnterprise);
  const hasLivestock = livestock.length > 0;
  const hasCrop = crops.length > 0;

  const tiles: HomeTile[] = [];

  if (hasLivestock) {
    const label = animalsLabel(livestock);
    tiles.push({ key: 'animals', label, icon: animalsIcon(label), to: '/animals' });
  }

  // One land tile. Crop naming wins on a mixed farm — a block is the audited unit.
  if (hasLivestock || hasCrop) {
    tiles.push(
      hasCrop
        ? { key: 'land', label: 'Blocks', icon: '🌾', to: '/land' }
        : { key: 'land', label: 'Camps', icon: '🌿', to: '/land' },
    );
  }

  if (hasLivestock) {
    tiles.push({ key: 'health', label: 'Health', icon: '⚕', to: '/health' });
  }
  if (hasCrop) {
    tiles.push({ key: 'sprays', label: 'Sprays', icon: '💧', to: '/sprays' });
    tiles.push({ key: 'harvest', label: 'Harvest', icon: '🧺', to: '/harvest' });
  }

  // Shared across every farm, in fixed trailing order.
  tiles.push({ key: 'labour', label: 'Labour', icon: '👥', to: '/labour' });
  tiles.push({ key: 'money', label: 'Money', icon: 'R', to: '/money' });
  tiles.push({ key: 'compliance', label: 'Compliance', icon: '✓', to: '/compliance' });

  return tiles;
}
