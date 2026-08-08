import { describe, expect, it } from 'vitest';
import type { AnimalStatus } from '@werf/core';
import { canTransition, isMoreFinal, statusPrecedence } from './status';

// The order the state machine is defined by (db.md): dead > sold > culled > missing > alive.
describe('animal-status finality order (db.md)', () => {
  it('ranks alive < missing < culled < sold < dead', () => {
    const ordered: AnimalStatus[] = ['alive', 'missing', 'culled', 'sold', 'dead'];
    const ranks = ordered.map(statusPrecedence);
    // strictly increasing
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]!).toBeGreaterThan(ranks[i - 1]!);
    }
  });

  it.each<[AnimalStatus, AnimalStatus, boolean]>([
    ['dead', 'sold', true], // the conflict-resolution case: dead beats a stale 'sold'
    ['sold', 'dead', false],
    ['dead', 'alive', true],
    ['alive', 'dead', false],
    ['sold', 'sold', false], // equal is not strictly more final
  ])('isMoreFinal(%s, %s) === %s', (a, b, expected) => {
    expect(isMoreFinal(a, b)).toBe(expected);
  });
});

describe('canTransition — a capture may not step an animal backwards', () => {
  it.each<[AnimalStatus, AnimalStatus, boolean]>([
    ['alive', 'dead', true], // record a death
    ['alive', 'sold', true], // record a sale
    ['alive', 'alive', true], // weaning / purchase: stays alive
    ['missing', 'dead', true], // a missing animal is found dead
    ['missing', 'sold', true],
    ['dead', 'sold', false], // cannot sell a dead animal
    ['dead', 'alive', false], // cannot wean a dead animal
    ['sold', 'alive', false], // cannot wean an animal that has left the herd
    ['culled', 'sold', true], // sold is more final than culled (db.md order)
    ['sold', 'culled', false],
  ])('canTransition(%s → %s) === %s', (from, to, expected) => {
    expect(canTransition(from, to)).toBe(expected);
  });
});
