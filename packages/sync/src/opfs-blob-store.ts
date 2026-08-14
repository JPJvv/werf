/**
 * The one real `BlobStore` adapter (phase-checklists.md 3i(c)): the Origin Private File System,
 * the same durable-storage promise `local-database.ts`'s SQLite engine rests on, reached here
 * directly via `navigator.storage.getDirectory()` rather than through PowerSync — a blob is not a
 * SQL row, and OPFS's raw file API is a plain browser standard, not `@powersync/web`, so the
 * `no-restricted-imports` rule that confines that SDK to `local-database.ts` does not apply here.
 *
 * ⛔ Confirmed empirically, same as `local-database.ts`'s own header: `navigator.storage` does not
 * exist under plain Node/jsdom, so constructing this adapter throws immediately rather than
 * hanging — it is typechecked but never unit-tested; a real open belongs in Playwright
 * (`local-db-diagnostic.spec.ts`'s shape), which is where `opfs-blob-store.spec.ts`-equivalent
 * coverage for THIS file lives, not in the vitest/jsdom tier. Every other test uses
 * `testing.ts`'s `createInMemoryBlobStore` instead.
 *
 * One directory, `attachments/`, under the origin's private root — kept apart from wherever the
 * SQLite engine keeps its own files so neither can collide with the other's names.
 */

const DIRECTORY_NAME = 'attachments';

async function attachmentsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIRECTORY_NAME, { create: true });
}

export function createOpfsBlobStore(): import('./blob-store').BlobStore {
  return {
    async put(key, blob) {
      const dir = await attachmentsDir();
      const handle = await dir.getFileHandle(key, { create: true });
      const writable = await handle.createWritable();
      try {
        await writable.write(blob);
      } finally {
        await writable.close();
      }
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
