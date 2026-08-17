/**
 * Proves `infra/powersync/sync-config.yaml` — the file actually mounted into the self-hosted
 * PowerSync service — still matches what `scripts/derive-sync-streams.ts` would produce from
 * the REAL Postgres schema today. Same "generated file, drift is a test failure" shape as
 * `local-schema-freshness.spec.ts`. It can drift the moment someone edits
 * `packages/db/src/schema/**` or `src/tenancy.ts` without re-running
 * `pnpm --filter @werf/sync generate:sync-rules`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderSyncStreamsYaml } from '../src/sync-streams';
import { deriveSyncStreams } from '../scripts/derive-sync-streams';

describe('sync streams freshness', () => {
  it('matches what deriving from @werf/db and TENANCY produces right now', () => {
    const checkedIn = readFileSync(
      fileURLToPath(new URL('../../../infra/powersync/sync-config.yaml', import.meta.url)),
      'utf-8',
    );
    const body = checkedIn.slice(checkedIn.indexOf('config:'));
    expect(body).toEqual(renderSyncStreamsYaml(deriveSyncStreams()));
  });

  it('is not empty — a vacuous derivation would pass the check above for the wrong reason', () => {
    expect(deriveSyncStreams().length).toBeGreaterThan(10);
  });
});
