/**
 * Proves `sync-rules.generated.yaml` still matches what `scripts/derive-sync-rules.ts` would
 * produce from the REAL Postgres schema today — the same "generated file, drift is a test
 * failure" shape as `local-schema-freshness.spec.ts`. The checked-in file is what task 3c's
 * self-hosted PowerSync service is actually configured with; it can drift the moment someone
 * edits `packages/db/src/schema/**` or `src/tenancy.ts` without re-running
 * `pnpm --filter @werf/sync generate:sync-rules`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderSyncRulesYaml } from '../src/sync-rules';
import { deriveSyncRulesBuckets } from '../scripts/derive-sync-rules';

describe('sync rules freshness', () => {
  it('matches what deriving from @werf/db and TENANCY produces right now', () => {
    const checkedIn = readFileSync(
      fileURLToPath(new URL('../sync-rules.generated.yaml', import.meta.url)),
      'utf-8',
    );
    const body = checkedIn.slice(checkedIn.indexOf('bucket_definitions:'));
    expect(body).toEqual(renderSyncRulesYaml(deriveSyncRulesBuckets()));
  });

  it('is not empty — a vacuous derivation would pass the check above for the wrong reason', () => {
    const byFarm = deriveSyncRulesBuckets().find((b) => b.name === 'by_farm');
    expect(byFarm?.tables.length ?? 0).toBeGreaterThan(5);
  });
});
