/**
 * Regenerates `src/local-schema-tables.generated.ts` from the real Postgres schema and the
 * `TENANCY` registry. Run after any change to `packages/db/src/schema/**` or `src/tenancy.ts`:
 *
 *   pnpm --filter @werf/sync generate:schema
 *
 * `test/local-schema-freshness.spec.ts` fails CI if the checked-in file drifts from this
 * output, the same "generated file, drift is a test failure" shape as `packages/db`'s own
 * `generate` script.
 */
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import type { LocalTableDef } from '../src/local-schema';
import { deriveLocalSchemaTables } from './derive-local-schema';

function render(tables: readonly LocalTableDef[]): string {
  const body = tables
    .map(
      (table) =>
        `  {\n    name: '${table.name}',\n    columns: [\n${table.columns
          .map((c) => `      { name: '${c.name}', type: '${c.type}' },`)
          .join('\n')}\n    ],\n  },`,
    )
    .join('\n');

  return `// GENERATED FILE — do not hand-edit.
// Run \`pnpm --filter @werf/sync generate:schema\` to regenerate from the Postgres schema and
// the TENANCY registry (scripts/derive-local-schema.ts). test/local-schema-freshness.spec.ts
// fails the build if this drifts from what that derivation produces.

import type { LocalTableDef } from './local-schema';

export const LOCAL_SCHEMA_TABLES: readonly LocalTableDef[] = [
${body}
];
`;
}

const outPath = fileURLToPath(new URL('../src/local-schema-tables.generated.ts', import.meta.url));
writeFileSync(outPath, render(deriveLocalSchemaTables()));
console.log(`[@werf/sync] wrote ${outPath}`);
