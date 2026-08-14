/**
 * The shared fake `BlobStore` `test-setup.ts`'s global `vi.mock` of `apps/web/src/attachments/
 * blob-store.ts` installs — the OPFS analogue of `local-db.ts`'s
 * `getCurrentFakeLocalDatabase`/`resetFakeLocalDatabase`, and for the same reason: jsdom has no
 * OPFS, and every test that renders `<App/>` mounts `LocalAttachmentsProvider` whether or not it
 * cares about attachments.
 */

import { createInMemoryBlobStore, type FakeBlobStore } from '@werf/sync/testing';

let current: FakeBlobStore | null = null;

/** The fake blob store for the CURRENT test — memoized within one test/render, mirroring the real
 *  `getBlobStore()` singleton's "same instance across every provider" contract, so a farm-switch
 *  re-render and a fresh component tree in the same test still share one store, exactly as they
 *  would share one real OPFS directory. Reset to a fresh instance before every test by
 *  `resetFakeBlobStore`. */
export function getCurrentFakeBlobStore(): FakeBlobStore {
  current ??= createInMemoryBlobStore();
  return current;
}

/** Fresh fake for the next test — never carries a blob across tests. */
export function resetFakeBlobStore(): void {
  current = null;
}
