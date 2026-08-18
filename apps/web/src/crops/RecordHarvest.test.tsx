/**
 * Recording a harvest as a farmer does it (FR-207) — COMPLIANCE-GATED (US-030): pick the block, the
 * day, quantity and unit, save — with no signal anywhere in the path (NFR-007), and BLOCKED at
 * capture inside an active pre-harvest interval unless overridden (FR-205). Same shape as
 * `RecordSpray.test.tsx`: seed `localStorage`, render the real `<App/>`, read the harvest back
 * through the same boot path a cold start uses.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';
import { storedCaptures } from '../test-support/local-db';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const BLOCK_ID = '0190f3a0-0000-7000-8000-0000000000b1';
const CHILD_BLOCK_ID = '0190f3a0-0000-7000-8000-0000000000b2';
const PRODUCT_ID = '0190f3a0-0000-7000-8000-00000000d001';
const SPRAY_ID = '0190f3a0-0000-7000-8000-00000000e001';
const LAND_KEY = `werf-land:${FARM_ID}`;
const SPRAYS_KEY = `werf-sprays:${FARM_ID}`;
const HARVESTS_KEY = `werf-harvests:${FARM_ID}`;
const PRODUCTS_KEY = `werf-chemical-products:${FARM_ID}`;

const SESSION_USER: schemas.AuthSession['user'] = {
  id: '0190f3a0-0000-7000-8000-000000000001',
  email: 'thabo@rietfontein.test',
  phone: null,
  fullName: 'Thabo Mokoena',
  locale: 'en-ZA',
  theme: 'light',
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

function cachedSession(): void {
  const payload = {
    accessToken: 'access-token',
    expiresIn: 900,
    refreshToken: 'refresh-token',
    refreshExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    user: SESSION_USER,
    farms: [
      {
        id: FARM_ID,
        name: 'Rietfontein',
        enterpriseTypes: ['row_crops'],
        role: 'owner',
        enterprises: [],
      },
    ],
    activeFarmId: FARM_ID,
    secondFactor: 'complete',
  };
  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ payload, confirmedAt: new Date().toISOString() }),
  );
}

function cachedBlock(overrides: { id: string; parentId?: string | null } = { id: BLOCK_ID }): void {
  const raw = window.localStorage.getItem(LAND_KEY);
  const existing: unknown[] = raw ? (JSON.parse(raw) as unknown[]) : [];
  existing.push({
    id: overrides.id,
    farmId: FARM_ID,
    kind: 'block',
    code: overrides.id === BLOCK_ID ? 'B12' : 'B12-A',
    name: null,
    enterpriseId: null,
    parentId: overrides.parentId ?? null,
    boundaryGeojson: null,
    hectares: null,
    carryingCapacityLsu: null,
    soilType: null,
    irrigation: null,
    attributes: {},
  });
  window.localStorage.setItem(LAND_KEY, JSON.stringify(existing));
}

function seedProducts(phiDays: number | null): void {
  window.localStorage.setItem(
    PRODUCTS_KEY,
    JSON.stringify([
      {
        id: PRODUCT_ID,
        jurisdiction: 'ZA',
        name: 'Cyprodinex 50 WG',
        registrationNumber: 'L1234',
        crop: 'grapes',
        phiDays,
        reentryHours: 12,
        effectiveFrom: '2020-01-01',
        effectiveTo: null,
      },
    ]),
  );
}

/** A LOCAL, never-flushed spray — no `activeIngredients`/`earliestHarvestDate`, the O-12 offline
 *  case `phi-guard.ts` exists to cover. */
function seedLocalSpray(sprayedOn: string, landUnitId: string = BLOCK_ID): void {
  window.localStorage.setItem(
    SPRAYS_KEY,
    JSON.stringify([
      {
        id: SPRAY_ID,
        farmId: FARM_ID,
        landUnitId,
        occurredAt: `${sprayedOn}T08:00:00.000Z`,
        sprayedOn,
        productId: PRODUCT_ID,
      },
    ]),
  );
}

