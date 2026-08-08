/**
 * Age/sex classes (FR-705). Table-driven, because the rule IS a table: the whole point of
 * `classes.ts` is that a species is a row rather than a branch, and a test written as a row per
 * case is the one that keeps it that way.
 *
 * The cases worth arguing about are the boundaries and the honest 'unknown' — a summary that
 * quietly sorted an animal with no birth date into "cow" would be inventing the number the farmer
 * opened the screen to check.
 */

import { describe, expect, it } from 'vitest';
import type { AnimalSex } from '@werf/core';
import { classifyAnimal, summariseByClass, type AnimalClass } from './classes';

interface Case {
  readonly species: string;
  readonly sex: AnimalSex;
  readonly ageDays: number | undefined;
  readonly expected: AnimalClass;
  readonly why: string;
}

const CASES: readonly Case[] = [
  { species: 'cattle', sex: 'female', ageDays: 30, expected: 'young', why: 'still on its mother' },
  {
    species: 'cattle',
    sex: 'female',
    ageDays: 209,
    expected: 'young',
    why: 'the day before weaning age is still a calf',
  },
  {
    species: 'cattle',
    sex: 'female',
    ageDays: 210,
    expected: 'weaner',
    why: 'the boundary is inclusive at the lower end',
  },
  { species: 'cattle', sex: 'female', ageDays: 449, expected: 'weaner', why: 'not yet breeding' },
  { species: 'cattle', sex: 'female', ageDays: 450, expected: 'female', why: 'a cow' },
  { species: 'cattle', sex: 'male', ageDays: 900, expected: 'male', why: 'a bull' },
  {
    species: 'cattle',
    sex: 'castrated',
    ageDays: 900,
    expected: 'castrate',
    why: 'a steer is a different animal commercially from a bull',
  },
  // Sheep wean and mature far earlier than cattle. A shared threshold would make every sheep farm
  // wrong, which is the failure the per-species table exists to prevent.
  {
    species: 'sheep',
    sex: 'female',
    ageDays: 150,
    expected: 'weaner',
    why: 'a hogget, not a lamb',
  },
  {
    species: 'sheep',
    sex: 'female',
    ageDays: 150,
    expected: 'weaner',
    why: 'at the same age a calf is still a calf',
  },
  { species: 'sheep', sex: 'female', ageDays: 300, expected: 'female', why: 'a ewe' },
  {
    species: 'cattle',
    sex: 'female',
    ageDays: undefined,
    expected: 'unknown',
    why: 'no date of birth is not a reason to guess',
  },
  {
    species: 'ostrich',
    sex: 'female',
    ageDays: 400,
    expected: 'unknown',
    why: 'a species with no rule yet is answered honestly, not approximately',
  },
];

describe('classifying an animal (FR-705)', () => {
  for (const { species, sex, ageDays, expected, why } of CASES) {
    it(`${species}/${sex}/${String(ageDays)} → ${expected} — ${why}`, () => {
      expect(classifyAnimal(species, sex, ageDays)).toBe(expected);
    });
  }
});

describe('summarising a herd by class', () => {
  it('keeps the species apart, because "9 heifers" means nothing on a mixed farm', () => {
    const summary = summariseByClass([
      { species: 'cattle', sex: 'female', ageDays: 900 },
      { species: 'cattle', sex: 'female', ageDays: 900 },
      { species: 'cattle', sex: 'female', ageDays: 300 },
      { species: 'sheep', sex: 'female', ageDays: 900 },
    ]);

    expect(summary['cattle']).toMatchObject({ female: 2, weaner: 1 });
    expect(summary['sheep']).toMatchObject({ female: 1 });
  });

  it('counts the animals it cannot classify rather than dropping them', () => {
    // Dropping them would make the class breakdown disagree with the head count, and a farmer
    // reconciling two numbers that should match is a farmer who stops trusting both.
    const summary = summariseByClass([
      { species: 'cattle', sex: 'female', ageDays: undefined },
      { species: 'cattle', sex: 'female', ageDays: 900 },
    ]);

    const cattle = summary['cattle']!;
    expect(cattle.unknown).toBe(1);
    expect(Object.values(cattle).reduce((a, b) => a + b, 0)).toBe(2);
  });
});
