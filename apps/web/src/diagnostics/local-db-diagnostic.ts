import { uuidv7 } from '@werf/core';

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
 */

const RESULT_ELEMENT_ID = 'local-db-diagnostic-result';

async function run(): Promise<void> {
  const resultEl = document.getElementById(RESULT_ELEMENT_ID);
  if (!resultEl) {
    throw new Error(`#${RESULT_ELEMENT_ID} not found`);
  }

  try {
    const { createLocalDatabase } = await import('@werf/sync/local-database');
    const db = createLocalDatabase({ dbFilename: 'diagnostic.db' });
    await db.init();

    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode') ?? 'write';

    if (mode === 'write') {
      const id = uuidv7();
      await db.execute('INSERT INTO farms (id, name, jurisdiction) VALUES (?, ?, ?)', [
        id,
        'Diagnostic farm',
        'ZA',
      ]);
      resultEl.textContent = `ok:${id}`;
      resultEl.dataset.status = 'ok';
    } else {
      const id = params.get('id');
      const row = await db.get<{ name: string; jurisdiction: string }>(
        'SELECT name, jurisdiction FROM farms WHERE id = ?',
        [id],
      );
      resultEl.textContent = `ok:${row.name}:${row.jurisdiction}`;
      resultEl.dataset.status = 'ok';
    }
  } catch (error) {
    resultEl.textContent = `error:${error instanceof Error ? error.message : String(error)}`;
    resultEl.dataset.status = 'error';
  }
}

void run();
