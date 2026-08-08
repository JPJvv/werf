/**
 * Herd scoping (FR-113), table-driven because the rule is a table: which combinations of subject
 * count as filed under a herd, and which are refused. Asserted on the behaviour a farmer would
 * observe — a capture that cannot say which herd it concerns is refused at capture, not silently
 * filed nowhere and discovered missing from a season's history months later.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '@werf/core';
import { assertHerdScoped, isHerdScoped, type HerdScopable } from './herd-scope';

const ANIMAL = '01900000-0000-7000-8000-0000000000a1';
const MOB = '01900000-0000-7000-8000-0000000000b1';
const ENTERPRISE = '01900000-0000-7000-8000-000000000e01';

const cases: ReadonlyArray<readonly [string, HerdScopable, boolean]> = [
  // The three ways an event names its herd (database-schema.md § 5).
  ['a weight on one animal', { type: 'weight', animalId: ANIMAL }, true],
  ['a dip across a mob', { type: 'dip', mobId: MOB }, true],
  ['a herd-wide dose named by enterprise', { type: 'treatment', enterpriseId: ENTERPRISE }, true],
  // Explicit nulls are the same as absent — this is what a client actually sends.
  [
    'a treatment with every subject null',
    { type: 'treatment', animalId: null, mobId: null, enterpriseId: null },
    false,
  ],
  ['a treatment with no subject at all', { type: 'treatment' }, false],
  // The closed exception list: a fact about the farm, not a herd.
  ['rainfall, which falls on the whole farm', { type: 'rainfall' }, true],
];

describe('herd scoping (FR-113)', () => {
  it.each(cases)('%s: filed = %s', (_label, event, expected) => {
    expect(isHerdScoped(event)).toBe(expected);
  });

  it('refuses an unfiled event at capture, saying what is missing', () => {
    // A mixed farm with three herds cannot use "dosed the herd on Tuesday". The farmer is asked
    // now, while they remember, rather than being asked to reconstruct it in an audit.
    expect(() => assertHerdScoped({ type: 'treatment' })).toThrow(ValidationError);
    expect(() => assertHerdScoped({ type: 'treatment' })).toThrow(
      /must be recorded against a herd/,
    );
  });

  it('lets a farm-level fact through with no herd named', () => {
    expect(() => assertHerdScoped({ type: 'rainfall' })).not.toThrow();
  });

  it('treats a NEW event type as herd-scoped until it is named an exception', () => {
    // The default matters more than the exception: a capture added in a later phase that forgets
    // to file itself is refused, rather than joining the log unattributed.
    expect(isHerdScoped({ type: 'condition_score' })).toBe(false);
    expect(isHerdScoped({ type: 'condition_score', animalId: ANIMAL })).toBe(true);
  });
});
