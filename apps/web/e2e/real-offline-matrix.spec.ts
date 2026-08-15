/**
 * The offline matrix's O-3 row (`testing-strategy.md` §4), against the live stack:
 * "Offline 6 weeks → sync | All applied, `occurred_at` preserved, reports use `occurred_at`."
 *
 * Two tests, proving two different halves of the claim:
 *
 * 1. "a back-dated capture keeps its OWN occurred_at..." — direct authenticated REST for both
 *    devices, the same mechanism `Outbox.tsx` uses once it flushes a queue that has been sitting
 *    on a device for weeks. Fast, and the load-bearing proof that occurred_at survives Postgres +
 *    replication + a second device's fold intact — every other proof of this repo's occurred_at
 *    discipline is a unit/integration test against the pure fold or a single Postgres instance,
 *    never the full chain. What it does NOT prove: that a REAL offline capture — through the
 *    actual UI, network truly off, surviving a real reload — ever reaches that REST call at all.
 *
 * 2. "a real UI capture, offline, survives a reload, and reaches a genuinely separate second
 *    browser..." (P2.8) — closes exactly that gap. Device A captures through the real capture
 *    screens with `context.setOffline(true)`, reloads on a deep route while still offline (real
 *    OPFS persistence, real service-worker-served shell — no fake can cover either), reconnects,
 *    and the real `Outbox.tsx` flush sends it. Device B is a genuinely SEPARATE
 *    `browser.newContext()` (not the same context reused, which test 1's own "Device B" is,
 *    since a REST-authenticated `page.request` needs no browser identity of its own) — it
 *    authenticates independently and can only have learned what it shows through real PowerSync
 *    replication. Slower, and a different, more expensive kind of evidence: it proves the CHAIN
 *    (offline capture → reconnect → flush → second device) actually holds together end to end,
 *    not only that occurred_at is correct once each link is exercised separately elsewhere.
 *
 * Same infrastructure and gating as `real-sync-hydration.spec.ts` — see that file's header for the
 * exact bootstrap steps (docker compose, migrations, apps/api env). Both devices in both tests are
 * the SAME account — CLAUDE.md's own words: "two offline devices is the normal case here, not the
 * edge case" — a farmer's phone and tablet, not two different farmers.
 */

import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { uuidv7 } from '@werf/core';

test.skip(
  !process.env['WERF_REAL_STACK'],
  'needs a live apps/api + werf-postgres + werf-powersync — see real-sync-hydration.spec.ts for the bootstrap steps',
);

const API = 'http://localhost:3000/api';
const PASSWORD = 'correct horse battery staple';

// --- TOTP (RFC 6238 over RFC 4226) — duplicated from real-sync-hydration.spec.ts rather than
// imported: this file is Node-side Playwright setup, outside the app's own source tree, and
// totp.ts itself is tested against the RFC's published vectors elsewhere.
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

/** The REAL Postgres row's own `occurred_at`, read directly — the server-side half of the proof,
 *  so a client fold that merely happens to look right cannot pass this on a corrupted column. */
function realOccurredAt(tallyId: string): string | null {
  const sql = `SELECT occurred_at FROM events WHERE id = '${tallyId}';`;
  const out = execFileSync(
    'docker',
    ['exec', 'werf-postgres', 'psql', '-U', 'werf', '-d', 'werf', '-tA', '-c', sql],
    { encoding: 'utf8' },
  );
  const row = out.trim();
  return row === '' ? null : row;
}

/** The occurred_at of a mob's tally matching this reason/delta — same query shape as
 *  `real-sync-hydration.spec.ts`'s `countRealDeathEvents`, reading occurred_at instead of a count. */
function realTallyOccurredAt(mobId: string, reason: string, delta: number): string | null {
  const sql =
    `SELECT occurred_at FROM events WHERE mob_id = '${mobId}' AND type = 'tally' ` +
    `AND payload->>'reason' = '${reason}' AND (payload->>'delta')::int = ${delta} ` +
    `AND deleted_at IS NULL;`;
  const out = execFileSync(
    'docker',
    ['exec', 'werf-postgres', 'psql', '-U', 'werf', '-d', 'werf', '-tA', '-c', sql],
    { encoding: 'utf8' },
  );
  const row = out.trim();
  return row === '' ? null : row;
}

/** The mob's own server-computed `head_count` — the denormalised value `recordMobTally` updates,
 *  read directly so device B's projection can be checked against ground truth, not just itself. */
