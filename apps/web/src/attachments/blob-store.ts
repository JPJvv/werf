/**
 * The one shared OPFS-backed blob store the app opens (phase-checklists.md 3i(c)) — the same
 * module-level-singleton shape as `sync/local-db.ts`'s `getLocalDatabase`, and the seam a test
 * mocks instead of `LocalAttachments.tsx` calling `createOpfsBlobStore` directly (mirroring how
 * every capture-store provider reaches SQLite through `getLocalDatabase()` rather than
 * `createLocalDatabase` itself, so `test-setup.ts` has one place to install a fake).
 */

import { createOpfsBlobStore, type BlobStore } from '@werf/sync';

let store: BlobStore | null = null;

/** Opens the shared OPFS blob store on first call; every later call returns the same instance. */
export function getBlobStore(): BlobStore {
  store ??= createOpfsBlobStore();
  return store;
}
