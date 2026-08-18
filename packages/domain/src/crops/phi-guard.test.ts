/**
 * The PHI guard (FR-205, US-030), tested as a pure function against the acceptance gherkin's own
 * numbers and the ancestor-split edge case its header names as easy to get wrong. Table-driven per
 * `.claude/rules/domain.md` — this is 4d's safety-critical file, held to the same coverage bar as a
 * payroll rule.
 */

import { describe, expect, it } from 'vitest';
import {
  phiGuardFor,
  sprayPhiGuardFor,
  type PhiLandUnitFact,
  type PhiProductFact,
  type PhiSprayFact,
} from './phi-guard';

const B12 = 'b12';
const B12_A = 'b12-a'; // split off B12
const B12_A_1 = 'b12-a-1'; // split off B12_A
const OTHER = 'other-block';
const PRODUCT_21DAY = 'product-21day';
const PRODUCT_NO_PHI = 'product-no-phi';
const UNKNOWN_PRODUCT = 'product-not-cached';

const PRODUCTS: PhiProductFact[] = [
  { id: PRODUCT_21DAY, phiDays: 21 },
  { id: PRODUCT_NO_PHI, phiDays: null },
];

/** Defaults to `resolved: false` with no stored `earliestHarvestDate` — a LOCAL capture that has
 *  not round-tripped through the server, the offline case O-12 exists to cover. Most tests below
 *  exercise the guard through this preview fallback deliberately, not as an oversight. */
function spray(overrides: Partial<PhiSprayFact>): PhiSprayFact {
  return {
    landUnitId: B12,
    occurredAt: '2026-03-01T08:00:00Z',
    sprayedOn: '2026-03-01',
    productId: PRODUCT_21DAY,
    resolved: false,
    ...overrides,
  };
}

function landUnit(overrides: Partial<PhiLandUnitFact> & { id: string }): PhiLandUnitFact {
  return { parentId: null, createdAt: '2020-01-01T00:00:00Z', ...overrides };
}

