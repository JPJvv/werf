/**
 * Regenerates `sync-rules.generated.yaml` from the real Postgres schema and the `TENANCY`
 * registry. Run after any change to `packages/db/src/schema/**` or `src/tenancy.ts`:
 *
 *   pnpm --filter @werf/sync generate:sync-rules
 *
 * `test/sync-rules-freshness.spec.ts` fails CI if the checked-in file drifts from this output —
 * the same shape `generate-local-schema.ts` uses for the client schema.
 */
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { renderSyncRulesYaml } from '../src/sync-rules';
import { deriveSyncRulesBuckets } from './derive-sync-rules';

const HEADER = `# GENERATED FILE — do not hand-edit.
# Run \`pnpm --filter @werf/sync generate:sync-rules\` to regenerate from the Postgres schema and
# the TENANCY registry (scripts/derive-sync-rules.ts). test/sync-rules-freshness.spec.ts fails the
# build if this drifts from what that derivation produces.
#
# KNOWN GAPS — deliberate, tracked in STATUS.md's owner decisions, not oversights:
#   - businesses, regulatory_rates, veterinary_products sync to NO device: their tenancy
#     predicate needs a two-hop JOIN (user -> farm_users -> farms -> business_id/jurisdiction)
#     that classic PowerSync Sync Rules cannot express (no JOINs/subqueries in Parameter or Data
#     Queries). See derive-sync-rules.ts's header.
#   - users: only the connected user's OWN row syncs. RLS additionally grants a co-member's row
#     through the same two-hop shape; that half is not expressed here. Narrower than RLS, so
#     nothing leaks, but it is a real gap from what TENANCY declares.
#   - by_farm's parameter query omits farm_users.expires_at (supported SQL has no now() or any
#     time-based function). A membership with a past expires_at that has not been soft-deleted
#     keeps syncing here after RLS would already refuse it. See sync-rules.ts's header.
`;

const outPath = fileURLToPath(new URL('../sync-rules.generated.yaml', import.meta.url));
writeFileSync(outPath, HEADER + renderSyncRulesYaml(deriveSyncRulesBuckets()));
console.log(`[@werf/sync] wrote ${outPath}`);
