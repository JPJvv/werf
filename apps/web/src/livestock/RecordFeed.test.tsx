/**
 * Recording a feed-out (Phase 4e, FR-153) as a farmer does it: pick a group OR a camp, pick the
 * feed lot it came from, type how much. Renders the real `<App/>` against a seeded `localStorage`
 * — the same shape `MoveMob.test.tsx`/`RecordFertiliser.test.tsx` use for their own screens.
 *
 * The design points under test: a group's camp is never typed (it's read off the mob's own
 * `landUnitId`, and only a camp-only feed-out sends one); the estimated cost shown is DERIVED from
 * the lot's own received cost, never a farmer-typed figure; and feeding drives TWO independent
 * local commits (the feed event and a `consumed` movement), the same 4e·4 shape spray/fertiliser
 * already prove.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7, type schemas } from '@werf/core';
import { App } from '../App';
import { storedCaptures } from '../test-support/local-db';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f3';
const LAND_KEY = `werf-land:${FARM_ID}`;
const MOBS_KEY = `werf-mobs:${FARM_ID}`;
const FEED_KEY = `werf-feed:${FARM_ID}`;
const ITEMS_KEY = `werf-inventory-items:${FARM_ID}`;
const LOTS_KEY = `werf-inventory-lots:${FARM_ID}`;
const MOVEMENTS_KEY = `werf-inventory-movements:${FARM_ID}`;

const ITEM_ID = '0190f3a0-0000-7000-8000-0000000000i1';
const LOT_ID = '0190f3a0-0000-7000-8000-0000000000l1';
const HERD = { id: '0190f3a0-0000-7000-8000-0000000000e1', name: 'Dorper flock', type: 'sheep' };

const SESSION_USER: schemas.AuthSession['user'] = {
  id: '0190f3a0-0000-7000-8000-000000000002',
  email: 'thabo@rietfontein.test',
  phone: null,
  fullName: 'Thabo Mokoena',
  locale: 'en-ZA',
  theme: 'light',
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

function cachedSession(
  enterprises: readonly { id: string; name: string; type: string }[] = [],
): void {
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
        enterpriseTypes: ['sheep_wool'],
        role: 'owner',
        enterprises,
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

function seedCamps(...codes: string[]): string[] {
  const ids = codes.map(() => uuidv7());
  window.localStorage.setItem(
    LAND_KEY,
    JSON.stringify(
      codes.map((code, i) => ({
        id: ids[i],
        farmId: FARM_ID,
        enterpriseId: null,
        parentId: null,
        kind: 'camp',
        code,
        name: null,
        boundaryGeojson: null,
        hectares: null,
        carryingCapacityLsu: null,
        soilType: null,
        irrigation: null,
        attributes: {},
      })),
    ),
  );
  return ids;
}

function seedMob(name: string, landUnitId: string | null): string {
  const id = uuidv7();
  window.localStorage.setItem(
    MOBS_KEY,
    JSON.stringify([
      {
        id,
        farmId: FARM_ID,
        enterpriseId: null,
        name,
        species: 'sheep',
        landUnitId,
        headCount: 300,
        initialHeadCount: 300,
      },
    ]),
  );
  return id;
}

/** A feed lot with 100kg received at R5.00/kg — so the screen's cost preview has a real basis. */
function seedFeedLot(): void {
  window.localStorage.setItem(
    ITEMS_KEY,
    JSON.stringify([
      {
        id: ITEM_ID,
        farmId: FARM_ID,
        enterpriseId: null,
        category: 'feed',
        name: 'Lucerne',
        unit: 'kg',
      },
    ]),
  );
  window.localStorage.setItem(
    LOTS_KEY,
    JSON.stringify([
      {
        id: LOT_ID,
        farmId: FARM_ID,
        inventoryItemId: ITEM_ID,
        batch: null,
        expiryDate: null,
        location: null,
      },
    ]),
  );
  window.localStorage.setItem(
    MOVEMENTS_KEY,
    JSON.stringify([
      {
        id: uuidv7(),
        farmId: FARM_ID,
        inventoryLotId: LOT_ID,
        occurredAt: '2026-08-01T04:00:00.000Z',
        reason: 'received',
        quantity: 100,
        delta: 100,
        unitCostCents: 500,
      },
    ]),
  );
}

function storedFeeds(): Promise<readonly Record<string, unknown>[]> {
  return storedCaptures<Record<string, unknown>>(FEED_KEY);
}

function storedMovements(): Promise<readonly Record<string, unknown>[]> {
  return storedCaptures<Record<string, unknown>>(MOVEMENTS_KEY);
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  window.localStorage.clear();
});

describe('recording a feed-out (FR-153)', () => {
  it('says there is nothing to feed yet, when there are no groups or camps at all', async () => {
    cachedSession();
    window.history.pushState({}, '', '/animals/feed');
    render(<App />);

    expect(await screen.findByText(/no groups or camps to feed yet/i)).toBeTruthy();
  });

  it('says there is no feed in stock, even though a group exists to feed', async () => {
    cachedSession();
    seedMob('Flock A', null);
    window.history.pushState({}, '', '/animals/feed');
    render(<App />);

    expect(await screen.findByText(/no feed in stock yet/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /receive stock/i })).toBeTruthy();
  });

  it('feeds a group — the camp is never typed, and TWO local commits land: the feed and the stock draw', async () => {
    cachedSession();
    const [camp1] = seedCamps('Camp 1');
    seedMob('Flock A', camp1!);
    seedFeedLot();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/feed');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Flock A/ }));
    await user.selectOptions(screen.getByLabelText(/from stock/i), LOT_ID);
    await user.type(screen.getByLabelText(/quantity/i), '20');

    // The estimate is DERIVED (100kg @ R5.00 → R5.00/kg × 20kg), never a field the farmer typed.
    expect(await screen.findByText(/estimated cost/i)).toBeTruthy();
    expect(screen.getByText(/R100\.00/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    let feeds: readonly Record<string, unknown>[] = [];
    await waitFor(async () => {
      feeds = await storedFeeds();
      expect(feeds).toHaveLength(1);
    });
    expect(feeds[0]!['mobId']).toBeTruthy();
    // A group feed-out never sends a camp — the server derives it from the mob's own row.
    expect(feeds[0]).not.toHaveProperty('landUnitId');
    expect(feeds[0]!['inventoryLotId']).toBe(LOT_ID);
    expect(feeds[0]!['quantity']).toBe(20);

    const movements = await storedMovements();
    // The seeded receipt plus this feed's own `consumed` draw.
    expect(movements).toHaveLength(2);
    const consumed = movements.find((m) => m['reason'] === 'consumed');
    expect(consumed).toBeTruthy();
    expect(consumed!['quantity']).toBe(20);
  });

  it('feeds a camp with no group tracked, naming the single herd automatically', async () => {
    cachedSession([HERD]);
    const [camp1] = seedCamps('Camp 1');
    seedFeedLot();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/feed');
    render(<App />);

    await user.selectOptions(await screen.findByLabelText(/or a camp with no group/i), camp1!);
    await user.selectOptions(screen.getByLabelText(/from stock/i), LOT_ID);
    await user.type(screen.getByLabelText(/quantity/i), '15');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    let feeds: readonly Record<string, unknown>[] = [];
    await waitFor(async () => {
      feeds = await storedFeeds();
      expect(feeds).toHaveLength(1);
    });
    expect(feeds[0]!['mobId']).toBeNull();
    expect(feeds[0]!['landUnitId']).toBe(camp1);
    expect(feeds[0]!['enterpriseId']).toBe(HERD.id);
  });
});
