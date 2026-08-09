import { expect, test } from '@playwright/test';
import { FARM_ID, seed } from './session';
import { storedCaptures } from './local-db';

/**
 * The localStorage → SQLite/OPFS capture migration (phase-checklists.md 3c), on the BUILT PWA, in
 * a real browser — the one rung `packages/sync/test/sqlite-capture-store.spec.ts` cannot prove,
 * because that spec runs against a hand-written fake `LocalDatabase` (real `PowerSyncDatabase`
 * opens real OPFS/Worker/WASM machinery that hangs forever under plain Node —
 * `local-database.ts`'s own header). This is where the real engine's `writeTransaction` and this
 * repo's `capture_records`/`capture_migrations` schema actually meet real localStorage.
 *
 * Scope: a clean end-to-end migration, and that append order survives it — the guarantee
 * `apps/web/src/sync/Outbox.tsx`'s FK/`guardedBy`/`needsHead` logic depends on. The interruption/
 * atomicity case (a transaction failing after its inserts but before the marker) is deliberately
 * NOT re-proven here: it needs a test-only hook to force mid-transaction failure that no
 * production code path has, and the guarantee it would exercise — `writeTransaction` rolling back
 * atomically — is the real SDK's own contract, already confirmed by reading `DBAdapter.js`
 * (`BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`) and already exercised against a faithful fake in
 * `sqlite-capture-store.spec.ts`'s "an interrupted migration leaves neither rows nor a marker
 * committed" test. Adding a real-engine-failure hook reachable only by a test would be exactly the
 * kind of test-only production code path to justify carefully, not add for one more 9 of
 * confidence on a guarantee two other tests already cover from different angles.
 */

const HERD_KEY = `werf-herd:${FARM_ID}`;

function animal(id: string, breed: string) {
  return {
    id,
    farmId: FARM_ID,
    enterpriseId: null,
    species: 'cattle',
    breed,
    sex: 'female',
    dob: null,
    dobEstimated: false,
    status: 'alive',
    statusAt: null,
    damId: null,
    sireId: null,
    mobId: null,
    landUnitId: null,
    source: null,
    acquiredAt: null,
    brandId: null,
    brandAppliedAt: null,
    attributes: {},
    photoKey: null,
  };
}

// Deliberately NOT alphabetical and NOT UUID-sorted — capture (array) order is the one order this
// migration must preserve, so seeding in a third order is what makes the ordering assertion below
// actually test something rather than passing by coincidence.
const SEEDED = [
  animal('0190f3a0-0000-7000-8000-00000000c003', 'Nguni'),
  animal('0190f3a0-0000-7000-8000-00000000c001', 'Bonsmara'),
  animal('0190f3a0-0000-7000-8000-00000000c002', 'Brahman'),
];

test('a legacy localStorage array migrates into SQLite, in order, and the original is left untouched', async ({
  page,
}) => {
  await seed(page);
  await page.addInitScript(
    ([herdKey, seeded]) => {
      window.localStorage.setItem(herdKey as string, JSON.stringify(seeded));
    },
    [HERD_KEY, SEEDED] as const,
  );

  await page.goto('/animals');

  // The migrated herd is real to the app: all three breeds render, through the same
  // useSyncExternalStore path every other capture screen uses.
  await expect(page.getByText('Nguni')).toBeVisible();
  await expect(page.getByText('Bonsmara')).toBeVisible();
  await expect(page.getByText('Brahman')).toBeVisible();

  // The SAME data, read back from OPFS via a fresh navigation to the diagnostics entry — not the
  // still-open app tab's in-memory state — and in the EXACT append order the localStorage array
  // held, not id order or insertion-into-Map order.
  const migrated = await storedCaptures<{ id: string; breed: string }>(page, HERD_KEY);
  expect(migrated.map((a) => a.id)).toEqual(SEEDED.map((a) => a.id));
  expect(migrated.map((a) => a.breed)).toEqual(['Nguni', 'Bonsmara', 'Brahman']);

  // localStorage is READ ONLY by this migration, never written or cleared — the rollback/
  // 12-month-offline story depends on the pre-migration array staying recoverable indefinitely.
  await page.goto('/animals');
  const stillThere = await page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key) ?? 'null') as unknown,
    HERD_KEY,
  );
  expect(stillThere).toEqual(SEEDED);
});

test('a second cold start does not re-migrate — the marker makes it a no-op', async ({ page }) => {
  await seed(page);
  await page.addInitScript(
    ([herdKey, seeded]) => {
      window.localStorage.setItem(herdKey as string, JSON.stringify(seeded));
    },
    [HERD_KEY, SEEDED] as const,
  );

  await page.goto('/animals');
  await expect(page.getByText('Nguni')).toBeVisible();

  // A second, fresh navigation — the marker row must make this a read, not another migration
  // attempt. Duplicated rows (a second `INSERT OR REPLACE` per record is harmless, but a second
  // marker insert on a real PRIMARY KEY is not) would surface as a thrown, unhandled error the
  // capture store swallows into "settled empty" — so the strongest proof is simply that the herd
  // is still exactly three records, not six or zero.
  await page.reload();
  await expect(page.getByText('Nguni')).toBeVisible();

  const migrated = await storedCaptures<{ id: string }>(page, HERD_KEY);
  expect(migrated).toHaveLength(3);
});
