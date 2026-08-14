/**
 * The offline matrix's O-3 row (`testing-strategy.md` §4), against the live stack:
 * "Offline 6 weeks → sync | All applied, `occurred_at` preserved, reports use `occurred_at`."
 *
 * Every other proof of this repo's occurred_at discipline is a unit/integration test against the
 * pure fold or a single Postgres instance — real, but never through the FULL chain a farmer's
 * six-weeks-late reconnect actually takes: a back-dated capture → REST → Postgres (does the row
 * really keep the date given, not the date it happened to arrive?) → PowerSync replication → a
 * SECOND device's local SQLite → that device's own fold (does the read side use occurred_at too,
 * or silently favour arrival order?). This is the one test in the repo that walks the whole chain.
 *
 * Same infrastructure and gating as `real-sync-hydration.spec.ts` — see that file's header for the
 * exact bootstrap steps (docker compose, migrations, apps/api env). "Device A" is a direct
 * authenticated REST call, the same mechanism `Outbox.tsx` uses once it flushes a queue that has
 * been sitting on the device for weeks; "Device B" is a fresh browser profile that has captured
 * nothing itself, so anything it shows can only have arrived via down-sync.
 */

import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

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

test.describe('offline matrix O-3 — six weeks offline, sync, occurred_at intact, against the live stack', () => {
  test("a back-dated capture keeps its OWN occurred_at through Postgres, replication, and a second device's fold", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const email = `e2e-o3-${Date.now()}@werf.test`;

    const reg = await page.request.post(`${API}/auth/register`, {
      data: {
        business: { name: 'E2E O-3 Boerdery', registrationNumber: null },
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

    const mobId = randomUUID();
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
    const oldestId = randomUUID();
    const oldest = await page.request.post(`${API}/livestock/mob-tallies`, {
      headers: { Authorization: `Bearer ${deviceA.accessToken}` },
      data: { id: oldestId, farmId, mobId, occurredAt: sixWeeksAgo, reason: 'birth', count: 40 },
    });
    expect(oldest.ok(), await oldest.text()).toBeTruthy();

    const newerId = randomUUID();
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
});
