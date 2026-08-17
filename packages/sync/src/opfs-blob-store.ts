/**
 * The one real `BlobStore` adapter (phase-checklists.md 3i(c)): the Origin Private File System,
 * the same durable-storage promise `local-database.ts`'s SQLite engine rests on, reached here
 * directly via `navigator.storage.getDirectory()` rather than through PowerSync — a blob is not a
 * SQL row, and OPFS's raw file API is a plain browser standard, not `@powersync/web`, so the
 * `no-restricted-imports` rule that confines that SDK to `local-database.ts` does not apply here.
 *
 * ⛔ Confirmed empirically, same as `local-database.ts`'s own header: `navigator.storage` does not
 * exist under plain Node/jsdom, so calling `attachmentsDir()` throws immediately rather than
 * hanging — the OPFS calls themselves are typechecked but never unit-tested; a real open belongs
 * in Playwright (`local-db-diagnostic.spec.ts`'s shape), which is where `opfs-blob-store.spec.ts`-
 * equivalent coverage for THIS file's browser-facing half lives, not in the vitest/jsdom tier.
 * Every other test uses `testing.ts`'s `createInMemoryBlobStore` instead. `put()`'s RETRY behaviour
 * is the one part of this file with real unit coverage (`durable-retry.spec.ts`), because it was
 * deliberately extracted into a browser-API-free function for exactly that reason.
 *
 * One directory, `attachments/`, under the origin's private root — kept apart from wherever the
 * SQLite engine keeps its own files so neither can collide with the other's names.
 *
 * ⭐ Reviewer finding (2026-08-17, sixteenth session): `put()` used to let a real OPFS
 * `QuotaExceededError` propagate straight out — `useRecordAttachment` (`LocalAttachments.tsx`)
 * awaited it with no retry and `RecordPhotoScreen.tsx`'s save handler had no catch, so a photo
 * taken while the device's storage was full was silently lost: no metadata row was ever written
 * (it commits AFTER the blob, offline-sync.md §3.1's own ordering), so the capture never joined
 * the outbox and was never retried or surfaced to the farmer. `put()` now retries the whole
 * write sequence indefinitely via `retryDurably` (`durable-retry.ts`) — the same "never rejected,
 * never silently dropped" guarantee `sqlite-capture-store.ts`'s persistence coordinator already
 * gives the metadata half (P1.1) — so this failure class now behaves identically to that one:
 * slower under quota pressure, never lossy.
 */

import { retryDurably } from './durable-retry';
import { PERSIST_RETRY_INTERVAL_MS } from './sqlite-capture-store';

const DIRECTORY_NAME = 'attachments';

async function attachmentsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIRECTORY_NAME, { create: true });
}

export function createOpfsBlobStore(): import('./blob-store').BlobStore {
  return {
    async put(key, blob) {
      await retryDurably(async () => {
        const dir = await attachmentsDir();
        const handle = await dir.getFileHandle(key, { create: true });
        const writable = await handle.createWritable();
        try {
          await writable.write(blob);
        } finally {
          await writable.close();
        }
      }, PERSIST_RETRY_INTERVAL_MS);
    },

    async get(key) {
      const dir = await attachmentsDir();
      try {
        const handle = await dir.getFileHandle(key);
        return await handle.getFile();
      } catch (error) {
        // `NotFoundError` is the DOM name for "no such file" — the honest absence this port
        // documents, not a failure. Anything else (a genuinely corrupt handle) still throws.
        if (error instanceof DOMException && error.name === 'NotFoundError') return null;
        throw error;
      }
    },

    async delete(key) {
      const dir = await attachmentsDir();
      try {
        await dir.removeEntry(key);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError') return;
        throw error;
      }
    },
  };
}
