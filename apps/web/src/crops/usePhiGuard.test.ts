/**
 * The Sprays home tile's attention badge (`blocksWithinPhi`), tested as a pure function: does it
 * count a block currently inside an active PHI, does it stay silent about a block that has
 * cleared, and does it deliberately EXCLUDE an unresolved spray rather than over-counting a gap
 * this badge does not claim to state — see `blocksWithinPhi`'s own docstring.
 */

import { describe, expect, it } from 'vitest';
import type { PhiProductFact, PhiSprayFact } from '@werf/domain';
import { blocksWithinPhi, sprayFactsOf } from './usePhiGuard';
import type { StoredSpray } from './LocalSprays';

const BLOCK_A = 'block-a';
const BLOCK_B = 'block-b';
const PRODUCT_ID = 'product-21day';
const TODAY = '2026-03-15';

const PRODUCTS: PhiProductFact[] = [{ id: PRODUCT_ID, phiDays: 21 }];

function spray(overrides: Partial<PhiSprayFact> = {}): PhiSprayFact {
  return {
    landUnitId: BLOCK_A,
    occurredAt: '2026-03-01T08:00:00Z',
    sprayedOn: '2026-03-01',
    productId: PRODUCT_ID,
    resolved: false,
    ...overrides,
  };
}

describe('blocksWithinPhi', () => {
  it('counts a block whose own spray history puts today inside an active PHI', () => {
    const result = blocksWithinPhi([BLOCK_A], TODAY, [spray()], PRODUCTS);
    expect(result).toEqual([BLOCK_A]);
  });

  it('stays silent about a block whose PHI has already cleared', () => {
    const result = blocksWithinPhi([BLOCK_A], '2026-03-23', [spray()], PRODUCTS);
    expect(result).toEqual([]);
  });

  it('stays silent about a block with no spray history at all', () => {
    const result = blocksWithinPhi([BLOCK_B], TODAY, [spray()], PRODUCTS);
    expect(result).toEqual([]);
  });

  it('⭐ does NOT count an unresolved spray whose product this device cannot look up — a real gap, but not the fact this badge states', () => {
    const result = blocksWithinPhi(
      [BLOCK_A],
      TODAY,
      [spray({ productId: 'unknown-product' })],
      PRODUCTS,
    );
    expect(result).toEqual([]);
  });

  it('counts every block independently, across a farm with several', () => {
    const result = blocksWithinPhi(
      [BLOCK_A, BLOCK_B],
      TODAY,
      [spray({ landUnitId: BLOCK_A }), spray({ landUnitId: BLOCK_B })],
      PRODUCTS,
    );
    expect(result.slice().sort()).toEqual([BLOCK_A, BLOCK_B]);
  });
});

describe('sprayFactsOf', () => {
  const SPRAY_ID = 'spray-1';

  function storedSpray(overrides: Partial<StoredSpray> = {}): StoredSpray {
    return {
      id: SPRAY_ID,
      farmId: 'farm-1',
      landUnitId: BLOCK_A,
      occurredAt: '2026-03-01T08:00:00Z',
      sprayedOn: '2026-03-01',
      productId: PRODUCT_ID,
      productName: 'Roundup PowerMax',
      ...overrides,
    };
  }

  // O-12: a local capture waiting to send has no server-confirmed answer, so it must fall back to
  // the offline PREVIEW (`resolved: false`) rather than reading as "confirmed, no PHI on record" —
  // reading it as resolved silently drops the reminder this device exists to give.
  it('marks a local, not-yet-hydrated capture unresolved', () => {
    const [fact] = sprayFactsOf([storedSpray()], new Set());
    expect(fact!.resolved).toBe(false);
  });

  // The regression: `activeIngredients` used to double as the "server-confirmed" discriminator
  // because it was required and non-empty on the wire. This same PR relaxed it to optional
  // (`sprayPayloadSchema.activeIngredients`), so a fully confirmed spray with none entered
  // (`storedSpray()`'s base fixture already omits it) must still read as resolved once its id is
  // in the hydrated set, whether captured here or hydrated from another device — the old
  // activeIngredients-presence check would have left it permanently "unresolved" and open to
  // inventing a stale reminder from today's catalogue instead of skipping cleanly.
  it('marks a spray resolved once its id is in the hydrated set, even with no activeIngredients on it at all', () => {
    const [fact] = sprayFactsOf([storedSpray()], new Set([SPRAY_ID]));
    expect(fact!.resolved).toBe(true);
  });

  // Same safe posture as an ordinary unconfirmed local capture (above), and deliberately so — a
  // caller mid-hydration, or one whose hydration attempt has settled and failed, is in exactly the
  // same position: it cannot currently PROVE the spray round-tripped, so it must pass whatever
  // hydrated-id set it actually has (possibly empty), never a stand-in default (`sprayFactsOf`'s
  // own docstring).
  it('treats an empty hydrated set as unresolved for every spray, whether that is a loading window or a settled failure', () => {
    const [fact] = sprayFactsOf([storedSpray()], new Set());
    expect(fact!.resolved).toBe(false);
  });
});
