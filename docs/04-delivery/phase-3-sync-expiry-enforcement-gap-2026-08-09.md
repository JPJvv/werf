# Sync Streams expiry enforcement bridge

**Date:** 2026-08-09 | **Status:** RESOLVED — Option A implemented with a one-minute API sweep |
**Found by:** `sync-auditor`, Phase 3 slice 4 review, `phase-3/powersync-foundation`

## Summary

Every table a device replicates is gated by a PowerSync Sync Stream predicate built on
`farm_users` membership. That predicate cannot express `expires_at`, because PowerSync's Sync
Streams query validator rejects `now()` ("Unknown function") — confirmed empirically against the
real self-hosted service, not assumed from docs. Postgres RLS enforces `expires_at` correctly at
the API. Sync replication does not go through RLS's query path, so it doesn't inherit that
enforcement.

The fix keeps the stream predicate validator-safe and bridges the missing time comparison into a
signal it already understands. `MembershipExpiryService` runs once per minute, uses PostgreSQL's
own `now()` to soft-delete every elapsed live membership, and updates `updated_at` in the same
statement. Every Sync Stream already requires `deleted_at IS NULL`, so an already-connected device
loses the membership bucket after that tombstone propagates. The formerly unbounded exposure is now
bounded to one minute plus job execution and replication propagation time.

**The original gap was latent when found and was closed before it became exploitable.** No write
path in the product sets
`farm_users.expires_at` to a non-null value yet — it is schema-only, carried for a planned
external/time-boxed grant. FR-005 invitations exist, but their request and write paths do not expose
or set an expiry. Every `farm_users` row produced by the app today therefore has
`expires_at = NULL`, which RLS and every Sync Stream treat identically. The sweep is deliberately in
place before that feature grows an expiry field.

## Where this touches

**The predicate every Sync Stream shares** (`packages/sync/scripts/derive-sync-streams.ts:28-33`):

```ts
function membershipSubquery(select: 'farm_id' | '1'): string {
  return (
    `SELECT ${select} FROM farm_users` +
    ' WHERE user_id = auth.user_id() AND deleted_at IS NULL AND accepted_at IS NOT NULL'
  );
}
```

Compare Postgres RLS's `app_user_farm_ids()`, which every farm-scoped table's policy calls
(`packages/db/migrations/0004_membership_acceptance.sql:34`, restated in
`0001_rls.sql:38` and `0007_membership_write_authority.sql:43`):

```sql
AND (expires_at IS NULL OR expires_at > now())
```

The `now()` clause is the one difference, and it is not a choice — the module's own header records
why (`packages/sync/src/sync-streams.ts:14-23`): a stream using `now()` fails PowerSync's config
validator outright, exactly as it did under the classic Sync Rules format this repo evaluated and
discarded first. There is no query-language escape hatch; this is a ceiling in the self-hosted
service, confirmed by running it, not a gap the generator chose to leave.

**The server-side bridge** (`apps/api/src/sync/membership-expiry.service.ts`) runs at second zero of
every minute and executes the equivalent of:

```sql
UPDATE farm_users
SET deleted_at = now(), updated_at = now()
WHERE deleted_at IS NULL
  AND expires_at IS NOT NULL
  AND expires_at <= now();
```

It deliberately uses database time, matching RLS rather than trusting an API host clock. The
predicate is idempotent: multiple ECS API replicas may run it, but once one transaction tombstones
a row, concurrent updates re-check `deleted_at IS NULL` and do not change it again. Nest's scheduler
also prevents one replica from overlapping its own previous run.

**What actually reads the two systems apart:**

- **RLS** (`packages/db/migrations/*_rls.sql`) governs every direct Postgres query the NestJS API
  makes — `apps/api/src/farms/*`, every domain read/write. An expired membership is refused there
  today, correctly, the moment the invite feature starts setting `expires_at`.
- **Sync replication** is a separate connection PowerSync's own service makes to Postgres — logical
  replication plus PowerSync's bucket-parameter resolution against `auth.user_id()` — and it never
  passes through the RLS-protected connection the API uses.
  `.claude/rules/db.md`'s own standing rule names this exact shape: *"Sync rules are NOT RLS...
  replication bypasses the query path RLS protects."*

