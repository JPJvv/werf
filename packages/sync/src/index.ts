/**
 * The thin abstraction over the sync engine. Application code reads and writes through
 * this adapter and MUST NOT import the PowerSync SDK directly — the ADR-0003 exit depends
 * on app code not knowing PowerSync exists. Enforced by eslint.config.mjs, not just this
 * comment: a `no-restricted-imports` rule blocks `@powersync/*` everywhere outside this
 * package.
 */

export {
  SYNC_CLASSIFICATIONS,
  SERVER_ONLY_TABLES,
  TENANCY,
  owningFarmIds,
  syncsToUser,
  type FarmGraph,
  type RowScope,
  type SyncClassification,
  type SyncedTable,
  type TenancyEntry,
} from './tenancy';

// Local durable state the app reads through this adapter rather than touching a storage
// API directly (ADR-0003). The session is the first of these; the write queue and the
// domain tables join it in Phase 3.
export {
  DEFAULT_SESSION_WINDOW_DAYS,
  createSessionStore,
  isWithinWindow,
  type CachedSession,
  type SessionStorageLike,
  type SessionStore,
  type SessionStoreOptions,
} from './session-store';
export { createCaptureStore, type CaptureStore, type CaptureStoreOptions } from './capture-store';
export {
  DEFAULT_EVENT_RETENTION_MONTHS,
  EVENT_RETENTION_RETRY_MS,
  EVENT_RETENTION_STREAM,
  createEventRetentionController,
  eventMonthBuckets,
  type EventRetentionController,
  type EventRetentionControllerOptions,
  type FarmEventRetention,
} from './event-retention';
// The SQLite/OPFS-backed sibling (phase-checklists.md 3c). Only `import type { LocalDatabase }`
// crosses into local-database.ts — erased at build time — so, like connector.ts and
// local-schema.ts above, this is safe in the eagerly-bundled barrel; it never drags in
// `@powersync/web`'s runtime by itself.
export {
  createSqliteCaptureStore,
  PERSIST_RETRY_INTERVAL_MS,
  type SqliteCaptureStoreOptions,
} from './sqlite-capture-store';
export { createDraftStore, type DraftStore, type DraftStoreOptions } from './draft-store';
export { createSentLog, type SentLog, type SentLogOptions } from './sent-log';
export {
  createReferenceCache,
  type ReferenceCache,
  type ReferenceCacheOptions,
} from './reference-cache';

// Phase 3 — the local SQLite/OPFS schema (ADR-0003). DERIVED from `TENANCY` at dev time
// (scripts/derive-local-schema.ts) rather than hand-duplicated, so a table's sync posture and
// its local shape cannot drift apart — see local-schema.ts for why the derivation itself
// cannot live here. Pure `@powersync/common` data: safe in this eagerly-bundled barrel.
export { LOCAL_SCHEMA_TABLES } from './local-schema-tables.generated';
export { localSchema, type LocalSchema } from './local-schema';

// The PowerSyncBackendConnector (Phase 3 slice 3b/4). Only `@powersync/common` TYPES cross
// this file's import boundary (see connector.ts's header) — erased at build time, so this is
// as safe to export eagerly as local-schema.ts's `Schema` usage above, unlike local-database.ts.
export { createSyncConnector, type SyncConnectorOptions } from './connector';

// The down-sync read side (phase-checklists.md 3e). Only `import type { LocalDatabase }` crosses
// into local-database.ts, same discipline as sqlite-capture-store.ts above.
export {
  createHydratedTableStore,
  type HydratedTableStore,
  type HydratedTableStoreOptions,
} from './hydrated-table-store';

// `createLocalDatabase` (local-database.ts) is deliberately NOT re-exported here. It pulls in
// `@powersync/web`'s SQLite/OPFS engine — multiple megabytes of WASM — and apps/web consumes
// this package as source with no pre-build step (vite.config.ts), so anything reachable from
// THIS barrel ships in the initial bundle whether or not it is ever called. Confirmed by
// building it in: the 250KB gz budget (NFR-009) blew past 1MB and the PWA precache manifest
// failed outright on the 2MB+ wasm assets. Nothing calls it yet this slice (checklist 3a is
// schema + factory, not a wired-up connection — that is 3b onward), so import it explicitly
// from '@werf/sync/local-database' when a real call site exists, and let Vite code-split it
// behind a dynamic import at that point rather than eagerly here.
export type { LocalDatabase, LocalDatabaseOptions } from './local-database';
