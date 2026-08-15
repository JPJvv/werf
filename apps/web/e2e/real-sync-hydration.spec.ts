/**
 * Real-service proof for phase-checklists.md 3e (tripwire issue #8): the two-device mob-tally
 * journey against a REAL self-hosted PowerSync service and REAL Postgres — not the fakes
 * `Outbox.test.tsx`'s `tripwire 3e` suite and `hydrated-table-store.spec.ts` use to pin timing
 * and failure branches. Those already prove the STORE LOGIC; this proves the WIRING: that
 * `HydratedLivestock.tsx`'s hand-written SQL actually runs against PowerSync-replicated SQLite,
 * that `SyncConnection.tsx` actually authenticates and connects, and that a row born on one
 * device is readable — correctly, once, farm-scoped — on another that never captured it.
 *
 * Gated behind WERF_REAL_STACK because it needs infrastructure `playwright.config.ts`'s
 * `webServer` does not start. `pnpm real-stack:up` creates an ignored local environment, starts
 * Docker, applies migrations and provisions the RLS-bound API role; then run apps/api in another
 * shell. The bootstrap derives PowerSync's public JWK from the ignored private key, so restarting
 * the API never depends on secrets surviving in an earlier shell. Run manually:
 *
 *   pnpm real-stack:up
 *   pnpm --filter @werf/api dev
 *   WERF_REAL_STACK=1 pnpm --filter @werf/web exec playwright test real-sync-hydration
 *
 * "Device A" is a direct authenticated REST call — that IS the mechanism `Outbox.tsx` uses to
 * land a capture, so a second browser context would only add OPFS/WASM weight without
 * exercising a different code path. "Device B" is the one browser context under test, with its
 * own login (own session id) and a storage profile that has never heard of the mob or the tally
 * device A lands — so anything it learns about either can only have arrived via down-sync.
 *
 * Both devices are the SAME account. CLAUDE.md's own words: "two offline devices is the normal
 * case here, not the edge case" — a farmer's phone and tablet, not two different farmers.
 */

import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { uuidv7 } from '@werf/core';

test.skip(
  !process.env['WERF_REAL_STACK'],
  'needs a live apps/api + werf-postgres + werf-powersync — see phase-checklists.md 3e for the bootstrap steps',
);

const API = 'http://localhost:3000/api';
const PASSWORD = 'correct horse battery staple';

// --- TOTP (RFC 6238 over RFC 4226) --------------------------------------------------------
// Mirrors apps/api/src/auth/totp.ts's documented, RFC-pinned parameters (30s/6-digit/SHA-1)
// exactly. Duplicated rather than imported: this file is Node-side Playwright setup, outside
// the app's own source tree, and totp.ts itself is tested against the RFC's published vectors.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(encoded: string): Buffer {
  const clean = encoded.replace(/[=\s]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totpAt(secret: string, atMs: number): string {
  const counter = Math.floor(atMs / 1000 / 30);
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBytes.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac('sha1', base32Decode(secret)).update(counterBytes).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** 6).padStart(6, '0');
}

interface VerifiedSession {
  accessToken: string;
  expiresIn: number;
  user: Record<string, unknown>;
  farms: readonly Record<string, unknown>[];
  activeFarmId: string;
  secondFactor: string;
}

/** How many rows in the REAL Postgres carry this exact reason/count for this mob — the
 *  server-side half of the proof, so a UI that lies about "sent" cannot pass this test. */
function countRealDeathEvents(mobId: string, count: number): number {
  const sql = `SELECT count(*) FROM events WHERE mob_id = '${mobId}' AND type = 'tally' AND payload->>'reason' = 'death' AND (payload->>'delta')::int = ${-count} AND deleted_at IS NULL;`;
  const out = execFileSync(
    'docker',
    ['exec', 'werf-postgres', 'psql', '-U', 'werf', '-d', 'werf', '-tA', '-c', sql],
    { encoding: 'utf8' },
  );
  return Number(out.trim());
}

