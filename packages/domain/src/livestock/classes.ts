/**
 * Age/sex classes (FR-705) — what a farmer actually calls the animals in a herd. A cattle farmer
 * does not have "42 female cattle"; they have 18 cows, 9 heifers and 15 weaners, and those are the
 * groups every grazing, breeding and selling decision is made in.
 *
 * ⭐ The rules are PER SPECIES and live in a table (ADR-0006). A weaner becomes a heifer at a
 * different age in cattle than a lamb becomes a hogget in sheep, and hard-coding cattle's answer
 * into a shared function is exactly how a livestock app ends up quietly wrong for everyone who does
 * not farm cattle. The table is the seam: a new species is a row, not a branch.
 *
 * ⭐ And the class NAMES are jurisdiction-neutral tokens, not words. `'weaner'` is the concept; the
 * dictionary holds what to call it in each language, the same discipline the terminology layer uses
 * for camp/block. A South African name baked in here would be the ADR-0006 violation the rules warn
 * about first.
 *
 * Pure: no I/O, no clock. Age is passed in as days, because "how old is this animal" is a question
 * about two dates the caller already has and this package may not read a clock (.claude/rules/domain.md).
 */

import type { AnimalSex } from '@werf/core';

/** What a farmer calls an animal of a given species, sex and age. A token, never a word. */
export type AnimalClass =
  | 'young' // pre-weaning: a calf, a lamb, a kid
  | 'weaner' // weaned but not yet breeding age
  | 'female' // a breeding-age female: a cow, a ewe, a doe
  | 'male' // an entire breeding-age male: a bull, a ram
  | 'castrate' // a steer, a wether
  | 'unknown'; // no date of birth, so no honest answer

/** The age boundaries for one species, in days. */
interface SpeciesAgeRule {
  /** Below this, the animal is still on its mother. */
  readonly weaningDays: number;
  /** Below this (and above weaning) it is a weaner rather than a breeding animal. */
  readonly maturityDays: number;
}

/**
 * Age boundaries by species. Approximate management thresholds, not law — nothing here is a
 * regulated number, so it belongs in code rather than in `regulatory_rates`. They are the
 * conventional South African commercial figures and a farm that disagrees is why this is a table
 * rather than a constant: per-farm overrides land here without touching a caller.
 */
const SPECIES_RULES: Readonly<Record<string, SpeciesAgeRule>> = {
  cattle: { weaningDays: 210, maturityDays: 450 },
  sheep: { weaningDays: 100, maturityDays: 300 },
  goat: { weaningDays: 100, maturityDays: 300 },
  pig: { weaningDays: 28, maturityDays: 210 },
  poultry: { weaningDays: 42, maturityDays: 140 },
  game: { weaningDays: 180, maturityDays: 450 },
};

/**
 * The class an animal falls into.
 *
 * `ageDays` is undefined when the date of birth is unknown, and the answer is then 'unknown' rather
 * than a guess. On an extensive farm a large part of the herd genuinely has no recorded birth date,
 * and a summary that silently sorted them into "cow" would be inventing the very number the farmer
 * came to check. A species with no rule is 'unknown' for the same reason.
 */
export function classifyAnimal(
  species: string,
  sex: AnimalSex,
  ageDays: number | undefined,
): AnimalClass {
  const rule = SPECIES_RULES[species];
  if (rule === undefined || ageDays === undefined || ageDays < 0) return 'unknown';

  if (ageDays < rule.weaningDays) return 'young';
  if (ageDays < rule.maturityDays) return 'weaner';

  // Grown. Sex decides the rest, and a castrate is its own class because it is a different animal
  // commercially — a steer is fed and sold, a bull is kept or culled.
  switch (sex) {
    case 'female':
      return 'female';
    case 'male':
      return 'male';
    case 'castrated':
      return 'castrate';
    default:
      return 'unknown';
  }
}

/** Every class, in the order a farmer would read them off a summary. */
export const ANIMAL_CLASSES: readonly AnimalClass[] = [
  'female',
  'male',
  'castrate',
  'weaner',
  'young',
  'unknown',
];

/** The members of a herd this breakdown reads. */
export interface ClassifiableAnimal {
  readonly species: string;
  readonly sex: AnimalSex;
  /** Age in whole days at the moment being summarised, or undefined when the DOB is unknown. */
  readonly ageDays: number | undefined;
}

/**
 * Live head by class, per species — because "9 heifers" means nothing without knowing they are
 * cattle on a farm that also runs sheep.
 */
export function summariseByClass(
  animals: readonly ClassifiableAnimal[],
): Readonly<Record<string, Readonly<Record<AnimalClass, number>>>> {
  const bySpecies: Record<string, Record<AnimalClass, number>> = {};

  for (const animal of animals) {
    const counts = (bySpecies[animal.species] ??= emptyCounts());
    counts[classifyAnimal(animal.species, animal.sex, animal.ageDays)] += 1;
  }

  return bySpecies;
}

function emptyCounts(): Record<AnimalClass, number> {
  return Object.fromEntries(ANIMAL_CLASSES.map((c) => [c, 0])) as Record<AnimalClass, number>;
}
