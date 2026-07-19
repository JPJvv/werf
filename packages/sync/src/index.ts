/**
 * The thin abstraction over the sync engine. Application code reads and writes through
 * this adapter and MUST NOT import the PowerSync SDK directly — the ADR-0003 exit depends
 * on app code not knowing PowerSync exists.
 *
 * This module is also the SINGLE SOURCE for tenancy in sync. PowerSync sync rules are a
 * SEPARATE system from Postgres RLS with a silent failure mode: a permissive sync rule
 * leaks farm B's rows onto farm A's phone even when every RLS policy is perfect, because
 * replication bypasses the query path RLS protects. So we derive the sync rules and the
 * RLS predicates from ONE table here (`TENANCY`); they cannot disagree by construction,
 * and test/tenancy.spec.ts proves the cross-farm leak is closed. See .claude/rules/db.md.
 *
 * Phase 1 classifies the identity & tenancy core; more tables join in Phase 3.
 */

/**
 * How a table is treated by sync.
 * - `farm-scoped`: bidirectional, filtered to the connected user's farms.
 * - `reference`: read-only, filtered by the farm's jurisdiction.
 * - `server-only`: NEVER reaches a device. Money, health, audit, and auth secrets stay
 *   home — a stolen phone must not contain 40 workers' payslips or anyone's TOTP seed.
 */
export type SyncClassification = 'farm-scoped' | 'reference' | 'server-only';

/**
 * How a farm-scoped table ties a row to the farm(s) that own it. The connected user syncs
 * a row only when its owning farm set intersects the farms they are a member of.
 * - `direct`: the row has a farm column that IS the farm id (e.g. farms.id, enterprises.farm_id).
 * - `via-business`: the row is a business; it is owned by every farm whose business_id is it.
 * - `via-membership`: the row is a user; it is owned by every farm that user is a member of.
 */
export type FarmScope =
  | { readonly kind: 'direct'; readonly column: string }
  | { readonly kind: 'via-business'; readonly column: string }
  | { readonly kind: 'via-membership' };

export interface TenancyEntry {
  readonly classification: SyncClassification;
  /** Present for every farm-scoped table; absent for reference/server-only. */
  readonly scope?: FarmScope;
  /** Columns that must never leave the server even when the row syncs (secrets). */
  readonly neverSyncColumns?: readonly string[];
}

/**
 * The tenancy registry for the Phase 1 identity & tenancy core. Adding a table to the
 * schema without adding it here breaks the tenancy suite on purpose (db.md): an
 * unclassified table is a table nobody decided the sync posture of.
 */
export const TENANCY = {
  businesses: {
    classification: 'farm-scoped',
    scope: { kind: 'via-business', column: 'id' },
  },
  farms: {
    classification: 'farm-scoped',
    scope: { kind: 'direct', column: 'id' },
  },
  // The user row syncs so the client can render the session offline — but its secrets
  // (password/TOTP/recovery hashes) are stripped. A device holds identity, never credentials.
  users: {
    classification: 'farm-scoped',
    scope: { kind: 'via-membership' },
    neverSyncColumns: ['password_hash', 'totp_secret_encrypted', 'recovery_codes_hashed'],
  },
  // WebAuthn material never reaches a device. Even public keys stay server-side: the
  // authentication ceremony is server-authoritative (ADR-0007).
  user_passkeys: { classification: 'server-only' },
  farm_users: {
    classification: 'farm-scoped',
    scope: { kind: 'direct', column: 'farm_id' },
  },
  enterprises: {
    classification: 'farm-scoped',
    scope: { kind: 'direct', column: 'farm_id' },
  },
} as const satisfies Record<string, TenancyEntry>;

export type SyncedTable = keyof typeof TENANCY;

/** Back-compat / convenience: the classification-only view of the registry. */
export const SYNC_CLASSIFICATIONS: Readonly<Record<string, SyncClassification>> =
  Object.fromEntries(
    Object.entries(TENANCY).map(([table, entry]) => [table, entry.classification]),
  );

/**
 * A minimal relational context for resolving which farms own a row. It is the shape the
 * test and (in Phase 3) the sync-rule evaluator both reason over — not a live query.
 */
export interface FarmGraph {
  /** farm id -> the business it belongs to */
  readonly farmBusiness: Readonly<Record<string, string>>;
  /** user id -> the farm ids they are an active member of */
  readonly membership: Readonly<Record<string, readonly string[]>>;
}

/**
 * The set of farm ids that own a given row of `table`. A row syncs to a user iff this set
 * intersects the user's own farm membership. This one function is the tenancy predicate
 * both the sync rules and RLS are generated from — the place a leak would hide.
 */
export function owningFarmIds(
  table: SyncedTable,
  row: Readonly<Record<string, unknown>>,
  graph: FarmGraph,
): readonly string[] {
  const entry: TenancyEntry = TENANCY[table];
  const scope = entry.scope;
  if (!scope) return []; // server-only / reference: never owned by a farm bucket
  switch (scope.kind) {
    case 'direct':
      return [String(row[scope.column])];
    case 'via-business': {
      const businessId = String(row[scope.column]);
      return Object.entries(graph.farmBusiness)
        .filter(([, b]) => b === businessId)
        .map(([farmId]) => farmId);
    }
    case 'via-membership':
      return graph.membership[String(row['id'])] ?? [];
  }
}

/** True iff `row` of `table` should sync to a user who is a member of `userFarmIds`. */
export function syncsToUser(
  table: SyncedTable,
  row: Readonly<Record<string, unknown>>,
  userFarmIds: readonly string[],
  graph: FarmGraph,
): boolean {
  if (TENANCY[table].classification === 'server-only') return false;
  const owners = owningFarmIds(table, row, graph);
  return owners.some((farmId) => userFarmIds.includes(farmId));
}

/** The tables that must never contribute a bucket, a data query, or a synced row. */
export const SERVER_ONLY_TABLES: readonly SyncedTable[] = (
  Object.keys(TENANCY) as SyncedTable[]
).filter((t) => TENANCY[t].classification === 'server-only');