function storedHarvests(): Promise<readonly Record<string, unknown>[]> {
  return storedCaptures<Record<string, unknown>>(HARVESTS_KEY);
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
  cachedSession();
  cachedBlock();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('recording a harvest (FR-207)', () => {
  it('saves against a real block with the network dead, not merely absent', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', `/crops/harvest?block=${BLOCK_ID}`);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    render(<App />);

    await user.type(await screen.findByLabelText(/quantity/i), '12.5');
    await user.type(screen.getByLabelText(/^unit$/i), 'ton');
    await user.click(screen.getByRole('button', { name: /save harvest/i }));

    await waitFor(async () => {
      expect(await storedHarvests()).toHaveLength(1);
    });
    const saved = await storedHarvests();
    expect(saved[0]).toMatchObject({
      farmId: FARM_ID,
      landUnitId: BLOCK_ID,
      quantity: 12.5,
      unit: 'ton',
    });
    expect(saved[0]!['phiOverride']).toBeUndefined();
  });

  it('keeps Save disabled once the day is cleared, rather than submitting an unreadable day', async () => {
    // A cleared `<input type="date">` reports `''`, and `valid` did not check for it — quantity and
    // unit alone were enough to enable Save, and submitting sent `harvestedOn: ''` into
    // `recordHarvest`'s domain builder, which throws on `dateSchema` inside the async handler with no
    // feedback shown and `setSaving(false)` never reached. `withdrawal.ts`'s `unreadableDay` names the
    // same class: `''` is an ordinary state a date input can be in, not a defect anywhere upstream.
    const user = userEvent.setup();
    window.history.pushState({}, '', `/crops/harvest?block=${BLOCK_ID}`);
    render(<App />);

    await user.type(await screen.findByLabelText(/quantity/i), '5');
    await user.type(screen.getByLabelText(/^unit$/i), 'ton');
    const day = screen.getByLabelText(/day harvested/i) as HTMLInputElement;
    await user.clear(day);

    expect(screen.getByRole('button', { name: /save harvest/i }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(await storedHarvests()).toHaveLength(0);
  });

  it("US-030: blocks a harvest inside a LOCAL spray's PHI, previewed offline with no server round trip (O-12)", async () => {
    seedProducts(21);
    seedLocalSpray('2026-03-01');
    const user = userEvent.setup();
    window.history.pushState({}, '', `/crops/harvest?block=${BLOCK_ID}`);
    render(<App />);

    await user.type(await screen.findByLabelText(/quantity/i), '5');
    await user.type(screen.getByLabelText(/^unit$/i), 'ton');
    const day = screen.getByLabelText(/day harvested/i) as HTMLInputElement;
    await user.clear(day);
    await user.type(day, '2026-03-15');

    expect(await screen.findByText(/pre-harvest interval/i)).toBeTruthy();
    expect(screen.getByText(/2026-03-01/)).toBeTruthy();
    expect(screen.getByText(/2026-03-22/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /save harvest/i }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('US-030: an override requires a category AND free text, and is recorded with the harvest', async () => {
    seedProducts(21);
    seedLocalSpray('2026-03-01');
    const user = userEvent.setup();
    window.history.pushState({}, '', `/crops/harvest?block=${BLOCK_ID}`);
    render(<App />);

    await user.type(await screen.findByLabelText(/quantity/i), '5');
    await user.type(screen.getByLabelText(/^unit$/i), 'ton');
    const day = screen.getByLabelText(/day harvested/i) as HTMLInputElement;
    await user.clear(day);
    await user.type(day, '2026-03-15');
    await screen.findByText(/pre-harvest interval/i);

    await user.click(screen.getByRole('button', { name: /^override$/i }));
    expect(
      screen.getByRole('button', { name: /save harvest with override/i }).hasAttribute('disabled'),
    ).toBe(true);

    await user.selectOptions(screen.getByLabelText(/reason/i), 'export_deadline');
    expect(
      screen.getByRole('button', { name: /save harvest with override/i }).hasAttribute('disabled'),
    ).toBe(true);

    await user.type(screen.getByLabelText(/details/i), 'Buyer contract on file');
    await user.click(screen.getByRole('button', { name: /save harvest with override/i }));

    await waitFor(async () => {
      expect(await storedHarvests()).toHaveLength(1);
    });
    const saved = (await storedHarvests())[0] as { phiOverride?: { reason?: string } };
    expect(saved.phiOverride?.reason).toContain('Buyer contract on file');
    // `by` is never client-set — see `LocalHarvest.tsx`'s module note.
    expect(saved.phiOverride && 'by' in saved.phiOverride).toBe(false);
  });

  it('proceeds normally once the PHI clears', async () => {
    seedProducts(21);
    seedLocalSpray('2026-03-01');
    const user = userEvent.setup();
    window.history.pushState({}, '', `/crops/harvest?block=${BLOCK_ID}`);
    render(<App />);

    await user.type(await screen.findByLabelText(/quantity/i), '5');
    await user.type(screen.getByLabelText(/^unit$/i), 'ton');
    const day = screen.getByLabelText(/day harvested/i) as HTMLInputElement;
    await user.clear(day);
    await user.type(day, '2026-03-23');

    expect(screen.queryByText(/pre-harvest interval/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: /save harvest/i }));

    await waitFor(async () => {
      expect(await storedHarvests()).toHaveLength(1);
    });
  });

  it('discloses that a split block’s inherited spray history cannot be confirmed offline (phi-guard.ts asymmetry)', async () => {
    cachedBlock({ id: CHILD_BLOCK_ID, parentId: BLOCK_ID });
    window.history.pushState({}, '', `/crops/harvest?block=${CHILD_BLOCK_ID}`);
    render(<App />);

    expect(await screen.findByText(/cannot confirm its full spray history offline/i)).toBeTruthy();
  });

  it('offers no block picker and points at adding one first, when the farm has none yet', async () => {
    window.localStorage.removeItem(LAND_KEY);
    window.history.pushState({}, '', '/crops/harvest');
    render(<App />);

    expect(await screen.findByText(/no blocks yet/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /add a block/i })).toBeTruthy();
  });

  it('is reachable from the harvest-history screen', async () => {
    window.history.pushState({}, '', '/harvest');
    render(<App />);

    await userEvent.setup().click(screen.getByRole('link', { name: /record a harvest/i }));

    expect(await screen.findByLabelText(/quantity/i)).toBeTruthy();
  });
});
