# ADR-0012 · REST-up, PowerSync-down: the permanent upload topology

**Status:** Accepted | **Date:** 2026-08-10 | **Decider:** JP van Vuuren (product owner)

## Context

ADR-0003 chose PowerSync as the sync engine and said client writes "route back through our API."
It did not say, at the time, whether that meant PowerSync's own CRUD upload queue calling our API
under the hood, or our own hand-written uploader calling our API directly with PowerSync limited to
down-sync. Phase 3 built the latter one slice at a time — `Outbox.tsx` (Phase 2), then
`Table.createLocalOnly` on every capture table (3c), then an audit of every 3d invariant against it
(slice 3d) — without a single commit that named the destination as permanent. STATUS.md's 3d entry
therefore reads, honestly, like a TODO a later slice fills in: "no per-table upload route exists
yet (3c/3d)."

Checked against the installed SDK during the 3d audit, not assumed: `CrudBatch.complete()` /
`CrudTransaction.complete()` (`@powersync/common`) acknowledge an uploaded batch **as a whole**.
There is no per-entry completion. `phase-checklists.md` 3d and `.claude/rules/db.md` both require
that a 4xx capture — a duplicate tag number, a camp code already used this week — is "retained and
set aside while the round continues," and `Outbox.tsx`'s own commit history already contains one
SEV-2 caused by getting that wrong (a `return` on refusal stranding every capture behind it). Built
on `complete()`'s batch-only semantics, that invariant has exactly two ways to fail: call
`complete()` and lose the refused entry from the local queue forever (the hard-DELETE this repo's
own rules forbid), or withhold `complete()` and block every entry behind the refusal forever (the
strand-the-queue shape already fixed once). Neither is acceptable, and no third option exists on
that primitive.

## Decision

**REST-up, PowerSync-down, permanently.** This is not a migration step Phase 3 is still walking
toward; it is the shape the never-discard and set-aside-on-refusal invariants jointly require, and
it does not change when a later phase adds capture types.

- Every offline capture writes to local-only SQLite/OPFS `capture_records`
  (`Table.createLocalOnly`, `packages/sync/src/capture-schema.ts`) — never a PowerSync-synced
  table. It never enters PowerSync's CRUD upload queue, by construction.
- `apps/web/src/sync/Outbox.tsx` is the durable upload queue: the FK-graph and safety ordering, the
  4xx-set-aside / 5xx-abort round semantics, and the sent-log are all here and stay here.
- Uploads go through the domain-owned REST endpoints (`apps/api`'s `livestockApi`/`landApi`/etc.
  callers), the same endpoints every other caller of the API uses. API-side tenancy, validation,
  idempotency (`findEvent`-before-validate) and audit logic remain the sole authority over what a
  write means — the client is optimistic, the server decides, exactly as ADR-0003 already said.
- PowerSync provides farm-scoped **down-sync only**: Sync Streams replicate canonical Postgres rows
  to the device's local SQLite for reading. No application capture path writes through it.
- A non-empty CRUD batch reaching `PowerSyncBackendConnector.uploadData` is structurally
  unexpected — proof that something wrote to a non-local-only table outside this design.
  `uploadData` throws rather than draining it, and does not call `complete()`: the batch stays
  queued and visible as a bug to fix, per db.md's "the write queue is never discarded by the
  system." It is a tripwire, not a stopgap awaiting per-table routing.

### Why `complete()`'s batch-only semantics rule out CRUD-native routing

A per-record 4xx set-aside needs the local queue to retain exactly the refused row and release
every row after it. `complete()` operates on the batch or the transaction, not the row: there is no
call that says "this one entry is done, the rest of the batch is still pending." Building set-aside
semantics on top of it means simulating a per-row queue underneath a primitive that has none —
duplicating `Outbox.tsx`'s own bookkeeping inside a second uploader, for no functional gain over
the uploader that already exists, is provably correct, and is already covered by the 3d audit.

### Rejected alternative: CRUD-native redesign

Route every capture write through PowerSync's own CRUD tables and let `uploadData` post the queue.
Rejected:

- It cannot express 4xx set-aside without either discarding the refused row or blocking the batch,
  per the `complete()` analysis above.
- It would duplicate — not replace — `Outbox.tsx`'s FK-graph ordering, safety ordering
  (evidence-before-the-act-it-guards, §5 of `offline-sync.md`), and `needsHead` arithmetic, because
  none of that is expressible in PowerSync's own upload contract; a CRUD-native uploader would still
  need a hand-written layer on top to reorder and gate its own batch, which is `Outbox.tsx` in a
  worse position.
- It buys nothing ADR-0003's exit needs: application code already never imports the PowerSync SDK
  directly, whichever uploader is used.

## Consequences

| | |
|---|---|
| ➕ | One durable queue, one place the ordering/idempotency/never-discard invariants live, already audited (3d) |
| ➕ | `uploadData`'s throw is a real safety net: any future capture accidentally written to a synced table fails loudly at the connector, not silently in production |
| ➕ | No dead per-table CRUD-routing code to build and maintain for a queue that is empty by construction |
| ➖ | Two upload-adjacent code paths exist in the codebase (`Outbox.tsx` and the connector's tripwire) rather than one; a reader must know both to see the whole picture — mitigated by this ADR and the connector's own header |
| ➖ | PowerSync's CRUD queue, ACK/retry machinery and conflict tooling go entirely unused on the upload side — a deliberate non-use of vendor capability, not an oversight |

## Relationship to ADR-0003

ADR-0003 is **not rewritten**. Its decision — self-hosted PowerSync, client-side SQLite as local
truth, "client writes route back through our API" — stands as originally accepted. What ADR-0003
left open was *which* mechanism performs the routing: PowerSync's own upload queue, or a
hand-written one calling the same API. This ADR answers that question, permanently, for the reasons
`complete()`'s semantics force. ADR-0003 gets a short clarifying note pointing here; its history is
not edited to read as if this distinction were always explicit.

## Revisit if

`@powersync/common` ships per-entry batch completion (checked against the installed SDK, not
assumed, the same way this decision was reached) · a future capture type has no meaningful
per-record refusal semantics and duplicate-queue overhead becomes worth avoiding for it
specifically · PowerSync's own upload path gains first-class support for evidence-before-act
ordering across a batch.
