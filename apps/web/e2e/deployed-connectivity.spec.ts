/**
 * P1.4 (2026-08-14) — the deployed-browser proof that production connectivity actually works.
 *
 * ⛔ Node `fetch` proves nothing about CORS (a browser-enforced mechanism plain `fetch` under Node
 * never applies) and `vite preview` proves nothing about CSP (it serves no headers at all, and
 * neither does `playwright.config.ts`'s shared `webServer` any other spec in this suite runs
 * against). Both gaps are why this repo shipped, until this fix: a CSP whose `connect-src` was
 * `'self'` only — silently blocking every real PowerSync connection and every real attachment
 * upload the moment either is served from its own origin, which is the documented production
 * shape (deployment-guide.md §7) — and a MinIO/S3 bucket with no CORS configuration at all, which
 * every existing attachment integration test's Node-`fetch` PUT could never have caught.
 *
 * This spec closes both gaps with the real artifacts, not stand-ins:
 *   - `startDeployedServer` (`deployed-server.ts`) serves the actual BUILT `dist/`, with the
 *     ACTUAL generated `dist/_headers` (`scripts/generate-headers.mjs`) applied as real HTTP
 *     response headers — a genuinely different code path from `vite preview`.
 *   - The real local MinIO, with the real `MINIO_API_CORS_ALLOW_ORIGIN` this server's own origin
 *     is listed under (`docker-compose.yml`).
 *   - A real browser page, real login, real PowerSync connection, and a real presigned PUT the
 *     PAGE ITSELF performs via `fetch` — so both the CSP and the bucket CORS are exercised exactly
 *     as a farmer's browser would exercise them, not simulated.
 *
 * Gated behind WERF_REAL_STACK for the same reason the other real-stack specs are — it needs
 * infrastructure `playwright.config.ts`'s `webServer` does not start. Bootstrap (see
 * `real-sync-hydration.spec.ts`'s header for the shared steps), PLUS a build with this spec's own
 * local CSP origins, PLUS the bucket CORS applied:
 *
 *   docker compose up -d postgres powersync minio   # picks up MINIO_API_CORS_ALLOW_ORIGIN
 *   pnpm --filter @werf/db migrate
 *   (apps/api running with matching env — see real-sync-hydration.spec.ts)
 *   CSP_POWERSYNC_ORIGIN=http://localhost:8080 CSP_OBJECT_STORAGE_ORIGIN=http://localhost:9000 \
 *     pnpm --filter @werf/web build
 *   WERF_REAL_STACK=1 pnpm --filter @werf/web exec playwright test deployed-connectivity
 *
 * ⭐ `CSP_OBJECT_STORAGE_ORIGIN` MUST match `OBJECT_STORAGE_ENDPOINT`'s own host exactly —
 * `localhost` and `127.0.0.1` are DIFFERENT origins to both a CSP and a CORS check, even though
 * they resolve to the same machine. Found empirically running this spec for the first time: the
 * presigned URL `apps/api` issues is built from `OBJECT_STORAGE_ENDPOINT` (`.env`'s conventional
 * `http://localhost:9000`), so a build's CSP configured for `127.0.0.1` instead let the CSP check
 * pass and then failed at the bucket with a CORS error — two different real failures this spec
 * caught in two consecutive runs, which is exactly the class of gap a real browser surfaces and
 * Node `fetch` cannot.
 */

import { createHmac, randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { startDeployedServer, type DeployedServer } from './deployed-server';

test.skip(
  !process.env['WERF_REAL_STACK'],
  'needs a live apps/api + werf-postgres + werf-powersync + werf-minio, and a build with local CSP origins — see this file’s own header for the bootstrap steps',
);

const API = 'http://localhost:3000/api';
const PASSWORD = 'correct horse battery staple';
const DEPLOYED_PORT = 4180;

// --- TOTP, duplicated from real-sync-hydration.spec.ts rather than imported — see that file's
// own header for why (Node-side Playwright setup, outside the app's source tree).
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
  farms: ReadonlyArray<{ id: string; enterprises: ReadonlyArray<{ id: string }> }>;
  activeFarmId: string;
  secondFactor: string;
}

