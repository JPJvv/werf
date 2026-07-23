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
 * How a row is tied to the tenant(s) that may see it. For farm-scoped tables the connected
 * user syncs a row only when its owning farm set intersects the farms they belong to; for
 * reference tables the row syncs when its jurisdiction matches one of the user's farms.
 * - `direct`: the row has a farm column that IS the farm id (e.g. farms.id, enterprises.farm_id).
 * - `via-business`: the row is a business; it is owned by every farm whose business_id is it.
 * - `via-membership`: the row is a user; it is owned by every farm that user is a member of.
 * - `reference-jurisdiction`: read-only reference data, filtered by the farm's jurisdiction
 *   (a ZA device never downloads Namibian withdrawal periods).
 */
export type RowScope =
  | { readonly kind: 'direct'; readonly column: string }
  | { readonly kind: 'via-business'; readonly column: string }
  | { readonly kind: 'via-membership' }
  | { readonly kind: 'reference-jurisdiction'; readonly column: string };

export interface TenancyEntry {
  readonly classification: SyncClassification;
  /** Present for farm-scoped and reference tables; absent only for server-only. */
  readonly scope?: RowScope;
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
  //
  // The 2FA STATE columns are stripped too, not just the secrets. Two reasons, and the
  // second is the sharp one: `totp_last_used_step` is auth telemetry about another person
  // (it discloses to every co-member roughly when someone last logged in), and because
  // this table is bidirectional, a column a device can push is a column a device can
  // REWRITE — a client-authored lower step, or a null, resets the replay guard from the
  // outside. Credential state belongs to the elevated server path only.
  users: {
    classification: 'farm-scoped',
    scope: { kind: 'via-membership' },
    neverSyncColumns: [
      'password_hash',
      'totp_secret_encrypted',
      'totp_enrolled_at',
      'totp_last_used_step',
      'recovery_codes_hashed',
    ],
  },
  // WebAuthn material never reaches a device. Even public keys stay server-side: the
  // authentication ceremony is server-authoritative (ADR-0007).
  user_passkeys: { classification: 'server-only' },
  // Refresh-token sessions. The most obviously server-only table in the schema: it holds
  // live credential state, and a device that could read it could impersonate every session
  // on it. The client holds ITS OWN token in secure storage; it never syncs the table.
  user_sessions: { classification: 'server-only' },
  // WebAuthn challenges. Server-only for the same reason the ceremony works at all: the
  // challenge is un-replayable because the SERVER decides what was issued and whether it
  // has been spent. A device that held this table could answer its own questions.
  webauthn_challenges: { classification: 'server-only' },
  farm_users: {
    classification: 'farm-scoped',
    scope: { kind: 'direct', column: 'farm_id' },
  },
  enterprises: {
    classification: 'farm-scoped',
    scope: { kind: 'direct', column: 'farm_id' },
  },
  // Land — camps and blocks (Phase 2). Farm-scoped and bidirectional: the farmer draws and
  // edits boundaries offline. The canonical PostGIS `boundary` is stripped because SQLite on
  // the device has no PostGIS; the client reads the denormalised `boundary_geojson` mirror
  // instead (offline-sync.md). Stripping `boundary` here is the sync half of the dual write;
  // the sync_geojson trigger is the DB half. Both, always.
  land_units: {
    classification: 'farm-scoped',
    scope: { kind: 'direct', column: 'farm_id' },
    neverSyncColumns: ['boundary'],
  },
  // Animals, their group model, and their identifiers (Phase 2). All farm-scoped and
  // bidirectional — the farmer creates and edits stock offline, in the crush, with no signal.
  // No secrets and no PostGIS here, so nothing is stripped; created_by/updated_by are farm
  // members' ids, which co-members are already entitled to see.
  mobs: {
    classification: 'farm-scoped',
    scope: { kind: 'direct', column: 'farm_id' },
  },
  animals: {
    classification: 'farm-scoped',
    scope: { kind: 'direct', column: 'farm_id' },
  },
  // Carries its own farm_id, so it scopes directly rather than through its animal — the same
  // predicate as every other farm-scoped table, and one fewer join for the sync-rule generator.
  animal_identifiers: {
    classification: 'farm-scoped',
    scope: { kind: 'direct', column: 'farm_id' },
  },
  // Events — the append-only log (Phase 2). Farm-scoped and bidirectional: the farmer captures
  // births, weights, moves and treatments offline, in the crush, with no signal. Carries its own
  // farm_id, so it scopes directly. The canonical PostGIS `location` is stripped for the same
  // reason land's `boundary` is — SQLite on the device has no PostGIS; the client reads the
  // denormalised `location_geojson` mirror, kept in step by the events_sync_geojson trigger.
  // Stripping `location` here is the sync half of that dual write; the trigger is the DB half.
  events: {
    classification: 'farm-scoped',
    scope: { kind: 'direct', column: 'farm_id' },
    neverSyncColumns: ['location'],
  },
  // Regulated reference data: the rate/withdrawal/PHI tables the client must read offline.
  // Read-only, filtered by the FARM's jurisdiction — never the user's or the browser's.
  regulatory_rates: {
    classification: 'reference',
    scope: { kind: 'reference-jurisdiction', column: 'jurisdiction' },
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
  /** farm id -> its jurisdiction (ISO 3166-1 alpha-2). Reference data is filtered by this. */
  readonly farmJurisdiction: Readonly<Record<string, string>>;
}

/**
 * The set of farm ids that own a given farm-scoped row of `table`. A row syncs to a user
 * iff this set intersects the user's own farm membership. This one function is the tenancy
 * predicate both the sync rules and RLS are generated from — the place a leak would hide.
 * Returns [] for reference and server-only tables (they are not owned by a farm).
 */
export function owningFarmIds(
  table: SyncedTable,
  row: Readonly<Record<string, unknown>>,
  graph: FarmGraph,
): readonly string[] {
  const entry: TenancyEntry = TENANCY[table];
  const scope = entry.scope;
  if (!scope) return [];
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
    case 'reference-jurisdiction':
      return []; // scoped by jurisdiction, not by farm ownership
  }
}

/** True iff `row` of `table` should sync to a user who is a member of `userFarmIds`. */
export function syncsToUser(
  table: SyncedTable,
  row: Readonly<Record<string, unknown>>,
  userFarmIds: readonly string[],
  graph: FarmGraph,
): boolean {
  const entry: TenancyEntry = TENANCY[table];
  if (entry.classification === 'server-only') return false;
  if (entry.scope?.kind === 'reference-jurisdiction') {
    // Reference data syncs when its jurisdiction matches one of the user's farms.
    const userJurisdictions = new Set(
      userFarmIds.map((farmId) => graph.farmJurisdiction[farmId]).filter(Boolean),
    );
    return userJurisdictions.has(String(row[entry.scope.column]));
  }
  return owningFarmIds(table, row, graph).some((farmId) => userFarmIds.includes(farmId));
}

/** The tables that must never contribute a bucket, a data query, or a synced row. */
export const SERVER_ONLY_TABLES: readonly SyncedTable[] = (
  Object.keys(TENANCY) as SyncedTable[]
).filter((t) => TENANCY[t].classification === 'server-only');

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
