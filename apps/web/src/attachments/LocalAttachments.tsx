/**
 * The local attachment register (phase-checklists.md 3i(c)) — animal photos today, later crop/
 * grievance documents, as the device holds them. Split into TWO stores rather than one, and that
 * split is the point: the metadata half (`StoredAttachment`) is an ordinary JSON capture, through
 * `@werf/sync`'s SQLite-backed adapter exactly like every other `Local*.tsx`; the binary half never
 * touches that store at all (`capture_records.payload_json` is TEXT — there is nowhere in it for a
 * `Blob` to live) and instead commits to OPFS through the new `BlobStore` port (ADR-0003 same as
 * `local-database.ts`: application code never imports the underlying browser API directly here
 * either — `useAttachmentBlobStore` is the one seam).
 *
 * offline-sync.md §3.1: "the binary is written to OPFS before capture reports success. The network
 * is not in that commit path." — `useRecordAttachment` below does exactly that ordering.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createSqliteCaptureStore, type CaptureStore, type BlobStore } from '@werf/sync';
import { schemas, uuidv7 } from '@werf/core';
import { useAuth } from '../auth/AuthProvider';
import { getLocalDatabase } from '../sync/local-db';
import { useCloseCaptureStore } from '../sync/useCloseCaptureStore';
import { getBlobStore } from './blob-store';

/** What the register holds: an attachment composed offline with a client UUIDv7 (the `new`
 *  shape), `occurredAt` as an ISO STRING rather than the parsed `Date` — the same reason every
 *  other capture store keeps instants as strings (`timestampSchema` parses a string INTO a Date,
 *  so a store typed as the parsed shape compiles and then crashes on a cold start, because JSON
 *  has no Date and localStorage/SQLite hand back exactly what they were given). */
export type StoredAttachment = Omit<schemas.NewAttachment, 'occurredAt'> & {
  readonly occurredAt: string;
};

export type AttachmentStore = CaptureStore<StoredAttachment>;
export type AttachmentStoreFactory = (key: string) => AttachmentStore;
export type BlobStoreFactory = () => BlobStore;

const defaultFactory: AttachmentStoreFactory = (key) =>
  createSqliteCaptureStore<StoredAttachment>({
    database: getLocalDatabase,
    key,
    legacyStorage: window.localStorage,
  });

const defaultBlobFactory: BlobStoreFactory = () => getBlobStore();

interface AttachmentStores {
  readonly meta: AttachmentStore;
  readonly blobs: BlobStore;
}

const AttachmentStoreContext = createContext<AttachmentStores | null>(null);

export interface LocalAttachmentsProviderProps {
  children: ReactNode;
  factory?: AttachmentStoreFactory;
  blobFactory?: BlobStoreFactory;
}

export function LocalAttachmentsProvider({
  children,
  factory = defaultFactory,
  blobFactory = defaultBlobFactory,
}: LocalAttachmentsProviderProps) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  // One `BlobStore` per farm switch too, not a singleton: an OPFS adapter carries no per-farm
  // state today (it is keyed by attachment id, globally unique), but constructing it inside the
  // same farm-scoped memo as `meta` keeps the pair's lifetime legible rather than relying on that
  // fact staying true.
  const stores = useMemo<AttachmentStores>(
    () => ({
      meta: factory(`werf-attachments:${farmId}`),
      blobs: blobFactory(),
    }),
    [factory, blobFactory, farmId],
  );
  useCloseCaptureStore(stores.meta);

  return (
    <AttachmentStoreContext.Provider value={stores}>{children}</AttachmentStoreContext.Provider>
  );
}

function useAttachmentStores(): AttachmentStores {
  const stores = useContext(AttachmentStoreContext);
  if (!stores) throw new Error('useAttachment* must be used inside a LocalAttachmentsProvider');
  return stores;
}

/** Every attachment this device has captured, reactive: this re-renders when one is committed. */
export function useAttachments(): readonly StoredAttachment[] {
  const { meta } = useAttachmentStores();
  return useSyncExternalStore(meta.subscribe, meta.all);
}

/** Whether this store's initial hydration attempt is over (`CaptureStore.settled()`) — the
 *  Outbox flush must not act on `useAttachments()` until this is true. */
export function useAttachmentsSettled(): boolean {
  const { meta } = useAttachmentStores();
  return useSyncExternalStore(meta.subscribe, meta.settled);
}

/** Whether this store's hydration ATTEMPT ended in a genuine failure
 *  (`CaptureStore.hydrationFailed()`) — the Outbox flush must hold, not treat `useAttachments()`
 *  as confirmed empty, when this is true. */
export function useAttachmentsHydrationFailed(): boolean {
  const { meta } = useAttachmentStores();
  return useSyncExternalStore(meta.subscribe, meta.hydrationFailed);
}

/** The blob store, for the outbox's send leg and the orphan-blob release after `finalize`. Never
 *  reached from a capture screen — `useRecordAttachment` is the one write path into it. */
export function useAttachmentBlobStore(): BlobStore {
  const { blobs } = useAttachmentStores();
  return blobs;
}

/** SHA-256 of a blob's bytes, as lowercase hex — the checksum the wire contract requires
 *  (`checksumSchema`), computed with the browser's native SubtleCrypto rather than a bundled
 *  library. Not a network call: hashing is local compute, so an attachment capture being genuinely
 *  async (unlike every other capture's synchronous `append()`) is not the NFR-007 violation it
 *  would look like from the signature alone — nothing here waits on the network. */
async function sha256Hex(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** What a capture screen hands `useRecordAttachment` — everything the wire contract needs, minus
 *  what this hook derives itself (`id`, `farmId`, `checksum`, `sizeBytes`). */
export interface AttachmentCapture {
  readonly subjectType: schemas.NewAttachment['subjectType'];
  readonly subjectId: string;
  readonly mimeType: string;
  readonly blob: Blob;
  /** ISO 8601 — when the photo was taken, not when this reaches a server. */
  readonly occurredAt: string;
}

/**
 * Commit a photo to the local register. The blob lands in OPFS FIRST, and only once that has
 * genuinely landed (`BlobStore.put` resolved) does the metadata row join the capture log —
 * offline-sync.md §3.1's ordering, read literally. An interruption between the two leaves an
 * orphaned blob (harmless: no capture the farmer took was ever considered committed, so there is
 * nothing for the outbox to lose) rather than a metadata row pointing at nothing.
 */
export function useRecordAttachment(): (input: AttachmentCapture) => Promise<void> {
  const { meta, blobs } = useAttachmentStores();
  const { activeFarm } = useAuth();
  return useCallback(
    async (input: AttachmentCapture): Promise<void> => {
      if (!activeFarm) return;
      const id = uuidv7();
      const checksum = await sha256Hex(input.blob);
      await blobs.put(id, input.blob);
      const record: StoredAttachment = {
        id,
        farmId: activeFarm.id,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        mimeType: input.mimeType,
        sizeBytes: input.blob.size,
        checksum,
        occurredAt: input.occurredAt,
      };
      await meta.append(record);
    },
    [meta, blobs, activeFarm],
  );
}
