/**
 * The home grid IS the enterprise adaptation (FR-017, ux-design-system §5.4). Tiles are
 * GENERATED from farm.enterprise_types — a static array of tiles is the bug the frontend
 * rules warn about. A cattle farm never gets a Sprays tile; a vineyard never gets Herd.
 *
 * ⭐ A tile carries a translation KEY, not a word. The terminology decision (is this a camp or a
 * block, a herd or a flock) belongs to `i18n/terminology.ts`, and the word for the term it picks
 * belongs to the dictionaries. This module only decides WHICH doors exist and in what order.
 * Phase 1 returned English strings from here, which is why the labels could not be translated
 * without forking the vocabulary — that fork is what this split resolves (FR-008 remainder).
 *
 * Pure logic, no React, so the adaptation is unit-tested directly.
 *
 * Order is FIXED and never personalised — muscle memory is the entire value of the grid.
 */

import { isCropEnterprise, isLivestockEnterprise, type EnterpriseType } from '@werf/core';
import type { TranslationKey } from '../i18n/dictionaries';
import { landTerm, stockTerm, termLabelKey } from '../i18n/terminology';

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
  /** The dictionary key for this tile's terminology-adapted label ("Herd", "Blocks", "Kampe"). */
  labelKey: TranslationKey;
  /** Decorative glyph; the label is the accessible name, the icon is aria-hidden. */
  icon: string;
  /** Target route. The destinations themselves land with their phases. */
  to: string;
}

/** A flock gets the sheep glyph; a herd (or a mixed livestock farm) gets the cow. */
function animalsIcon(stock: 'herd' | 'flock' | 'livestock'): string {
  return stock === 'flock' ? '🐑' : '🐄';
}

/**
 * Derive the ordered, de-duplicated home tiles for a farm's enterprise types.
 *
 * Rules (ux-design-system §5.4):
 * - animals + health when any livestock is kept;
 * - sprays + harvest when any crop is grown;
 * - one land tile always, named by the terminology layer ("Blocks" with crops, else "Camps");
 * - Labour, Money and Compliance are shared by every enterprise.
 */
export function homeTiles(enterpriseTypes: readonly EnterpriseType[]): HomeTile[] {
  const hasLivestock = enterpriseTypes.some(isLivestockEnterprise);
  const hasCrop = enterpriseTypes.some(isCropEnterprise);
  const stock = stockTerm(enterpriseTypes);

  const tiles: HomeTile[] = [];

  if (stock) {
    tiles.push({
      key: 'animals',
      labelKey: termLabelKey(stock),
      icon: animalsIcon(stock),
      to: '/animals',
    });
  }

  // One land tile, named by the shared terminology rule so nothing re-derives the word.
  if (hasLivestock || hasCrop) {
    const land = landTerm(enterpriseTypes);
    tiles.push({
      key: 'land',
      labelKey: termLabelKey(land),
      icon: land === 'block' ? '🌾' : '🌿',
      to: '/land',
    });
  }

  if (hasLivestock) {
    // Points at the capture screen rather than a placeholder module: the thing a farmer opens
    // "Health" to DO is record a treatment, and a door onto a real room beats a door onto a sign.
    tiles.push({ key: 'health', labelKey: 'tile.health', icon: '⚕', to: '/animals/health' });
  }
  if (hasCrop) {
    tiles.push({ key: 'sprays', labelKey: 'tile.sprays', icon: '💧', to: '/sprays' });
    tiles.push({ key: 'harvest', labelKey: 'tile.harvest', icon: '🧺', to: '/harvest' });
  }

  // Shared across every farm, in fixed trailing order.
  tiles.push({ key: 'labour', labelKey: 'tile.labour', icon: '👥', to: '/labour' });
  tiles.push({ key: 'money', labelKey: 'tile.money', icon: 'R', to: '/money' });
  tiles.push({ key: 'compliance', labelKey: 'tile.compliance', icon: '✓', to: '/compliance' });

  return tiles;
}