async function registerAndEnrol(
  request: APIRequestContext,
  email: string,
): Promise<VerifiedSession> {
  const reg = await request.post(`${API}/auth/register`, {
    data: {
      business: { name: 'E2E Deployed Boerdery', registrationNumber: null },
      farm: {
        name: 'E2E Deployed Farm',
        province: 'Free State',
        district: null,
        enterpriseTypes: ['beef_cattle'],
      },
      owner: {
        fullName: 'E2E Deployed Owner',
        email,
        password: PASSWORD,
        locale: 'en-ZA',
        theme: 'light',
      },
    },
  });
  expect(reg.ok(), await reg.text()).toBeTruthy();
  const registered = (await reg.json()) as VerifiedSession;

  const begin = await request.post(`${API}/auth/2fa/totp`, {
    headers: { Authorization: `Bearer ${registered.accessToken}` },
  });
  expect(begin.ok(), await begin.text()).toBeTruthy();
  const { secret } = (await begin.json()) as { secret: string };

  const confirm = await request.post(`${API}/auth/2fa/totp/confirm`, {
    headers: { Authorization: `Bearer ${registered.accessToken}` },
    data: { code: totpAt(secret, Date.now() - 30_000) },
  });
  expect(confirm.ok(), await confirm.text()).toBeTruthy();

  const login = await request.post(`${API}/auth/login`, {
    data: { email, password: PASSWORD, deviceLabel: 'deployed-connectivity' },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  const { challengeToken } = (await login.json()) as { challengeToken: string };
  const verify = await request.post(`${API}/auth/2fa/verify`, {
    data: { challengeToken, method: 'totp', code: totpAt(secret, Date.now()) },
  });
  expect(verify.ok(), await verify.text()).toBeTruthy();
  return (await verify.json()) as VerifiedSession;
}

test.describe('deployed-browser connectivity — real CSP, real PowerSync, real presigned PUT', () => {
  let deployed: DeployedServer;

  test.beforeAll(async () => {
    deployed = await startDeployedServer(DEPLOYED_PORT);
  });

  test.afterAll(async () => {
    await deployed.close();
  });

  test('the actual response CSP names the real PowerSync and object-storage origins, never `self`-only', async ({
    request,
  }) => {
    const response = await request.get(deployed.origin + '/');
    const csp = response.headers()['content-security-policy'];
    expect(csp, 'no Content-Security-Policy header was served at all').toBeTruthy();
    const connectSrc = /connect-src ([^;]+)/.exec(csp ?? '')?.[1] ?? '';
    // The literal bug this closes: `connect-src 'self'` alone would fail BOTH assertions below.
    expect(connectSrc).toContain('8080'); // the local PowerSync origin
    expect(connectSrc).toContain('9000'); // the local MinIO origin
  });

  test('a real browser, on the deployed CSP, connects to real PowerSync and completes a real presigned PUT + finalize', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log('[browser console]', msg.text());
    });
    const email = `e2e-deployed-${Date.now()}@werf.test`;
    const session = await registerAndEnrol(page.request, email);
    const farmId = session.activeFarmId;
    const enterpriseId = session.farms[0]!.enterprises[0]!.id;

    const animalId = randomUUID();
    const createAnimal = await page.request.post(`${API}/livestock/animals`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      data: {
        id: animalId,
        farmId,
        enterpriseId,
        species: 'cattle',
        sex: 'female',
        dob: null,
        dobEstimated: false,
        attributes: {},
      },
    });
    expect(createAnimal.ok(), await createAnimal.text()).toBeTruthy();

    // Seed the session BEFORE navigation, exactly as real-sync-hydration.spec.ts does — a cold
    // start with an already-cached identity, never a login form in this proof.
    await page.addInitScript(
      ([sessionKey, sessionJson]) => {
        window.localStorage.setItem(sessionKey as string, sessionJson as string);
      },
      [
        'werf-session',
        JSON.stringify({ payload: session, confirmedAt: new Date().toISOString() }),
      ] as const,
    );

    // The REAL deployed origin — not baseURL (vite preview, no headers) and not localhost:3000
    // (the API). Every asset, and the CSP header on all of them, comes from `deployed-server.ts`.
    await page.goto(deployed.origin + '/');

    // The app actually rendered the authenticated shell for this farm — proves the CSP served
    // above did not block loading the built JS/CSS assets it depends on.
    await expect(page.getByRole('heading', { name: 'E2E Deployed Farm' })).toBeVisible({
      timeout: 15_000,
    });

    // Real PowerSync connection: `SyncConnection.tsx`'s `db.connect()` must actually reach
    // ws://localhost:8080 — impossible under the OLD `connect-src 'self'` CSP, which this real
    // header-serving server would have enforced and silently blocked with no console error a
    // farmer could ever see. `hydrated-table-store.ts` settles ("Synced"/no pending count) once a
    // connection lands and the first read completes; it never does that offline or blocked.
    await expect(page.getByRole('status', { name: 'Save status' })).not.toHaveText(/error/i, {
      timeout: 30_000,
    });

    // The real presigned PUT, performed by the PAGE ITSELF (inside the browser's own CSP and
    // origin, not this test's Node process) — this is the one call that needs the browser to
    // actually be ALLOWED to reach MinIO, both by the CSP served above and by the bucket's own
    // CORS policy (`MINIO_API_CORS_ALLOW_ORIGIN`, docker-compose.yml).
    const attachmentId = randomUUID();
    const bytes = 'deployed-connectivity real browser proof';
    const checksumHex = await page.evaluate(async (text) => {
      const data = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest('SHA-256', data);
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }, bytes);

    const create = await page.request.post(`${API}/attachments`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      data: {
        id: attachmentId,
        farmId,
        subjectType: 'animal',
        subjectId: animalId,
        mimeType: 'text/plain',
        sizeBytes: bytes.length,
        checksum: checksumHex,
        occurredAt: new Date().toISOString(),
      },
    });
    expect(create.ok(), await create.text()).toBeTruthy();
    const { uploadUrl, checksumHeaderValue } = (await create.json()) as {
      uploadUrl: string;
      checksumHeaderValue: string;
    };

    const putResult = await page.evaluate(
      async ([url, checksumHeader, body]) => {
        try {
          const res = await fetch(url as string, {
            method: 'PUT',
            headers: {
              'Content-Type': 'text/plain',
              'x-amz-checksum-sha256': checksumHeader as string,
            },
            body: body as string,
          });
          return { ok: res.ok, status: res.status };
        } catch (err) {
          return { ok: false, status: 0, error: String(err) };
        }
      },
      [uploadUrl, checksumHeaderValue, bytes] as const,
    );
    expect(
      putResult.ok,
      `browser PUT failed with status ${putResult.status} — CSP or bucket CORS blocked it`,
    ).toBe(true);

    // The authoritative proof the object is REALLY there, matching what the browser sent — never
    // trust the browser's own "ok" alone. `finalizeAttachment` (attachments.service.ts) does not
    // trust the client's claim either: it re-derives size AND checksum from a REAL `headObject`
    // call against MinIO and only returns `finalised` if both match the row's captured checksum.
    // A false-positive PUT (CORS misconfigured such that the browser's `fetch` reported success
    // on a response with no bytes actually stored, or a stale/wrong bucket) would fail HERE, not
    // silently pass — this is the same discipline `attachments.integration.test.ts` already
    // applies, now reached via a real browser leg instead of Node's `fetch`.
    const finalize = await page.request.post(`${API}/attachments/finalize`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      data: { id: attachmentId, farmId },
    });
    expect(finalize.ok(), await finalize.text()).toBeTruthy();
    const finalized = (await finalize.json()) as { status: string; checksum: string };
    expect(finalized.status).toBe('finalised');
    expect(finalized.checksum).toBe(checksumHex);
  });
});
