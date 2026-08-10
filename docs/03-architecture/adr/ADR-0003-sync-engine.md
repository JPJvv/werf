# ADR-0003 · PowerSync as the sync engine

**Status:** Accepted, clarified by [ADR-0012](ADR-0012-upload-topology.md) · **Date:** 2026-07 ·
**Deciders:** Tech lead

> **Clarified 2026-08-10, upload-path detail only.** This ADR always said client writes "route back
> through our API" (below) but left open *which mechanism* performs that routing — PowerSync's own
> CRUD upload queue, or a hand-written uploader calling the same API. ADR-0012 answers that,
> permanently: REST-up (`Outbox.tsx`) / PowerSync-down. Nothing else here changed or was rewritten;
> this note exists so the distinction ADR-0012 needed is explicit rather than inferred.

## Context

The single hardest requirement in the product: the client must work with the network off, indefinitely, with zero data loss (NFR-101, NFR-105). This is the thing most likely to sink the project. The choice of how deltas move between a phone in a camp and Postgres in Cape Town determines the shape of everything else.

## Decision

**PowerSync, self-hosted**, with a client-side SQLite (WASM/OPFS) database as the local source of truth.

## Why

The candidates split into three groups.

**Custom sync.** We write it. Total control, no vendor. Also: this is where projects die. Checkpointing, resumability on EDGE, tombstones, partial sync, conflict semantics, schema migration on a client that has been offline for six weeks — each is a subtle distributed-systems problem, and getting any one wrong loses a farmer's data once and their trust forever. This is not our differentiator. Our differentiator is knowing what Sectoral Determination 13 says. Rejected.

**Document-oriented offline DBs (RxDB, PouchDB/CouchDB, WatermelonDB).** Mature, real offline support. But they push us away from Postgres or toward a second datastore, and we need Postgres — PostGIS for boundaries, real joins for reporting, RLS for tenancy. RxDB with a custom replication handler against our own API was the serious runner-up; it is a good design and it is more code we own in the highest-risk area. Rejected on that basis, not on quality.

**Pluggable Postgres sync engines (ElectricSQL, Zero, PowerSync).** All three integrate with Postgres and are actively developed. The distinction that matters:

> **Local-first is not offline-first.** ElectricSQL and Zero are excellent at making an app feel instant by syncing a working set locally. Neither treats *indefinite disconnection with a durable write queue* as the primary case. PowerSync does — it is the only one of the three with first-class offline support, which is precisely the axis we cannot compromise on.

PowerSync specifics:
- Client SDK maintains an embedded SQLite kept in sync; writes go to a durable upload queue and drain when connectivity returns.
- Server connects to Postgres via **logical replication** (WAL) — the same CDC mechanism as Debezium. Non-invasive: no schema changes, no triggers.
- **Sync Rules** control which rows reach which client — partial sync, which matters when a farm has 50,000 animals and a phone has 4GB of RAM.
- Client writes route **back through our API**, so our business rules and RLS apply. The client is optimistic; the server is authoritative.
- **Self-hostable** — required for [ADR-0002](ADR-0002-data-residency.md).
- Sync Streams reached GA in May 2026. The service achieved SOC 2 and HIPAA compliance in January 2026.
- Web SDK uses SQLite WASM with OPFS persistence.

## Consequences

| | |
|---|---|
| ➕ | The hardest problem is solved by people who solve it full-time |
| ➕ | Postgres stays the source of truth; PostGIS, RLS, joins all intact |
| ➕ | Real SQL on the client — joins across animals × events × camps, locally, offline |
| ➕ | Partial sync via Sync Rules bounds the client footprint |
| ➕ | Self-hostable in af-south-1 |
| ➖ | **Vendor dependency on the most load-bearing component** |
| ➖ | Sync Rules are a second access-control language that must agree with RLS |
| ➖ | Logical replication requires operational care (WAL growth on idle databases is a known footgun) |
| ➖ | PostGIS geometry does not sync to SQLite |

## The two consequences that need engineering, not acceptance

**Sync Rules ≠ RLS.** Two independent systems enforcing one invariant, with a silent failure mode: a permissive sync rule leaks cross-tenant data even when RLS is perfect, because replication bypasses the query path RLS protects. Mitigation: `packages/sync/test/tenancy.spec.ts` asserts sync rules and RLS policies grant identical sets, per table, in CI. Not optional.

**PostGIS does not sync.** Canonical `geometry` column in Postgres for spatial queries; a denormalised GeoJSON `text` column that does sync, for the client. Both, always, kept consistent by a trigger. This is in CLAUDE.md because it is exactly the kind of thing that gets forgotten in month four.

## The exit

Vendor risk on this component is real, so the exit is designed in, not hoped for:

1. The sync service is **source-available and self-hosted** — the vendor cannot switch us off.
2. All PowerSync usage is behind a thin adapter in `packages/sync`. Application code never imports the SDK directly.
3. Postgres is untouched by PowerSync's presence (logical replication is non-invasive). The data is ours, in a standard shape, in our account.
4. If PowerSync disappears, the migration is: implement the adapter against RxDB's replication protocol pointed at our existing API. Estimated 6–10 engineer-weeks. Painful, survivable, and scoped to one package.

That is what makes this an acceptable dependency rather than a bet.

## Revisit if

The adapter starts leaking PowerSync concepts into application code (the exit is closing) · ElectricSQL or Zero ships genuine offline-first · Self-hosting cost exceeds ~1 engineer-week/month · A tenancy leak reaches production.
