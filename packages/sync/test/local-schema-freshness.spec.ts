/**
 * Proves `src/local-schema-tables.generated.ts` still matches what
 * `scripts/derive-local-schema.ts` would produce from the REAL Postgres schema today. The
 * generated file is committed (so app code and Playwright never need `@werf/db`/`pg` at
 * runtime — see derive-local-schema.ts's header), which means it can drift the moment someone
 * edits `packages/db/src/schema/**` or `src/tenancy.ts` without re-running
 * `pnpm --filter @werf/sync generate:schema`. This is the same "generated file, drift is a
 * test failure" shape `packages/db` itself uses for migrations.
 *
 * Only this file (and the generator) may import `@werf/db` from within `packages/sync` — both
 * run in vitest's Node project, never in the browser bundle apps/web builds from `src/**`.
 */

import { describe, expect, it } from 'vitest';
import { deriveLocalSchemaTables } from '../scripts/derive-local-schema';
import { LOCAL_SCHEMA_TABLES } from '../src/local-schema-tables.generated';

describe('local schema freshness', () => {
  it('matches what deriving from @werf/db and TENANCY produces right now', () => {
    expect(LOCAL_SCHEMA_TABLES).toEqual(deriveLocalSchemaTables());
  });

  it('is not empty — a vacuous derivation would pass the check above for the wrong reason', () => {
    expect(deriveLocalSchemaTables().length).toBeGreaterThan(10);
  });
});
