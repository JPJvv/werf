/**
 * Regenerates `infra/powersync/sync-config.yaml` — the file actually mounted into the
 * self-hosted PowerSync service (docker-compose.yml) — from the real Postgres schema and the
 * `TENANCY` registry. Run after any change to `packages/db/src/schema/**` or `src/tenancy.ts`:
 *
 *   pnpm --filter @werf/sync generate:sync-rules
 *
 * `test/sync-streams-freshness.spec.ts` fails CI if the checked-in file drifts from this
 * output — the same shape `generate-local-schema.ts` uses for the client schema. Writing
 * straight into `infra/powersync/` (rather than a `packages/sync/*.generated.yaml` that
 * something else would have to copy into place) means there is exactly one file to keep fresh,
 * not two that could drift from each other.
 */
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { renderSyncStreamsYaml } from '../src/sync-streams';
import { deriveSyncStreams } from './derive-sync-streams';

const HEADER = `# GENERATED FILE — do not hand-edit.
# Run \`pnpm --filter @werf/sync generate:sync-rules\` to regenerate from the Postgres schema and
# the TENANCY registry (packages/sync/scripts/derive-sync-streams.ts).
# test/sync-streams-freshness.spec.ts (in @werf/sync) fails the build if this drifts from what
# that derivation produces. See service.yaml's header for the storage/auth setup this config
# runs alongside, and packages/sync/src/sync-streams.ts's header for what was empirically
# confirmed against a real journeyapps/powersync-service:1.23.3 instance (2026-08-09) — IN
# (SELECT ...) subqueries validate including two-hop nesting, EXISTS and now() do not.
`;

const outPath = fileURLToPath(
  new URL('../../../infra/powersync/sync-config.yaml', import.meta.url),
);
writeFileSync(outPath, HEADER + renderSyncStreamsYaml(deriveSyncStreams()));
console.log(`[@werf/sync] wrote ${outPath}`);