**Original blast radius, now bounded by the sweep:** every farm-scoped table currently
represented in a Sync Stream — `animals`, `events`, `land_units`, `mobs`, `branding_registers`,
`theft_incidents`, `farm_users`, `farms`, `businesses`, `enterprises`, `animal_identifiers`,
`users` (co-members) — stays subscribed and continues receiving *new* replicated writes on an
already-connected device, for as long as `.connect()` keeps running, past the grant's `expires_at`.
It is not merely "the device keeps a stale local copy" — a currently-open sync connection keeps
being fed live data for that farm after the grant that justified the connection has expired.
With the implemented bridge, this can persist only until the next one-minute sweep completes and
the resulting tombstone propagates, rather than for the lifetime of `.connect()`.

**Adjacent boundaries:**

- A device that reconnects *after* expiry with a token minted post-expiry is unaffected only if the
  API-side invite/membership check also gates token issuance — worth confirming when the invite
  feature is designed (see Option B below), since today's `GET /sync/token`
  (`apps/api/src/sync/sync.controller.ts`) mints a token from the caller's session alone and does
  not consult `farm_users` at all (deliberately — see the token's own design note below).
- The PowerSync connection JWT itself (`apps/api/src/auth/token.service.ts`) carries only `sub`, no
  farm list, by design — farm scoping is meant to live entirely in the replication-time
  `farm_users` lookup, not the token. That design is sound; it's the replication-time lookup that
  has the gap.
- The PowerSync token remains intentionally unscoped. Option B below remains useful
  defence-in-depth for a future time-boxed-grant UI, but token gating cannot revoke an existing
  connection and therefore is not the fix.

## Possible solutions

### Option A — Expiry-sweep job (soft-delete on expiry) — IMPLEMENTED

A NestJS scheduled job soft-deletes (`deleted_at = now()`) any `farm_users` row where
`expires_at <= now() AND deleted_at IS NULL`.

- **Why it closes the gap:** `deleted_at IS NULL` is already the one clause every Sync Stream *can*
  express and already does express (`membershipSubquery`'s `deleted_at IS NULL`). Once a row is
  soft-deleted, replication drops it from the bucket-parameter set on the sweep's next tick, and
  the farm stops being replicated to that user going forward. `deleted_at` becomes the single
  revocation signal both RLS and every Sync Stream already share — no new predicate shape, no new
  query-language ceiling to hit.
- **Latency:** the one-minute cadence bounds the post-expiry replication window to one minute plus
  job execution and replication propagation. API access remains blocked immediately by RLS.
- **Cost:** one migration-free scheduled service (no schema change — `deleted_at` already exists),
  one official Nest scheduler dependency, a real-Postgres behavioural test, and a cross-artifact
  test proving the sweep produces the `deleted_at` signal every generated stream consumes.
- **Side effect to design deliberately:** a soft-deleted-by-expiry row and a soft-deleted-by-owner
  row become indistinguishable by `deleted_at` alone. If the product ever needs to tell an owner
  "this grant expired" versus "you removed this person," that needs a second column (e.g.
  `revoked_reason`). No current screen or requirement needs that distinction, so this fix does not
  add a speculative column; the existing `expires_at` remains available as context.

### Option B — Gate token issuance on live membership, not just session validity

Change `GET /api/sync/token` (`apps/api/src/sync/sync.controller.ts`) to check the caller's
`farm_users` rows for the target farm(s) at mint time — refuse or scope the token if none are
unexpired — rather than minting unconditionally from the session.

- **What it closes:** a *new* connection cannot start syncing an expired farm. It does **not**
  close the gap for a device that is *already connected* when the grant expires — PowerSync's
  replication stream, once subscribed, keeps delivering new writes to a live connection regardless
  of what happens to token issuance afterward; the token is checked at connect time, not on every
  subsequent delta.
- **Cost:** the connector's own design note (`token.service.ts`) states the *opposite* choice was
  deliberate — minimal claims specifically so a revoked membership takes effect "on the next
  replicated write," not gated by a 15-minute token TTL. Adding a mint-time check partially
  contradicts that reasoning: it helps the next-connection case but doesn't touch the live-session
  case, which is the more dangerous one (an active device with an active grant that just expired).
- **Verdict:** worth doing as a defence-in-depth layer alongside Option A, not as a substitute for
  it — it narrows the *new-connection* window to zero but leaves the *already-connected* window
  exactly where Option A alone leaves it (bounded by the sweep interval).

### Option C — Client-side expiry enforcement (defence in depth, not a fix on its own)

Have the client itself track its own `farm_users.expiresAt` (already replicated, since `farm_users`
is itself a synced table) and call `db.disconnect()` when the local clock passes it.

- **What it closes:** nothing on its own — a device under a malicious or compromised actor's
  control simply doesn't run this check. This is the client obeying a rule it could choose to
  ignore, which is not a security boundary; `.claude/rules/db.md` and this repo's whole tenancy
  posture treat the server as the only trustworthy enforcement point.
- **Where it's still worth doing:** as UX, not security — an honest client should stop asking for
  data it knows it's no longer entitled to, and should tell the person clearly ("Your access to
  this farm ended on [date]") rather than silently going quiet. This belongs alongside Option A, not
  instead of it, and should not be reported anywhere as closing the gap.

### Option D — Defer until the external-grant feature is actually designed — REJECTED

Do nothing now; treat this as blocking only the *invite-with-expiry* feature (FR-005's `scope`/
`expires_at` grant), not Phase 3 sync itself, since no current write path sets a non-null
`expires_at`.

- **Argument for:** matches this repo's own "refusing to half-build is a decision, not a delay"
  principle in reverse — there is no complete feature to half-build yet, so this is arguably
  pre-emptive work.
- **Argument against:** the sweep job (Option A) is cheap, has no dependency on how the invite UI
  ends up shaped, and closing it now means the invite feature ships with the enforcement gap
  already closed rather than needing a "don't ship the expiry field to the UI until sync-team signs
  off" coordination step later. Cheap-and-early usually beats "remember to block this later."

## Decision

Option A is implemented in the NestJS API at a one-minute cadence and closes the actual gap by
reusing a signal both systems already trust. Database time is authoritative; the job updates both
`deleted_at` and `updated_at`; concurrent replicas are safe because the update is idempotent.
Option B is a reasonable defence-in-depth addition once the invite/grant UI exists, worth speccing
alongside it, not as a Phase 3 blocker on its own. Option C is UX polish, never a substitute.
Option D was rejected because it would leave the gap racing the time-boxed-grant feature.

No `revoked_reason` column is added now. Add one with the future UI only if the product needs to
distinguish expiry from an owner's manual removal.

## Evidence trail

- `packages/sync/scripts/derive-sync-streams.ts:24-33` — the shared predicate, `expires_at`
  omitted, comment naming why.
- `packages/sync/src/sync-streams.ts:14-23` — empirical confirmation `now()` fails Sync Streams
  validation against the real `journeyapps/powersync-service:1.23.3`.
- `packages/db/migrations/0001_rls.sql:38`, `0004_membership_acceptance.sql:34`,
  `0007_membership_write_authority.sql:43` — RLS's `expires_at` enforcement, present in three
  places, absent from every Sync Stream.
- `packages/db/src/schema/core.ts:119-132` — `farm_users.scope`/`expiresAt`, commented as carrying
  the planned "external" grant (FR-005), currently unset by any write path.
- `apps/api/src/sync/membership-expiry.service.ts` — one-minute, database-clock expiry sweep.
- `apps/api/src/sync/membership-expiry.integration.test.ts` — real-Postgres proof that only elapsed
  live grants are tombstoned and repeated sweeps do not rewrite tombstones.
- `packages/sync/test/sync-streams-rls-agreement.spec.ts` — cross-artifact proof that every stream
  consumes the tombstone the sweep produces, while no invalid `now()` reaches PowerSync.
- `.claude/rules/db.md` — "Sync rules are NOT RLS... replication bypasses the query path RLS
  protects," the general rule this instantiates.
- `apps/api/src/auth/token.service.ts`, `apps/api/src/sync/sync.controller.ts` — the token-mint
  path relevant to Option B.
