import { uuidv7 } from '@werf/core';
import { createSyncConnector } from '@werf/sync';

/**
 * NOT part of the app. This is the browser-open proof STATUS.md's Phase 3 next-steps demanded
 * before spending any more time on 3b: `@journeyapps/wa-sqlite`'s postinstall 404'd during 3a's
 * install, and nothing in 3a ever called `createLocalDatabase` — so whether the static WASM core
 * actually opens OPFS in a real browser was an unverified claim, not a proven one.
 *
 * Reached only via the separate `diagnostics.html` Vite entry (see vite.config.ts), never linked
 * from the app shell or the router — a farmer never sees this page. Being a separate entry also
 * keeps it out of the index.html bundle, so it cannot regress NFR-009's 250KB budget the way
 * importing `@werf/sync/local-database` from application code would (3a's finding: the SDK's
 * WASM engine bundles in even when unused).
 *
 * Proves two things a schema-only unit test cannot, because 3a's own tests never call
 * `createLocalDatabase` (it hangs forever under Node — see local-database.ts):
 * 1. The real `PowerSyncDatabase` opens — OPFS + Worker + WASM all exist and cooperate.
 * 2. A write survives a reload — OPFS persistence, not an in-memory illusion of it.
 *
 * Run against the BUILT preview (`vite preview`), not `vite dev` — `@powersync/web`'s inline
 * module worker fails to init under `vite dev`'s transform pipeline; only a real build has a real
 * worker chunk. `mode=connect` additionally requires a real access token minted by a signed-in,
 * 2FA-enrolled session (`?accessToken=`) — dev-only, hand-supplied; never something this page
 * mints or stores itself.
 */

const RESULT_ELEMENT_ID = 'local-db-diagnostic-result';

async function run(): Promise<void> {
  const resultEl = document.getElementById(RESULT_ELEMENT_ID);
  if (!resultEl) {
    throw new Error(`#${RESULT_ELEMENT_ID} not found`);
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode') ?? 'write';

    const { createLocalDatabase } = await import('@werf/sync/local-database');
    const db = createLocalDatabase({
      // read-capture deliberately opens the REAL app's default filename ('werf.db', the
      // createLocalDatabase() default apps/web/src/sync/local-db.ts also uses with no override)
      // — the whole point is to read back what the app itself wrote to OPFS, not an isolated
      // diagnostic file. Every other mode stays on its own file so a diagnostic run never
      // contaminates real app state.
      dbFilename:
        mode === 'connect'
          ? 'diagnostic-connect.db'
          : mode === 'read-capture'
            ? 'werf.db'
            : 'diagnostic.db',
    });
    await db.init();

    if (mode === 'read-capture') {
      // phase-checklists.md 3c — reads capture_records back for one store_key, in append order,
      // the same query createSqliteCaptureStore's own hydration runs. Proves what actually landed
      // in OPFS after a real migration, from a fresh navigation — not the in-memory illusion a
      // page.evaluate() against the still-open app tab would be one step short of proving.
      const key = params.get('key');
      if (!key) throw new Error('mode=read-capture requires ?key=');
      const rows = await db.getAll<{ payload_json: string }>(
        'SELECT payload_json FROM capture_records WHERE store_key = ? ORDER BY seq ASC',
        [key],
      );
      resultEl.textContent = `ok:${JSON.stringify(rows.map((r) => JSON.parse(r.payload_json)))}`;
      resultEl.dataset.status = 'ok';
    } else if (mode === 'write') {
      const id = uuidv7();
      await db.execute('INSERT INTO farms (id, name, jurisdiction) VALUES (?, ?, ?)', [
        id,
        'Diagnostic farm',
        'ZA',
      ]);
      resultEl.textContent = `ok:${id}`;
      resultEl.dataset.status = 'ok';
    } else if (mode === 'read') {
      const id = params.get('id');
      const row = await db.get<{ name: string; jurisdiction: string }>(
        'SELECT name, jurisdiction FROM farms WHERE id = ?',
        [id],
      );
      resultEl.textContent = `ok:${row.name}:${row.jurisdiction}`;
      resultEl.dataset.status = 'ok';
    } else if (mode === 'connect') {
      // Phase 3 slice 4: the download half of .connect() (packages/sync/src/connector.ts).
      // Deliberately read-only — no local INSERT here, so the CRUD queue stays empty and
      // uploadData is never invoked (connector.ts's own header: that half has no route to a
      // domain endpoint yet). Proves a row seeded server-side reaches THIS device through the
      // real self-hosted service, for the right user — the empirical close on the two-hop
      // Sync Streams predicates task 3 validated at the service, now proven at the client.
      const accessToken = params.get('accessToken');
      if (!accessToken) throw new Error('mode=connect requires ?accessToken=');

      const connector = createSyncConnector({
        apiBaseUrl: params.get('apiBase') ?? '/api',
        getAccessToken: async () => accessToken,
      });
      await db.connect(connector);
      await db.waitForFirstSync();

      const rows = await db.getAll<{ id: string; name: string }>(
        'SELECT id, name FROM farms ORDER BY name',
      );
      resultEl.textContent = `ok:${rows.length}:${rows.map((r) => r.name).join(',')}`;
      resultEl.dataset.status = 'ok';
    } else {
      throw new Error(`unknown mode "${mode}"`);
    }
  } catch (error) {
    resultEl.textContent = `error:${error instanceof Error ? error.message : String(error)}`;
    resultEl.dataset.status = 'error';
  }
}

void run();
