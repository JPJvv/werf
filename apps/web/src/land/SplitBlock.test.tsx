/**
 * Splitting a block as a farmer does it (FR-202): name the children, save, and the old block is
 * kept in the record rather than closed — with no signal anywhere in the path (NFR-007).
 *
 * ⭐ The one property worth the most here: a child inherits whatever was last planted on the ground
 * it came from. The split closes nothing on the parent, so a vineyard's vines do not vanish from the
 * record the moment the block they stand in gets a new id — see `@werf/domain/land/ancestry.ts`'s
 * module note and `LocalPlantings.tsx`'s `useCurrentPlanting`.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';
import { storedCaptures } from '../test-support/local-db';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const BLOCK_ID = '0190f3a0-0000-7000-8000-0000000000b1';
const LAND_KEY = `werf-land:${FARM_ID}`;
const PLANTINGS_KEY = `werf-plantings:${FARM_ID}`;

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
        enterpriseTypes: ['vineyards'],
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

/** A minimal block, every field defaulted, so a test only has to name what actually varies. */
function blankUnit(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: BLOCK_ID,
    farmId: FARM_ID,
    kind: 'block',
    code: 'B12',
    name: null,
    enterpriseId: null,
    parentId: null,
    boundaryGeojson: null,
    hectares: 20,
    carryingCapacityLsu: null,
    soilType: 'Sandy loam',
    irrigation: 'drip',
    attributes: {},
    ...overrides,
  };
}

function cachedBlock(overrides: Partial<Record<string, unknown>> = {}): void {
  window.localStorage.setItem(LAND_KEY, JSON.stringify([blankUnit(overrides)]));
}

