import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { getCurrentFakeLocalDatabase, resetFakeLocalDatabase } from './test-support/local-db';
import { getCurrentFakeBlobStore, resetFakeBlobStore } from './test-support/blob-store';

// Unmount rendered React trees after every test. Without this, DOM accumulates
// across tests in a file and getByRole/getByText fail with "multiple elements".
afterEach(() => {
  cleanup();
});

// Every one of the 12 capture-store providers (LocalTallies, LocalHerd, ...) reaches the local
// database through this one seam — apps/web/src/sync/local-db.ts's getLocalDatabase() — and a
// component test that renders <App/> (directly or via a screen that mounts every provider)
// touches all of them, whether or not that test cares about captures. Mocked globally rather
// than per-file so every such test gets a fake instead of trying to open a real
// PowerSyncDatabase, which local-database.ts's own header documents as hanging forever under
// plain Node and which is unreliable under jsdom past a single render (a real open belongs in
// Playwright — apps/web/e2e/capture-migration.spec.ts). `getCurrentFakeLocalDatabase`/
// `resetFakeLocalDatabase` live in test-support/local-db.ts so an individual test file can also
// import `getCurrentFakeLocalDatabase` (via `storedCaptures`) to read back what a screen
// persisted, without importing this whole setup file.
vi.mock('./sync/local-db', () => ({
  getLocalDatabase: getCurrentFakeLocalDatabase,
}));

// Same reasoning as the SQLite mock above, for the OPFS-backed half of an attachment
// (phase-checklists.md 3i(c)): jsdom has no OPFS, and `LocalAttachmentsProvider` mounts on every
// <App/> render regardless of whether a test touches attachments.
vi.mock('./attachments/blob-store', () => ({
  getBlobStore: getCurrentFakeBlobStore,
}));

beforeEach(() => {
  resetFakeLocalDatabase();
  resetFakeBlobStore();
});

// jsdom's Blob/File implementation has no `arrayBuffer()` (real browsers, including every one
// this product targets, have had it for years) — `LocalAttachments.tsx`'s `sha256Hex` calls it to
// checksum a photo at capture. `FileReader` IS implemented in jsdom, so the polyfill reads through
// that rather than reimplementing anything — same "patch the environment gap, not the code"
// discipline as the `matchMedia` stub below.
if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
      reader.readAsArrayBuffer(this);
    });
  };
}

// jsdom does not implement matchMedia. The theme code guards its absence, but a
// stub lets "Match my phone" (system) paths run in tests. Defaults to light.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
