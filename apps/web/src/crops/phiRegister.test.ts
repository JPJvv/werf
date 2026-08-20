/**
 * The device's own half of the PHI compliance register (4d·6), tested as a pure function: does it
 * flag a harvest its own evidence now says was inside an active PHI, does it stay silent about an
 * override (a deliberate decision, not a race), and does it run the SAME `phiGuardFor` the at-capture
 * guard runs rather than a second, narrower rule.
 */

import { describe, expect, it } from 'vitest';
import type { PhiProductFact, PhiSprayFact } from '@werf/domain';
import { localPhiFlags } from './phiRegister';
import type { StoredHarvest } from './LocalHarvest';

const BLOCK_ID = 'b12';
const PRODUCT_ID = 'product-21day';

const PRODUCTS: PhiProductFact[] = [{ id: PRODUCT_ID, phiDays: 21 }];

function harvest(overrides: Partial<StoredHarvest> = {}): StoredHarvest {
  return {
    id: 'harvest-1',
    farmId: 'farm-1',
    landUnitId: BLOCK_ID,
    occurredAt: '2026-03-15T08:00:00.000Z',
    harvestedOn: '2026-03-15',
    quantity: 5,
    unit: 'ton',
    ...overrides,
  };
}

function spray(overrides: Partial<PhiSprayFact> = {}): PhiSprayFact {
  return {
    landUnitId: BLOCK_ID,
    occurredAt: '2026-03-01T08:00:00Z',
    sprayedOn: '2026-03-01',
    productId: PRODUCT_ID,
    resolved: false,
    ...overrides,
  };
}

describe('localPhiFlags (4d·6)', () => {
  it('flags a harvest this device recorded that its own evidence now says was inside an active PHI', () => {
    const flags = localPhiFlags([harvest()], [spray()], PRODUCTS);

    expect(flags).toEqual([
      {
        eventId: 'harvest-1',
        landUnitId: BLOCK_ID,
        harvestedOn: '2026-03-15',
        productId: PRODUCT_ID,
        sprayedOn: '2026-03-01',
        earliestHarvestDate: '2026-03-22',
      },
    ]);
  });

  it('stays silent about a harvest that was actually clear', () => {
    const flags = localPhiFlags([harvest({ harvestedOn: '2026-03-23' })], [spray()], PRODUCTS);
    expect(flags).toEqual([]);
  });

  it('⭐ never flags an overridden harvest — a deliberate, already-audited decision, not a race', () => {
    const flags = localPhiFlags(
      [harvest({ phiOverride: { reason: 'Export deadline' } })],
      [spray()],
      PRODUCTS,
    );
    expect(flags).toEqual([]);
  });

  it('stays silent when this device has no evidence of any spray at all', () => {
    const flags = localPhiFlags([harvest()], [], PRODUCTS);
    expect(flags).toEqual([]);
  });

  it('flags every blocked harvest on this device, independently', () => {
    const flags = localPhiFlags(
      [harvest({ id: 'h1', landUnitId: BLOCK_ID }), harvest({ id: 'h2', landUnitId: 'other' })],
      [spray(), spray({ landUnitId: 'other' })],
      PRODUCTS,
    );
    expect(flags.map((f) => f.eventId).sort()).toEqual(['h1', 'h2']);
  });
});
