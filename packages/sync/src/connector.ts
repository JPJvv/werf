/**
 * The `PowerSyncBackendConnector` this repo's local database connects with (ADR-0003,
 * phase-checklists.md 3b/4). Only imports `@powersync/common` for its TYPE — no SDK code, so
 * this file carries none of `local-database.ts`'s WASM-bundle weight and is safe to reach from
 * the main barrel. Application code never imports `@powersync/common` itself; it calls
 * `createSyncConnector` and gets a value already shaped to the SDK's interface.
 *
 * `fetchCredentials` is real — it mints a token via `GET /sync/token` (apps/api's
 * `SyncController`) and lets `.connect()` genuinely authenticate against the self-hosted
 * PowerSync service.
 *
 * ⛔ `uploadData` DELIBERATELY THROWS on any queued write, and this is the DECIDED upload
 * architecture (phase-checklists.md 3d), not a placeholder waiting for a later slice to fill in
 * per-table routing. Every capture screen writes through `apps/web/src/**Local*.tsx` into
 * `capture_records` — a `Table.createLocalOnly` table (`capture-schema.ts`) — so it NEVER enters
 * PowerSync's CRUD queue in the first place; `Outbox.tsx` reads those local-only stores and posts
 * to the `/api/*` REST endpoints directly, with the SAME validation and idempotency those
 * endpoints enforce for every other caller. `uploadData`'s queue is empty by construction on every
 * `.connect()` this app makes.
 *
 * Why REST-up rather than CRUD-native, checked against the installed SDK rather than assumed:
 * `CrudBatch.complete()` / `CrudTransaction.complete()` (`@powersync/common`) acknowledge the
 * batch as a whole — there is no per-entry completion. A 4xx capture that must be "retained and
 * set aside while the round continues" (phase-checklists.md 3d, db.md) cannot be expressed on top
 * of that primitive: either `complete()` runs and the refused entry is gone from the local queue
 * forever (the exact `DELETE` this repo's own rules forbid), or it doesn't and every entry behind
 * the refusal is blocked forever too — the "a `return` on refusal strands every capture behind
 * it" SEV-2 shape `Outbox.tsx`'s own history already found and fixed once. So this repo's
 * REST-up / PowerSync-down split is not a migration step; it is the shape the never-discard and
 * set-aside-on-refusal invariants together require. `uploadData` throwing here is a tripwire for
 * that invariant, not a stopgap for missing routing: if this batch is ever non-empty, something
 * started writing to a non-local-only table outside this design, and that is a bug to surface
 * loudly, not a queue to drain silently.
 *
 * db.md: "the write queue is never discarded by the system." A write that somehow reaches the
 * CRUD queue anyway must stay queued and visible as a problem, never silently `complete()`d — so
 * `uploadData` throws rather than draining a batch it has no honest, invariant-preserving way to
 * send.
 */

import type { CommonPowerSyncDatabase, PowerSyncBackendConnector } from '@powersync/common';
// The `./schemas` subpath, not the `@werf/core` barrel: the barrel re-exports `./uuid`, which
// uses `crypto.getRandomValues` (a DOM/browser global) — fine in apps/web's DOM-lib tsconfig,
// but this package's tsconfig has no DOM lib (local-database.ts's own header explains why:
// packages/sync is consumed as source with no pre-build step, so whatever this file imports is
// part of ITS compile graph too). The subpath imports only the schemas this file needs.
import { powerSyncCredentialsSchema } from '@werf/core/schemas';

export interface SyncConnectorOptions {
  /** Same base every other API call in this app uses — see apps/web/src/sync/captureApi.ts. */
  readonly apiBaseUrl: string;
  /**
   * Returns the CALLER's current access token, or null if signed out. `fetchCredentials`'s own
   * contract says "always fetch a fresh set of credentials" — this repo's access tokens are
   * short-lived (15 min, ADR-0007) and the app already owns refreshing them, so this connector
   * asks for one rather than caching one itself.
   */
  readonly getAccessToken: () => Promise<string | null>;
}

export function createSyncConnector(options: SyncConnectorOptions): PowerSyncBackendConnector {
  return {
    async fetchCredentials() {
      const accessToken = await options.getAccessToken();
      if (!accessToken) return null;

      const response = await fetch(`${options.apiBaseUrl}/sync/token`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        throw new Error(`Could not fetch PowerSync credentials (HTTP ${response.status})`);
      }

      const body = powerSyncCredentialsSchema.parse(await response.json());
      return { endpoint: body.endpoint, token: body.token, expiresAt: new Date(body.expiresAt) };
    },

    async uploadData(database: CommonPowerSyncDatabase) {
      const batch = await database.getCrudBatch();
      if (!batch) return; // Empty by construction — every capture table is `localOnly`.

      throw new Error(
        'PowerSyncBackendConnector.uploadData received a non-empty CRUD batch, which should be ' +
          'structurally impossible: every capture table is Table.createLocalOnly (capture-schema.ts) ' +
          'and Outbox.tsx is the sole uploader (phase-checklists.md 3d). Something wrote to a ' +
          'non-local-only PowerSync table outside that design. Leaving the batch queued, not ' +
          'discarding it — db.md: the write queue is never discarded by the system.',
      );
    },
  };
}