function storedUnits(): Promise<readonly Record<string, unknown>[]> {
  return storedCaptures<Record<string, unknown>>(LAND_KEY);
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

describe('splitting a block (FR-202)', () => {
  it('creates two children referencing the parent, inheriting its soil and irrigation, with the network dead', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', `/land/split?block=${BLOCK_ID}`);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    render(<App />);

    const rows = await screen.findAllByText(/^Block \d$/);
    expect(rows).toHaveLength(2);

    const codeInputs = screen.getAllByLabelText(/block name or number/i);
    await user.type(codeInputs[0]!, 'B12-A');
    await user.type(codeInputs[1]!, 'B12-B');
    await user.click(screen.getByRole('button', { name: /save the split/i }));

    await waitFor(async () => {
      expect(await storedUnits()).toHaveLength(3); // parent + 2 children
    });
    const units = await storedUnits();
    const a = units.find((u) => u['code'] === 'B12-A');
    const b = units.find((u) => u['code'] === 'B12-B');
    expect(a).toMatchObject({
      parentId: BLOCK_ID,
      kind: 'block',
      soilType: 'Sandy loam',
      irrigation: 'drip',
    });
    expect(b).toMatchObject({ parentId: BLOCK_ID, kind: 'block' });
    // The parent itself is untouched — never closed, never re-written.
    const parent = units.find((u) => u['id'] === BLOCK_ID);
    expect(parent).toMatchObject({ code: 'B12', parentId: null });
  });

  it('⭐ a child shows the PARENT’s planting as its own current one — nothing was replanted', async () => {
    // The vines B12 was planted with 5 years ago do not vanish because the block they stand in got
    // a new id. `useCurrentPlanting` must walk `parent_id` to find this, not just the child's own
    // (empty) event log.
    const plantingId = '0190f3a0-0000-7000-8000-00000000e001';
    window.localStorage.setItem(
      PLANTINGS_KEY,
      JSON.stringify([
        {
          id: plantingId,
          farmId: FARM_ID,
          landUnitId: BLOCK_ID,
          occurredAt: '2021-09-01T04:00:00.000Z',
          crop: 'Cabernet Sauvignon',
        },
      ]),
    );
    const user = userEvent.setup();
    window.history.pushState({}, '', `/land/split?block=${BLOCK_ID}`);
    render(<App />);

    const codeInputs = await screen.findAllByLabelText(/block name or number/i);
    await user.type(codeInputs[0]!, 'B12-A');
    await user.type(codeInputs[1]!, 'B12-B');
    await user.click(screen.getByRole('button', { name: /save the split/i }));

    await waitFor(async () => {
      expect(await storedUnits()).toHaveLength(3);
    });

    // Navigate within the SAME render (client-side routing) rather than mounting a second `<App/>`.
    await user.click(screen.getByRole('link', { name: /back to land/i }));

    // Scoped to each unit's own row, not a document-wide count — a count alone would pass even if
    // one child rendered it twice and the other not at all.
    const parentRow = (await screen.findByText('B12')).closest('li')!;
    const childARow = (await screen.findByText('B12-A')).closest('li')!;
    const childBRow = (await screen.findByText('B12-B')).closest('li')!;
    // `getByText` itself throws if the row doesn't carry it — no jest-dom matcher needed.
    within(parentRow).getByText('Cabernet Sauvignon');
    within(childARow).getByText('Cabernet Sauvignon');
    within(childBRow).getByText('Cabernet Sauvignon');
  });

  it('refuses a child code the farm already uses', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', `/land/split?block=${BLOCK_ID}`);
    render(<App />);

    const codeInputs = await screen.findAllByLabelText(/block name or number/i);
    await user.type(codeInputs[0]!, 'b12'); // same as the parent, case-insensitive
    await user.type(codeInputs[1]!, 'B12-B');

    expect(screen.getByText(/already has a block with that name/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /save the split/i }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(await storedUnits()).toHaveLength(1);
  });

  it('refuses two children sharing the same code with each other', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', `/land/split?block=${BLOCK_ID}`);
    render(<App />);

    const codeInputs = await screen.findAllByLabelText(/block name or number/i);
    await user.type(codeInputs[0]!, 'B12-A');
    await user.type(codeInputs[1]!, 'b12-a');

    // Both siblings show the problem — each is the "other" duplicate from the other's point of view.
    expect(screen.getAllByText(/same name/i)).toHaveLength(2);
    expect(screen.getByRole('button', { name: /save the split/i }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('will not save with fewer than two named children', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', `/land/split?block=${BLOCK_ID}`);
    render(<App />);

    const codeInputs = await screen.findAllByLabelText(/block name or number/i);
    await user.type(codeInputs[0]!, 'B12-A');
    // Second child left blank.

    expect(screen.getByRole('button', { name: /save the split/i }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(await storedUnits()).toHaveLength(1);
  });

  it('supports more than two children via "add another"', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', `/land/split?block=${BLOCK_ID}`);
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /add another block/i }));
    const codeInputs = screen.getAllByLabelText(/block name or number/i);
    expect(codeInputs).toHaveLength(3);

    await user.type(codeInputs[0]!, 'B12-A');
    await user.type(codeInputs[1]!, 'B12-B');
    await user.type(codeInputs[2]!, 'B12-C');
    await user.click(screen.getByRole('button', { name: /save the split/i }));

    await waitFor(async () => {
      expect(await storedUnits()).toHaveLength(4);
    });
  });

  it('is reachable from a block’s row, and the row stops offering it once split', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/land');
    render(<App />);

    await user.click(await screen.findByRole('link', { name: /split this block/i }));
    const codeInputs = await screen.findAllByLabelText(/block name or number/i);
    await user.type(codeInputs[0]!, 'B12-A');
    await user.type(codeInputs[1]!, 'B12-B');
    await user.click(screen.getByRole('button', { name: /save the split/i }));

    await waitFor(async () => {
      expect(await storedUnits()).toHaveLength(3);
    });

    // Navigate within the SAME render (client-side routing), not a second `<App/>` mount — two
    // mounted apps would each show their own "Split into:"/confirmation text at once.
    await user.click(screen.getByRole('link', { name: /back to land/i }));

    // Scoped to the PARENT's own row: its two new children are blocks in their own right and
    // correctly still offer "Split this block" for themselves — only B12 itself should stop.
    const parentRow = (await screen.findByText('B12')).closest('li')!;
    expect(within(parentRow).getByText(/split into:/i)).toBeTruthy();
    expect(within(parentRow).getByText(/B12-A, B12-B/)).toBeTruthy();
    expect(within(parentRow).queryByRole('link', { name: /split this block/i })).toBeNull();
  });

  it('⭐ will not offer an ALREADY-SPLIT block as something to split again (one generation only)', async () => {
    const CHILD_ID = '0190f3a0-0000-7000-8000-0000000000c1';
    const OTHER_LEAF_ID = '0190f3a0-0000-7000-8000-0000000000b9';
    window.localStorage.setItem(
      LAND_KEY,
      JSON.stringify([
        { ...blankUnit(), id: BLOCK_ID, code: 'B12', parentId: null },
        { ...blankUnit(), id: CHILD_ID, code: 'B12-A', parentId: BLOCK_ID },
        { ...blankUnit(), id: OTHER_LEAF_ID, code: 'B99', parentId: null },
      ]),
    );

    // The picker (no `?block=`) must not default to an already-split block just because it's first
    // in the list — it should fall through to a real leaf.
    window.history.pushState({}, '', '/land/split');
    render(<App />);
    const options = await screen.findAllByRole('option');
    const codes = options.map((o) => o.textContent);
    expect(codes).not.toContain('B12');
    expect(codes).toEqual(expect.arrayContaining(['B12-A', 'B99']));

    // Asking for the already-split block explicitly by id must not honour it either — the picker
    // falls back to the first leaf rather than the requested, already-divided ground.
    window.history.pushState({}, '', `/land/split?block=${BLOCK_ID}`);
    render(<App />);
    const select = (await screen.findAllByLabelText(/which block/i)).at(-1) as HTMLSelectElement;
    expect(select.value).not.toBe(BLOCK_ID);
  });

  it('keeps the parent’s own boundary and planting rows visible after the split — history is not closed', async () => {
    window.localStorage.setItem(
      PLANTINGS_KEY,
      JSON.stringify([
        {
          id: '0190f3a0-0000-7000-8000-00000000e002',
          farmId: FARM_ID,
          landUnitId: BLOCK_ID,
          occurredAt: '2021-09-01T04:00:00.000Z',
          crop: 'Cabernet Sauvignon',
        },
      ]),
    );
    window.localStorage.setItem(
      LAND_KEY,
      JSON.stringify([
        {
          id: BLOCK_ID,
          farmId: FARM_ID,
          kind: 'block',
          code: 'B12',
          name: null,
          enterpriseId: null,
          parentId: null,
          boundaryGeojson: null,
          hectares: 20,
          carryingCapacityLsu: null,
          soilType: 'Sandy loam',
          irrigation: 'drip',
          attributes: {},
        },
        {
          id: '0190f3a0-0000-7000-8000-0000000000b2',
          farmId: FARM_ID,
          kind: 'block',
          code: 'B12-A',
          name: null,
          enterpriseId: null,
          parentId: BLOCK_ID,
          boundaryGeojson: null,
          hectares: 10,
          carryingCapacityLsu: null,
          soilType: 'Sandy loam',
          irrigation: 'drip',
          attributes: {},
        },
      ]),
    );
    window.history.pushState({}, '', '/land');
    render(<App />);

    const parentRow = (await screen.findByText('B12')).closest('li')!;
    expect(within(parentRow).getByText(/split into:/i)).toBeTruthy();
    expect(within(parentRow).getByText('Cabernet Sauvignon')).toBeTruthy();
  });
});