describe('phiGuardFor (FR-205, US-030)', () => {
  it('is clear when nothing has ever been sprayed on the block', () => {
    const result = phiGuardFor('b12', '2026-03-15', [], PRODUCTS, [landUnit({ id: B12 })]);
    expect(result).toEqual({ blocked: false });
  });

  it('US-030 own gherkin: blocked at 14 days into a 21-day PHI, names the product/date/earliest date', () => {
    // Given block "B12" was sprayed with a 21-day-PHI product on 2026-03-01
    const result = phiGuardFor(
      B12,
      '2026-03-15', // When I try to record a harvest on 2026-03-15
      [spray({})],
      PRODUCTS,
      [landUnit({ id: B12 })],
    );

    expect(result).toEqual({
      blocked: true,
      reason: 'active_phi',
      blockedBy: {
        productId: PRODUCT_21DAY,
        sprayedOn: '2026-03-01',
        earliestHarvestDate: '2026-03-22',
      },
    });
  });

  it('US-030 own gherkin: proceeds normally the day the PHI clears', () => {
    // "Harvest after PHI proceeds normally" — recorded on 2026-03-23, one day past clearing
    const result = phiGuardFor(B12, '2026-03-23', [spray({})], PRODUCTS, [landUnit({ id: B12 })]);
    expect(result).toEqual({ blocked: false });
  });

  it('is clear exactly on the earliest harvest date — inclusive at the boundary', () => {
    const result = phiGuardFor(B12, '2026-03-22', [spray({})], PRODUCTS, [landUnit({ id: B12 })]);
    expect(result).toEqual({ blocked: false });
  });

  it('a spray with no PHI on record blocks nothing — a real fact, not a gap', () => {
    const result = phiGuardFor(
      B12,
      '2026-03-02',
      [spray({ productId: PRODUCT_NO_PHI })],
      PRODUCTS,
      [landUnit({ id: B12 })],
    );
    expect(result).toEqual({ blocked: false });
  });

  it('O-12: a LOCAL, never-flushed spray still blocks — PREVIEWED from the cached product register, no server round trip', () => {
    // No `earliestHarvestDate` on the spray at all — it has never round-tripped. The guard must
    // still block, or the offline journey this file exists for is broken.
    const result = phiGuardFor(
      B12,
      '2026-03-10', // 9 days into a 21-day PHI
      [spray({ resolved: false })],
      PRODUCTS,
      [landUnit({ id: B12 })],
    );
    expect(result).toEqual({
      blocked: true,
      reason: 'active_phi',
      blockedBy: {
        productId: PRODUCT_21DAY,
        sprayedOn: '2026-03-01',
        earliestHarvestDate: '2026-03-22',
      },
    });
  });

  it("ADR-0005: a spray's ALREADY-RESOLVED date wins outright — never recomputed from the product register even when a preview would disagree", () => {
    // The cached register would preview 2026-03-22 (21 days from 2026-03-01) if consulted. The
    // stored, resolved answer is a different date and must win without a `products` lookup at all —
    // proven by passing a product whose phiDays would compute yet another date.
    const result = phiGuardFor(
      B12,
      '2026-03-25',
      [spray({ resolved: true, earliestHarvestDate: '2026-03-30' })],
      [{ id: PRODUCT_21DAY, phiDays: 1 }], // would preview 2026-03-02 if wrongly consulted
      [landUnit({ id: B12 })],
    );
    expect(result).toEqual({
      blocked: true,
      reason: 'active_phi',
      blockedBy: {
        productId: PRODUCT_21DAY,
        sprayedOn: '2026-03-01',
        earliestHarvestDate: '2026-03-30',
      },
    });
  });

  it('resolved with no stored date is a CONFIRMED no-PHI — never falls back to a `products` lookup', () => {
    const result = phiGuardFor(
      B12,
      '2026-03-02',
      [spray({ resolved: true })],
      [], // proves no lookup is attempted — an empty register would otherwise read as 'unresolved'
      [landUnit({ id: B12 })],
    );
    expect(result).toEqual({ blocked: false });
  });

  it('ignores a spray on an unrelated block', () => {
    const result = phiGuardFor(B12, '2026-03-15', [spray({ landUnitId: OTHER })], PRODUCTS, [
      landUnit({ id: B12 }),
      landUnit({ id: OTHER }),
    ]);
    expect(result).toEqual({ blocked: false });
  });

  it("blocks on an ancestor's spray recorded BEFORE the split (4d·4)", () => {
    const units = [
      landUnit({ id: B12, createdAt: '2020-01-01T00:00:00Z' }),
      landUnit({ id: B12_A, parentId: B12, createdAt: '2026-02-01T00:00:00Z' }), // split from B12
    ];
    // Sprayed on the PARENT on 2026-01-25 — before the child split off on 2026-02-01.
    const result = phiGuardFor(
      B12_A,
      '2026-02-10', // within the 21-day PHI (clears 2026-02-15)
      [spray({ landUnitId: B12, sprayedOn: '2026-01-25', occurredAt: '2026-01-25T08:00:00Z' })],
      PRODUCTS,
      units,
    );
    expect(result).toMatchObject({ blocked: true, reason: 'active_phi' });
  });

  it("does NOT attribute a parent's spray recorded AFTER the child split off", () => {
    const units = [
      landUnit({ id: B12, createdAt: '2020-01-01T00:00:00Z' }),
      // The child split off on 2026-02-01 — BEFORE the parent's next spray.
      landUnit({ id: B12_A, parentId: B12, createdAt: '2026-02-01T00:00:00Z' }),
    ];
    const result = phiGuardFor(
      B12_A,
      '2026-03-15',
      [spray({ landUnitId: B12, sprayedOn: '2026-03-01', occurredAt: '2026-03-01T08:00:00Z' })],
      PRODUCTS,
      units,
    );
    expect(result).toEqual({ blocked: false });
  });

  it(
    '⭐ THE BOUND IS PER-HOP, NOT LEAF-WIDE: a grandparent spray between the parent split and the ' +
      "leaf's own split must NOT apply — a leaf-wide bound against the leaf's own createdAt would " +
      'wrongly let it through',
    () => {
      // B12 splits into B12_A on 2026-02-01. B12_A splits into B12_A_1 on 2026-04-01.
      // B12 is sprayed AGAIN on 2026-03-01 — after B12_A already existed as its own unit.
      const units = [
        landUnit({ id: B12, createdAt: '2020-01-01T00:00:00Z' }),
        landUnit({ id: B12_A, parentId: B12, createdAt: '2026-02-01T00:00:00Z' }),
        landUnit({ id: B12_A_1, parentId: B12_A, createdAt: '2026-04-01T00:00:00Z' }),
      ];
      // A leaf-wide bound (spray.occurredAt < B12_A_1.createdAt = 2026-04-01) would wrongly pass
      // this spray through, since 2026-03-01 < 2026-04-01. The correct, per-hop bound compares it
      // against B12_A's OWN createdAt (2026-02-01) — the split B12's later sprays must not cross.
      const result = phiGuardFor(
        B12_A_1,
        '2026-04-15',
        [spray({ landUnitId: B12, sprayedOn: '2026-03-01', occurredAt: '2026-03-01T08:00:00Z' })],
        PRODUCTS,
        units,
      );
      expect(result).toEqual({ blocked: false });
    },
  );

  it('DOES attribute a grandparent spray that predates the FIRST split in the chain', () => {
    const units = [
      landUnit({ id: B12, createdAt: '2020-01-01T00:00:00Z' }),
      landUnit({ id: B12_A, parentId: B12, createdAt: '2026-02-01T00:00:00Z' }),
      landUnit({ id: B12_A_1, parentId: B12_A, createdAt: '2026-04-01T00:00:00Z' }),
    ];
    // Sprayed 2026-01-20, before EVEN the first split (2026-02-01) — clears 2026-02-10.
    const result = phiGuardFor(
      B12_A_1,
      '2026-02-05', // within the 21-day PHI
      [spray({ landUnitId: B12, sprayedOn: '2026-01-20', occurredAt: '2026-01-20T08:00:00Z' })],
      PRODUCTS,
      units,
    );
    expect(result).toMatchObject({ blocked: true, reason: 'active_phi' });
  });

  it('the LATEST clear date wins across multiple blocking sprays', () => {
    const result = phiGuardFor(
      B12,
      '2026-03-10',
      [
        spray({ sprayedOn: '2026-02-01', occurredAt: '2026-02-01T08:00:00Z' }), // clears 2026-02-22
        spray({ sprayedOn: '2026-03-01', occurredAt: '2026-03-01T08:00:00Z' }), // clears 2026-03-22
      ],
      PRODUCTS,
      [landUnit({ id: B12 })],
    );
    expect(result).toEqual({
      blocked: true,
      reason: 'active_phi',
      blockedBy: {
        productId: PRODUCT_21DAY,
        sprayedOn: '2026-03-01',
        earliestHarvestDate: '2026-03-22',
      },
    });
  });

  it('fails CLOSED when a spray references a product missing from the local cache', () => {
    const result = phiGuardFor(
      B12,
      '2026-03-15',
      [spray({ productId: UNKNOWN_PRODUCT })],
      PRODUCTS,
      [landUnit({ id: B12 })],
    );
    expect(result).toEqual({ blocked: true, reason: 'unresolved' });
  });

  it('an active_phi block takes priority in the result even alongside an unresolved spray', () => {
    const result = phiGuardFor(
      B12,
      '2026-03-10',
      [spray({}), spray({ productId: UNKNOWN_PRODUCT })],
      PRODUCTS,
      [landUnit({ id: B12 })],
    );
    expect(result).toMatchObject({ blocked: true, reason: 'active_phi' });
  });
});

