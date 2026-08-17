/**
 * The port a queued binary is read and written through (phase-checklists.md 3i(c)) — an animal
 * photo today, later crop/grievance documents. Deliberately separate from `CaptureStore<T>`: that
 * store's backing table (`capture_records`) is JSON-payload only (`sqlite-capture-store.ts` writes
 * `payload_json` as `TEXT`), so a `Blob` has nowhere to live in it. This mirrors
 * `apps/api/src/attachments/object-storage.ts`'s `ObjectStorage` port/adapter split — a narrow
 * surface, one real adapter (`opfs-blob-store.ts`), no degraded no-op mode — for the same reason:
 * testability without the real engine, here the browser's OPFS rather than S3.
 *
 * Keyed by the attachment's own client-generated UUIDv7, never by a farm/subject path — one blob,
 * one attachment row, and the id is already globally unique so no further namespacing is needed.
 */
export interface BlobStore {
  /** Commits a blob under `key`, overwriting whatever was there before. Synchronous from the
   *  caller's perspective is NOT promised — OPFS writes are async — but it resolves once the
   *  bytes are durable, the same guarantee `writeTransaction` gives a capture row. */
  put(key: string, blob: Blob): Promise<void>;
  /** The blob under `key`, or `null` if nothing was ever stored there or it has already been
   *  released. Never throws for "not found" — an attachment whose blob is gone is a fact a caller
   *  reads, not an error it catches. */
  get(key: string): Promise<Blob | null>;
  /** Releases the blob under `key`. A no-op, not an error, if nothing is there — the outbox may
   *  call this after a flush it did not itself observe succeed (a farm switch mid-round). */
  delete(key: string): Promise<void>;
}