function realMobHeadCount(mobId: string): number | null {
  const sql = `SELECT head_count FROM mobs WHERE id = '${mobId}';`;
  const out = execFileSync(
    'docker',
    ['exec', 'werf-postgres', 'psql', '-U', 'werf', '-d', 'werf', '-tA', '-c', sql],
    { encoding: 'utf8' },
  );
  const row = out.trim();
  return row === '' ? null : Number(row);
}

test.describe('offline matrix O-3 — six weeks offline, sync, occurred_at intact, against the live stack', () => {
  test("a back-dated capture keeps its OWN occurred_at through Postgres, replication, and a second device's fold", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const email = `e2e-o3-${Date.now()}@werf.test`;

    const reg = await page.request.post(`${API}/auth/register`, {
      data: {
        business: {
          name: 'E2E O-3 Boerdery',
          registrationNumber: null,
          contact: { email: 'e2e-o3@example.test', phone: null },
          physicalAddress: {
            line1: 'E2E O-3 Plaas',
            line2: null,
            locality: 'Bothaville',
            province: 'Free State',
            postalCode: '9660',
          },
        },
        farm: {
          name: 'E2E O-3 Farm',
          province: 'Free State',
          district: null,
          enterpriseTypes: ['beef_cattle'],
        },
        owner: {
          fullName: 'E2E O-3 Owner',
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

    const begin = await page.request.post(`${API}/auth/2fa/totp`, {
      headers: { Authorization: `Bearer ${registered.accessToken}` },
    });
    expect(begin.ok(), await begin.text()).toBeTruthy();
    const { secret } = (await begin.json()) as { secret: string };

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

    // --- Device A: the phone that was in a dead zone. Its Outbox commits captures locally the
    // moment they happen and only reaches the server once a signal returns weeks later — the
    // capture below is stamped with the day it ACTUALLY happened, not the day this test runs.
    const deviceA = await loginAs('device-a', {
      method: 'totp',
      value: totpAt(secret, Date.now()),
    });

    const mobId = uuidv7();
    const createMob = await page.request.post(`${API}/livestock/mobs`, {
      headers: { Authorization: `Bearer ${deviceA.accessToken}` },
      data: {
        id: mobId,
        farmId,
        name: 'O-3 Mob',
        species: 'cattle',
        landUnitId: null,
        headCount: 300,
        initialHeadCount: 300,
      },
    });
    expect(createMob.ok(), await createMob.text()).toBeTruthy();

    const sixWeeksAgo = new Date(Date.now() - 42 * 86_400_000).toISOString();
    const fiveWeeksAgo = new Date(Date.now() - 35 * 86_400_000).toISOString();

    // Two births, submitted in the SAME REST call order they are written here — chronological —
    // but the point this test exists to make does not depend on that: `(occurred_at, id)` decides
    // the fold regardless of arrival order (the promoted rule this repo keeps re-deriving), so a
    // corrupted occurred_at (silently replaced by "now" or by insertion order) is the only way
    // this test could fail. Two captures, not one, so a wrong total is possible to see at all —
    // a single capture landing under the wrong date is invisible to a head-count assertion alone.
    const oldestId = uuidv7();
    const oldest = await page.request.post(`${API}/livestock/mob-tallies`, {
      headers: { Authorization: `Bearer ${deviceA.accessToken}` },
      data: { id: oldestId, farmId, mobId, occurredAt: sixWeeksAgo, reason: 'birth', count: 40 },
    });
    expect(oldest.ok(), await oldest.text()).toBeTruthy();

    const newerId = uuidv7();
    const newer = await page.request.post(`${API}/livestock/mob-tallies`, {
      headers: { Authorization: `Bearer ${deviceA.accessToken}` },
      data: { id: newerId, farmId, mobId, occurredAt: fiveWeeksAgo, reason: 'birth', count: 10 },
    });
    expect(newer.ok(), await newer.text()).toBeTruthy();

    // --- Server-side half of the proof, BEFORE any client reads it: the row Postgres actually
    // holds carries the SAME occurred_at this test sent, not the moment the REST call landed.
    // Postgres prints timestamptz in its own canonical form; comparing parsed Date values (not
    // strings) makes this robust to that formatting difference.
    const storedOldest = realOccurredAt(oldestId);
    const storedNewer = realOccurredAt(newerId);
    expect(storedOldest).not.toBeNull();
    expect(storedNewer).not.toBeNull();
    expect(new Date(storedOldest!).getTime()).toBe(new Date(sixWeeksAgo).getTime());
    expect(new Date(storedNewer!).getTime()).toBe(new Date(fiveWeeksAgo).getTime());

    // --- Device B: a second login, a browser profile that has captured NOTHING itself. Anything
    // it shows below can only have arrived through real PowerSync replication.
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

    // The client-side half: BOTH back-dated births fold into the baseline this device never
    // captured, at whatever order PowerSync happened to replicate and hydrate them — 300 + 40 +
    // 10 = 350. If either capture's occurred_at were corrupted (or the fold used arrival order
    // instead), a real but differently-shaped bug could still coincidentally reach 350 with two
    // deltas of the right total magnitude, which is why the server-side occurred_at assertions
    // above are the load-bearing half of this proof and this is the corroborating half — a
    // report reading the SAME projection this screen shows would see the identical number.
    const mobButton = page.getByRole('button', { name: /O-3 Mob/ });
    await expect(mobButton).toBeVisible({ timeout: 30_000 });
    await expect(mobButton).toContainText('350');
  });

  test('a real UI capture, offline, survives a reload, and reaches a genuinely separate second browser (P2.8)', async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(120_000);
    const email = `e2e-o3b-${Date.now()}@werf.test`;

    const reg = await page.request.post(`${API}/auth/register`, {
      data: {
        business: {
          name: 'E2E O-3b Boerdery',
          registrationNumber: null,
          contact: { email: 'e2e-o3b@example.test', phone: null },
          physicalAddress: {
            line1: 'E2E O-3b Plaas',
            line2: null,
            locality: 'Bothaville',
            province: 'Free State',
            postalCode: '9660',
          },
        },
        farm: {
          name: 'E2E O-3b Farm',
          province: 'Free State',
          district: null,
          enterpriseTypes: ['beef_cattle'],
        },
        owner: {
          fullName: 'E2E O-3b Owner',
          email,
          password: PASSWORD,
          locale: 'en-ZA',
          theme: 'light',
        },
      },
    });
    expect(reg.ok(), await reg.text()).toBeTruthy();
    const registered = (await reg.json()) as VerifiedSession;

    const begin = await page.request.post(`${API}/auth/2fa/totp`, {
      headers: { Authorization: `Bearer ${registered.accessToken}` },
    });
    expect(begin.ok(), await begin.text()).toBeTruthy();
    const { secret } = (await begin.json()) as { secret: string };

    const confirm = await page.request.post(`${API}/auth/2fa/totp/confirm`, {
      headers: { Authorization: `Bearer ${registered.accessToken}` },
      data: { code: totpAt(secret, Date.now() - 30_000) },
    });
    expect(confirm.ok(), await confirm.text()).toBeTruthy();
    const { recoveryCodes } = (await confirm.json()) as { recoveryCodes: string[] };

    const loginAs = async (
      onPage: typeof page,
      deviceLabel: string,
      code: { method: 'totp' | 'recovery_code'; value: string },
    ): Promise<VerifiedSession> => {
      const login = await onPage.request.post(`${API}/auth/login`, {
        data: { email, password: PASSWORD, deviceLabel },
      });
      expect(login.ok(), await login.text()).toBeTruthy();
      const { challengeToken } = (await login.json()) as { challengeToken: string };
      const verify = await onPage.request.post(`${API}/auth/2fa/verify`, {
        data: { challengeToken, method: code.method, code: code.value },
      });
      expect(verify.ok(), await verify.text()).toBeTruthy();
      return (await verify.json()) as VerifiedSession;
    };

    // --- Device A: its OWN login, seeded into the page BEFORE any navigation — this is the same
    // mechanism a real cold start uses (index.html reads werf-session synchronously), not a
    // shortcut this test invented.
    const deviceA = await loginAs(page, 'device-a', {
      method: 'totp',
      value: totpAt(secret, Date.now()),
    });
    await page.addInitScript(
      ([sessionKey, sessionJson]) => {
        window.localStorage.setItem(sessionKey as string, sessionJson as string);
      },
      [
        'werf-session',
        JSON.stringify({ payload: deviceA, confirmedAt: new Date().toISOString() }),
      ] as const,
    );
    await page.goto('/');

    // Wait for the service worker to take control — until it does, a reload still needs the
    // network and the step below would prove something weaker than it claims (offline-capture.
    // spec.ts's own reasoning, unchanged here).
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {
      timeout: 30_000,
    });

    // ── The radio goes off. Everything from here is what a farmer in a crush actually has. ──
    await context.setOffline(true);

    // Record a group (FR-102) — through the real screens, client-side navigation needing no
    // network at all.
    await page.getByRole('link', { name: /herd/i }).click();
    await page.getByRole('link', { name: /record a group/i }).click();
    await page.getByLabel(/what do you call this group/i).fill('O-3b Mob');
    await page.getByLabel(/how many head/i).fill('300');
    await page.getByRole('button', { name: /save group/i }).click();
    await expect(page.getByText(/saved — your work is saved/i)).toBeVisible();
    await page.getByRole('link', { name: /back to animals/i }).click();

    // A back-dated birth against it — a REAL farmer's day, picked through the actual date field,
    // not fabricated over REST like test 1's does. Six weeks, the exact O-3 row this file exists
    // to prove, captured this time through the real capture screen with the network off.
    const sixWeeksAgoDay = new Date(Date.now() - 42 * 86_400_000).toISOString().slice(0, 10);
    await page.getByRole('link', { name: /change a group.s numbers/i }).click();
    await page.getByRole('button', { name: /O-3b Mob/ }).click();
    await page.getByRole('button', { name: /^born$/i }).click();
    const dayField = page.getByLabel(/what day/i);
    await dayField.fill('');
    await dayField.fill(sixWeeksAgoDay);
    await page.getByLabel(/how many/i).fill('10');
    await page.getByRole('button', { name: /^save$/i }).click();

    // The strip says the thing that matters most in the product. Never "sync", never an apology.
    await expect(page.getByRole('status', { name: /save status/i })).toContainText(
      /offline — your work is saved/i,
    );

    // ── The cold start: closed and reopened, still with no signal. Reloaded on the CAPTURE
    // route, not on "/" — a farmer closes the app where they were working, so the service worker
    // has to serve THIS deep route from its precached shell, and the mob picker has to show the
    // BOTH the mob and the tally the moment it re-mounts, read back from real OPFS. ──
    await page.reload();
    const mobButtonOffline = page.getByRole('button', { name: /O-3b Mob/ });
    await expect(mobButtonOffline).toBeVisible({ timeout: 15_000 });
    await expect(mobButtonOffline).toContainText('310');
    await expect(page.getByRole('status', { name: /save status/i })).toContainText(
      /offline — your work is saved/i,
    );

    // ── The signal comes back. The REAL Outbox flush, against the REAL live apps/api — no
    // route mocking anywhere in this test, unlike offline-capture.spec.ts's mocked-API lane. ──
    await context.setOffline(false);
    await expect(page.getByRole('status', { name: /save status/i })).toContainText(
      /saved and sent/i,
      { timeout: 20_000 },
    );

    // --- Server-side half of the proof, BEFORE device B ever reads anything: the row Postgres
    // actually holds carries the SAME day this test picked through the date field, and the mob's
    // own server-computed head_count already reflects it. Looked up by NAME rather than carrying
    // the client-generated id out of the page: the mob's own uuidv7 is minted inside the capture
    // screen and never surfaced to this test, and the name is unique enough for one e2e run.
    const mobRow = execFileSync(
      'docker',
      [
        'exec',
        'werf-postgres',
        'psql',
        '-U',
        'werf',
        '-d',
        'werf',
        '-tA',
        '-c',
        `SELECT id FROM mobs WHERE name = 'O-3b Mob' AND deleted_at IS NULL;`,
      ],
      { encoding: 'utf8' },
    ).trim();
    expect(mobRow).not.toBe('');
    const realMobId = mobRow;

    const storedBirth = realTallyOccurredAt(realMobId, 'birth', 10);
    expect(storedBirth).not.toBeNull();
    expect(new Date(storedBirth!).getTime()).toBe(
      new Date(`${sixWeeksAgoDay}T12:00:00.000Z`).getTime(),
    );
    expect(realMobHeadCount(realMobId)).toBe(310);

    // --- Device B: a GENUINELY SEPARATE browser context — its own storage partition, its own
    // OPFS, its own service worker registration — not `page` reused with a fresh session
    // swapped in. It never captured anything: anything it shows below arrived purely through
    // real PowerSync replication from the row just confirmed in Postgres above.
    const deviceBContext = await browser.newContext();
    const deviceBPage = await deviceBContext.newPage();
    try {
      const deviceB = await loginAs(deviceBPage, 'device-b', {
        method: 'recovery_code',
        value: recoveryCodes[0]!,
      });
      await deviceBPage.addInitScript(
        ([sessionKey, sessionJson]) => {
          window.localStorage.setItem(sessionKey as string, sessionJson as string);
        },
        [
          'werf-session',
          JSON.stringify({ payload: deviceB, confirmedAt: new Date().toISOString() }),
        ] as const,
      );
      await deviceBPage.goto('/animals/groups/count');

      const mobButtonHydrated = deviceBPage.getByRole('button', { name: /O-3b Mob/ });
      await expect(mobButtonHydrated).toBeVisible({ timeout: 30_000 });
      await expect(mobButtonHydrated).toContainText('310');
    } finally {
      await deviceBContext.close();
    }
  });
});
