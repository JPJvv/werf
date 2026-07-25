/**
 * The terminology layer: what a farm CALLS things, decided in one place.
 *
 * A camp and a block are the same row in `land_units` wearing different words
 * (database-schema.md § 3); which word a farmer sees depends on what they farm, never on which
 * screen they are on. Getting that wrong is not cosmetic — a vineyard owner told to "add your
 * first camp" learns that the app was not built for them, and a mixed farm shown a "Blocks" tile
 * with "add your first camp" beneath it (which is exactly what happened before this module) looks
 * like two different products stitched together.
 *
 * ⭐ The lookup returns a TERM TOKEN, not a word. `'camp'` is the concept; the dictionary holds
 * the word for it in each language. That separation is the whole point: the Phase 1 version chose
 * English words here, which is why the tile labels could not be translated without forking the
 * vocabulary — Afrikaans "Kampe" would have had to be decided somewhere else, and the two places
 * would drift. Now there is one decision (which term) and one translation (what that term is
 * called), and a term the dictionary has no word for fails the build.
 *
 * Pure and React-free, so the adaptation is unit-tested directly. When the vocabulary outgrows a
 * closed set of tokens — a farm that wants "paddock", a second jurisdiction with its own words —
 * this becomes a lookup against a terminology table read through the sync adapter, and the callers
 * do not change: they already ask this module rather than deciding for themselves.
 */

import { isCropEnterprise, isLivestockEnterprise, type EnterpriseType } from '@werf/core';
import type { TranslationKey } from './dictionaries';

/** What this farm calls a piece of land. */
export type LandTerm = 'camp' | 'block';

/** What this farm calls its animals, collectively. */
export type StockTerm = 'herd' | 'flock' | 'livestock';

/** Every term a farm's vocabulary settles, in one object so a screen asks once. */
export interface FarmVocabulary {
  readonly land: LandTerm;
  /** Null on a farm that keeps no animals — it has no word for a herd because it has none. */
  readonly stock: StockTerm | null;
}

/**
 * The species that make a "flock" rather than a "herd". Sheep, goats and poultry flock; cattle,
 * pigs and game are a herd. A farm running only flock species says "flock"; one running both says
 * the neutral word rather than picking a side and being wrong half the time.
 */
const FLOCK_SPECIES: readonly EnterpriseType[] = ['sheep', 'goats', 'poultry'];

/**
 * What this farm calls a piece of land: a "camp" for animals, a "block" for crops.
 *
 * Crop naming wins on a mixed farm: a block is the audited unit, and an export auditor's
 * vocabulary is the one that costs money to get wrong.
 */
export function landTerm(enterpriseTypes: readonly EnterpriseType[]): LandTerm {
  return enterpriseTypes.some(isCropEnterprise) ? 'block' : 'camp';
}

/** What this farm calls its animals: herd, flock, or the neutral word for a farm running both. */
export function stockTerm(enterpriseTypes: readonly EnterpriseType[]): StockTerm | null {
  const livestock = enterpriseTypes.filter(isLivestockEnterprise);
  if (livestock.length === 0) return null;
  if (livestock.every((type) => FLOCK_SPECIES.includes(type))) return 'flock';
  if (livestock.every((type) => !FLOCK_SPECIES.includes(type))) return 'herd';
  return 'livestock';
}

/** The whole vocabulary for a farm, from its enterprise types. */
export function vocabularyFor(enterpriseTypes: readonly EnterpriseType[]): FarmVocabulary {
  return { land: landTerm(enterpriseTypes), stock: stockTerm(enterpriseTypes) };
}

/**
 * The dictionary key holding the word for a term, as a LABEL (the collective form a tile carries:
 * "Camps", "Herd"). Sentence forms live in their own keys — "Add your first camp" is a sentence in
 * Afrikaans too, and assembling one from a noun and a verb produces the kind of translation only a
 * programmer thinks is fine.
 */
export function termLabelKey(term: LandTerm | StockTerm): TranslationKey {
  return `term.${term}` as TranslationKey;
}
