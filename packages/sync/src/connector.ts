/**
 * The `PowerSyncBackendConnector` this repo's local database connects with (ADR-0003,
 * phase-checklists.md 3b/4). Only imports `@powersync/common` for its TYPE — no SDK code, so
 * this file carries none of `local-database.ts`'s WASM-bundle weight and is safe to reach from
 * the main barrel. Application code never imports `@powersync/common` itself; it calls
 * `createSyncConnector` and gets a value already shaped to the SDK's interface.
 *
 * Scope for this slice: `fetchCredentials` is real — it mints a token via `GET /sync/token`
 * (apps/api's `SyncController`) and lets `.connect()` genuinely authenticate against the
 * self-hosted PowerSync service. `uploadData` is deliberately NOT wired to the domain capture
 * endpoints yet (phase-checklists.md 3c/3d): mapping a `CrudEntry` to the right
 * `/api/livestock/*` endpoint, with the SAME validation and idempotency those endpoints already
 * enforce, is the same per-table routing problem `apps/web/src/sync/captureApi.ts` +
 * `Outbox.tsx` solve for the existing localStorage-backed queue — migrating that queue is its
 * own slice, not a shortcut through a generic passthrough. See this file's `uploadData` for why
 * that shortcut specifically is not available in this codebase (db.md, the FR-131 guard).
 *
 * db.md: "the write queue is never discarded by the system." A write that reaches the CRUD
 * queue and is never uploaded must stay queued and visible as a problem, never silently
 * `complete()`d — so `uploadData` throws rather than draining the batch it cannot honestly send.
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
      if (!batch) return; // Nothing queued — the common case for the rest of this slice.

      throw new Error(
        'PowerSyncBackendConnector.uploadData has no route to a domain capture endpoint yet ' +
          '(phase-checklists.md 3c/3d) — a write reached the local CRUD queue with nowhere ' +
          'honest to send it. Leaving it queued, not discarding it.',
      );
    },
  };
}