describe('sprayPhiGuardFor (legal-compliance.md § 4.3 — the spray-side EARLY check)', () => {
  it('is clear when the block has no planned harvest date on record', () => {
    const result = sprayPhiGuardFor('2026-03-01', 21, undefined);
    expect(result).toEqual({ blocked: false });
  });

  it('blocks when a 21-day PHI from the spray day would clear AFTER the planned harvest', () => {
    // Sprayed 2026-03-01, 21-day PHI clears 2026-03-22. Planned harvest 2026-03-15 falls inside it.
    const result = sprayPhiGuardFor('2026-03-01', 21, '2026-03-15');
    expect(result).toEqual({
      blocked: true,
      reason: 'active_phi',
      earliestHarvestDate: '2026-03-22',
      expectedHarvestDate: '2026-03-15',
    });
  });

  it('is clear when the planned harvest is safely after the PHI clears', () => {
    const result = sprayPhiGuardFor('2026-03-01', 21, '2026-04-01');
    expect(result).toEqual({ blocked: false });
  });

  it('is clear exactly on the day the PHI clears — inclusive at the boundary', () => {
    const result = sprayPhiGuardFor('2026-03-01', 21, '2026-03-22');
    expect(result).toEqual({ blocked: false });
  });

  it('blocks by one day when the planned harvest falls the day before the PHI clears', () => {
    const result = sprayPhiGuardFor('2026-03-01', 21, '2026-03-21');
    expect(result).toMatchObject({ blocked: true, reason: 'active_phi' });
  });

  it('a zero-day PHI never blocks — the spray day itself is always safe to harvest', () => {
    const result = sprayPhiGuardFor('2026-03-01', 0, '2026-03-01');
    expect(result).toEqual({ blocked: false });
  });
});