test.describe('real down-sync hydration — tripwire 3e / issue #8, against the live stack', () => {
  test('Device B hydrates a tally Device A landed via REST, and sends a decrease it funds — held forever no longer', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const email = `e2e-3e-${Date.now()}@werf.test`;

    // --- Register + enrol TOTP. Routed through `page.request` (not a bare Node fetch) so any
    // Set-Cookie these calls receive lands in the SAME cookie jar the page itself later reads
    // from for `authApi.refresh()` after reload — cookies are host-scoped, not port-scoped, so
    // this applies equally whether the call goes straight to :3000 or through the :4173 proxy.
    const reg = await page.request.post(`${API}/auth/register`, {
      data: {
        business: { name: 'E2E 3e Boerdery', registrationNumber: null },
        farm: {
          name: 'E2E 3e Farm',
          province: 'Free State',
          district: null,
          enterpriseTypes: ['beef_cattle'],
        },
        owner: {
          fullName: 'E2E 3e Owner',
          email,
          password: PASSWORD,
          locale: 'en-ZA',
          theme: 'light',
        },
      },
    });
    expect(reg.ok(), await reg.text()).toBeTruthy();
    const registered = (await reg.json()) as VerifiedSession & { activeFarmId: string };
    const farmId = registered.activeFarmId;
    const farms = registered.farms as ReadonlyArray<{
      enterprises: ReadonlyArray<{ id: string }>;
    }>;
    const enterpriseId = farms[0]!.enterprises[0]!.id;

    const begin = await page.request.post(`${API}/auth/2fa/totp`, {
      headers: { Authorization: `Bearer ${registered.accessToken}` },
    });
    expect(begin.ok(), await begin.text()).toBeTruthy();
    const { secret } = (await begin.json()) as { secret: string };

    // Confirms with the PREVIOUS step's code, still inside the drift window — the same reason
    // two-factor.integration.test.ts's own `enrolledOwner` helper does this: confirming spends
    // that step, so logging in with the SAME code a moment later is exactly what the replay
    // guard (by design) refuses.
    const confirm = await page.request.post(`${API}/auth/2fa/totp/confirm`, {
      headers: { Authorization: `Bearer ${registered.accessToken}` },
      data: { code: totpAt(secret, Date.now() - 30_000) },
    });
    expect(confirm.ok(), await confirm.text()).toBeTruthy();
    const { recoveryCodes } = (await confirm.json()) as { recoveryCodes: string[] };

    const loginAs = async (
      deviceLabel: string,
      code: { method: 'totp' | 'recovery_code'; value: string },
    ): Promise<VerifiedSession> => {
      const login = await page.request.post(`${API}/auth/login`, {
        data: { email, password: PASSWORD, deviceLabel },
      });
      expect(login.ok(), await login.text()).toBeTruthy();
      const { challengeToken } = (await login.json()) as { challengeToken: string };
      const verify = await page.request.post(`${API}/auth/2fa/verify`, {
        data: { challengeToken, method: code.method, code: code.value },
      });
      expect(verify.ok(), await verify.text()).toBeTruthy();
      return (await verify.json()) as VerifiedSession;
    };

    // --- Device A: lands a mob and a birth tally via direct REST, exactly as its own Outbox
    // would once it flushes.
    const deviceA = await loginAs('device-a', {
      method: 'totp',
      value: totpAt(secret, Date.now()),
    });
    // Random per run, never a fixed literal: `recordMob` is idempotent on `mobs.id` (an
    // `onConflictDoNothing` falling back to a farm-scoped re-select), so a repeated run reusing a
    // hardcoded id would silently resolve to a PREVIOUS run's row — scoped to that OLDER farm —
    // and the tally below would then, correctly, refuse to find "this" mob under the CURRENT
    // farm. Found empirically: a fixed id passed on the first attempt, then failed identically on
    // every rerun with "Mob not found" despite the create call itself reporting success.
    const mobId = uuidv7();
    const createMob = await page.request.post(`${API}/livestock/mobs`, {
      headers: { Authorization: `Bearer ${deviceA.accessToken}` },
      data: {
        id: mobId,
        farmId,
        enterpriseId,
        name: 'Tripwire 3e Mob',
        species: 'cattle',
        landUnitId: null,
        headCount: 300,
        initialHeadCount: 300,
      },
    });
    expect(createMob.ok(), await createMob.text()).toBeTruthy();

    const birthId = uuidv7();
    const birth = await page.request.post(`${API}/livestock/mob-tallies`, {
      headers: { Authorization: `Bearer ${deviceA.accessToken}` },
      data: {
        id: birthId,
        farmId,
        mobId,
        occurredAt: new Date().toISOString(),
        reason: 'birth',
        count: 40,
      },
    });
    expect(birth.ok(), await birth.text()).toBeTruthy();

    // --- Device B: a second login (its own session id), and a browser profile that has never
    // heard of the mob or the tally above. A RECOVERY CODE, not a second TOTP code: two logins
    // close enough together land in the SAME 30-second TOTP step, so a second `totpAt(secret,
    // Date.now())` call reproduces the exact digits `confirm` already spent — the single-use
    // replay guard (by design) then refuses it as a reused code, not as a wrong one. A real
    // farmer's phone and tablet, opened seconds apart, would see the identical clash; a
    // recovery code is the escape FR-014a exists for, and it sidesteps the timing entirely.
    const deviceB = await loginAs('device-b', {
      method: 'recovery_code',
      value: recoveryCodes[0]!,
    });

    await page.addInitScript(
      ([sessionKey, sessionJson]) => {
        window.localStorage.setItem(sessionKey as string, sessionJson as string);
      },
      [
        'werf-session',
        JSON.stringify({ payload: deviceB, confirmedAt: new Date().toISOString() }),
      ] as const,
    );

    await page.goto('/animals/groups/count');

    // Real down-sync: PowerSync must replicate the mob AND the birth tally from Postgres into
    // THIS device's local SQLite before either can show up here — nothing seeded that locally.
    const mobButton = page.getByRole('button', { name: /Tripwire 3e Mob/ });
    await expect(mobButton).toBeVisible({ timeout: 30_000 });
    // ⭐ test 1/2/7 of the required matrix: 340, not 300 — the hydrated birth is folded into the
    // baseline this device never captured, and not double-counted against a local copy that
    // does not exist here.
    await expect(mobButton).toContainText('340');

    await mobButton.click();
    await page.getByRole('button', { name: 'Died', exact: true }).click();
    // ⭐⭐ The decrease this whole slice exists for: 320 exceeds the mob's OWN baseline (300)
    // and is fundable only once the hydrated birth is recognised — issue #8's exact shape.
    await page.getByLabel('How many').fill('320');
    // `mobButton`'s 340 (above) proves ONLY that the `mobs` row hydrated — its own `head_count`
    // column is already server-computed, so it says nothing about the SEPARATE `events` bucket
    // the birth tally rides on. That one has its own checkpoint/round trip, so this assertion
    // gets its own generous timeout rather than inheriting the default 5s: `headAsAt` is
    // reactive (a `useMemo` over `hydratedTallies`), so once the tally bucket lands this
    // re-renders and corrects on its own — no re-fill needed, only patience.
    await expect(page.getByText('340 → 20')).toBeVisible({ timeout: 20_000 });

    const saveButton = page.getByRole('button', { name: 'Save', exact: true });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(page.getByRole('status').filter({ hasText: 'Tripwire 3e Mob' })).toBeVisible();

    // ⭐ The tripwire itself: `landed()` must recognise the hydrated birth as sent, so the
    // decrease is not held waiting for a sentLog entry that will never exist on THIS device —
    // the strip settles on "Saved and sent" rather than "N to send" / "M need your attention".
    await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('⌁Saved and sent', {
      timeout: 15_000,
    });

    // Server-side half of the proof: exactly one death of 320 actually landed in Postgres.
    await expect
      .poll(() => countRealDeathEvents(mobId, 320), { timeout: 15_000, intervals: [500] })
      .toBe(1);

    // --- Test 10 of the required matrix: a full browser reload preserves both the read
    // projection and the (by now empty) queue — real OPFS persistence, which no fake can cover.
    await page.reload();
    const reloadedMobButton = page.getByRole('button', { name: /Tripwire 3e Mob/ });
    await expect(reloadedMobButton).toBeVisible({ timeout: 30_000 });
    await expect(reloadedMobButton).toContainText('20');
    await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('⌁Saved and sent', {
      timeout: 15_000,
    });

    // Still exactly one — a reload must not have replayed the capture.
    expect(countRealDeathEvents(mobId, 320)).toBe(1);
  });
});
