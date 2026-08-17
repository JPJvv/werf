# Capture-store migration: localStorage → SQLite/OPFS

**Date:** 2026-08-09 | **Status:** RESOLVED — 12 capture stores migrated, two regressions found
and closed in the same slice | **Branch:** `phase-3/powersync-foundation`

## Summary

`packages/sync/src/capture-store.ts`'s localStorage-backed `CaptureStore<T>` now has a
SQLite/OPFS-backed sibling, `createSqliteCaptureStore` (`packages/sync/src/sqlite-capture-store.ts`).
All 12 `apps/web/src/**/Local*.tsx` providers (tallies, herd, mobs, identifiers, weights,
lifecycle events, moves, health events, breeding events, theft incidents, rainfall, land units,
boundary walks) switched to it. This is Phase 3 checklist item 3c: "existing localStorage
captures migrate transactionally into SQLite on upgrade."

What did **not** change: `uploadData` still throws (no per-table upload route — 3d), the existing
`Outbox.tsx` still flushes captures to the `/api/*` REST endpoints exactly as before, `sent-log.ts`
and `draft-store.ts` stay on localStorage (no atomicity requirement applies to either), and
`.connect()` remains diagnostics-only.

## Migration mechanism

One generic local-only table, `capture_records` (`store_key`, `farm_id`, `seq`, `payload_json`),
plus a marker table `capture_migrations` (row presence = migrated), both defined in
`packages/sync/src/capture-schema.ts` and merged into the schema `local-database.ts` opens.
`localOnly: true` keeps every row out of PowerSync's CRUD upload queue — captures here are never
picked up by a future `uploadData` as if they were a queued sync write; the Outbox stays the sole
uploader this slice.

Per `store_key`, on first construction of a `createSqliteCaptureStore`:
1. Check `capture_migrations` for a marker row (fast path if present — legacy localStorage is not
   even read).
2. If absent: read the legacy localStorage array, then in one `writeTransaction`, insert every
   record into `capture_records` (`seq` = array index, preserving append order) and insert the
   marker row. The marker check is re-run **inside** the transaction (`BEGIN IMMEDIATE` serializes
   writers) — closing a TOCTOU window `main.tsx`'s `StrictMode` opens in development, where two
   store instances for the same key can each pass the fast-path check before either has written
   anything.
3. Hydration reads `capture_records` back and **merges** with any records already `append()`ed to
   the in-memory store during the (real, asynchronous) hydration window, never replaces — an
   append made while hydration is still running would otherwise be silently dropped.

localStorage is read-only in this whole flow. It is never written or cleared.

## Two regressions found and closed in this slice

Neither was anticipated by the plan; both were found empirically before this slice was called
done, and both are real correctness bugs a farmer would have hit, not test artifacts.

### 1. The Outbox could flush against a partially-hydrated world — a live wire-order violation

**Found by:** `apps/web/src/sync/Outbox.test.tsx`'s dose-before-disposal tests failing after the
store swap, with a dip posting six requests after the tally it exists to guard.

Each of the 12+1 stores `Outbox.tsx` reads hydrates independently and asynchronously. The first
store to finish (in the failing repro, `tallies`) made `pendingCount > 0`, and the flush effect
fired against a queue built while `health`/`moves` were still `[]`. An unhydrated store's `all()`
is indistinguishable from "this farm genuinely has none of these" to every `guardedBy`/`needsHead`
check — a dip that has not hydrated yet cannot taint the tally it is meant to guard, because from
the queue's point of view the dip does not exist. The tally posted, got its 201, joined the
sent-log; the dip hydrated later and posted after it. This is the same defect class the ninth pass
and the fifth pass both found (evidence must precede the act it guards), reached through a
mechanism none of those passes could have seen, because none of them had asynchronous local
hydration to reason about.

**Fix:** `CaptureStore<T>` gained a fourth method, `settled(): boolean` — true immediately for the
localStorage-backed store (construction is synchronous), false until the SQLite-backed store's
hydration *attempt* completes, on **either** outcome (see `sqlite-capture-store.ts`'s own header
on why success-only signalling would hang a waiter forever on a failed boot). This widens the seam
interface the original plan for this slice froze — recorded here as a deliberate, discovered
supersession of that constraint, not a silent scope change. It maps cleanly onto the PowerSync
endgame: watched queries have the identical "not ready yet" concept.

Each of the 12 providers gained a matching `use<X>Settled()` hook. `Outbox.tsx` now calls all 13
unconditionally (never short-circuited with `&&` between the hook calls themselves — that would
vary how many hooks the component calls between renders and break React's own rules, not just this
feature) and ANDs the results into `allSettled`, which gates:
- **The flush effect** — `if (online && allSettled && pendingCount > 0)`. `pendingCount` climbing
  from 0 as stores settle one at a time re-fires the effect on its own; no separate "now everything
  is ready" signal was needed.
- **The `'synced'` status** — without this, `pendingCount` reads 0 before hydration (nothing has
  loaded yet, not "confirmed nothing pending"), and the strip would tell a farmer "Saved and sent"
  on ground the device has not finished checking. There is no dedicated loading `SyncStatus`;
  `'syncing'` is reused as the closest honest word, and it self-corrects within the same render
  pass once the last store settles.

A settled store that failed to hydrate is a documented residual risk, not solved further here: it
settles with only same-session appends visible, and a flush could still miss DB-resident evidence
that failed to load. The alternative — never settling — strands the queue forever, which is worse.

**Proof:** the three Outbox tests that originally caught this are the repro; they went green with
no other change once the gate landed. `packages/sync/test/capture-store.spec.ts` and
`sqlite-capture-store.spec.ts` both gained a `settled()` test, including "flips true on a FAILED
hydration too."

### 2. Mount-time snapshots of capture data froze on an empty herd forever

**Found by:** the same investigation, generalised — a repo-wide grep for `useState(() => ...)`
reading capture-store hooks.

`TagSessionScreen.tsx` and `WeaningSessionScreen.tsx` both build a FIXED work queue once, at mount
(`useState(() => live.filter(...))`), deliberately not recomputed on every render — recomputing
would shrink the queue under a farmer's thumb as they work down a race, which is correct product
behaviour. That correctness depended on construction being synchronous: under Phase 2 (localStorage),
`live`/`labels` were already final by first render, so "snapshot at mount" and "snapshot once
hydration settles" were the same moment. They are no longer the same moment, and the mount-time
snapshot now permanently freezes on whatever partial, still-hydrating data existed at that instant
— on every cold start with a queue to work through, not an edge case.

**Fix:** both screens now wait for a `readyToOpen` flag (the AND of every store their queue is
built from — `useEffectiveAnimalsSettled()`, added to `herd.ts`, plus `useIdentifiersSettled()`
for tagging) before capturing the queue, via a `useEffect` keyed only on `readyToOpen` (not on
`live`/the filter inputs — it must fire exactly once). Both screens show a new `tag.loading` /
`wean.loading` string ("Reading the herd…") while waiting, distinct from the existing `tag.empty` /
`wean.empty` copy, which claims something true only once that read is done — showing the empty
copy prematurely would have been the same class of lie the Outbox status fix closes.

## Bundle budget (NFR-009) — the engine is precached, not on the interactive path

The main app is the first caller of `createLocalDatabase()` — 12 providers all need a live
database. A spike (dynamic `import('@werf/sync/local-database')` from `main.tsx`, before any real
wiring) confirmed the risk `packages/sync/src/index.ts`'s own comment already flagged: the SDK's
WASM engine (four VFS variants, sync/async × single/multi-connection, ~7MB raw / ~2.7MB gz
combined — the SDK feature-detects between them at runtime, so Rollup cannot eliminate the others)
blew both the Workbox precache ceiling (2MiB default, largest single asset 2.5MB) and would have
blown the 250KB interactive-path JS budget if counted there.

**Decision (owner-confirmed 2026-08-09):** precache the engine rather than fetch it on demand.
`apps/web/vite.config.ts` raises `workbox.maximumFileSizeToCacheInBytes` to 4MiB.
`apps/web/scripts/check-bundle-size.mjs` now excludes a named, closed set of engine chunk
basenames (`ENGINE_CHUNK_BASENAMES`) from the interactive-path JS-gz sum and reports their total
separately — a narrow exclusion, not "lazy chunks are free"; a future code-split of actual app code
still counts in full. Runtime-cache-on-demand was rejected: an evicted runtime-cache entry, met by
a farmer in a dead zone with a migration marker already committed, is exactly the "half of each"
state 3c exists to prevent. Precaching means the engine is guaranteed present the moment a build
activates at all, because Workbox only flips over once its full precache list has downloaded.

**Numbers (2026-08-09 build):**
| | Before this slice | After |
|---|---|---|
| Interactive-path JS (gated, fails the build over 250KB) | 151.67 KB gz | 153.34 KB gz |
| Precached engine (new category, not gated) | — | 195.86 KB gz |
| Precache manifest total | ~584 KB | ~8.3 MB |

The ~8.3MB precache is a one-time cost on install/update — during an SW install, which already
needs a network — never on a capture. Future slices (3i attachments, especially) budget against
the 153.34 KB interactive-path number, not the precache total.

## 12-month-offline / rollback

**A device that never completes an SW install for a build containing this migration never runs
it.** Workbox only activates a new build once its full precache list — including the
now-precached engine — has downloaded. Such a device keeps working against its last-installed
build and the localStorage-backed store indefinitely, with zero partial-migration risk, because
the migration code never executes there. When it eventually gets enough connectivity to complete
an SW install, migration runs then, against that day's localStorage contents — not against
whatever was on the device the day this build shipped.

**Rollback asymmetry.** Once a device *has* migrated, its localStorage for a given key is a frozen
snapshot as of migration day — real, but stale the moment any post-migration capture happens
(captures land in SQLite only, from then on). A build rolled back after that point will not show
captures made after migration day, even though the Outbox (unchanged) may already have sent some
of them to the server. This is an asymmetry for support to know about, not data loss: the server
may hold records a rolled-back client no longer displays.

**Manual recovery.** Every localStorage key (`werf-<name>:<farmId>`) remains exactly where it was,
readable via devtools, for as long as the device holds it — this migration never deletes or
overwrites it.

## Evidence trail

- `packages/sync/src/sqlite-capture-store.ts` — the store, migration routine, `settled()`.
- `packages/sync/src/capture-schema.ts` — `capture_records`/`capture_migrations`, `localOnly`.
- `packages/sync/test/sqlite-capture-store.spec.ts` — hydration-merge, migration atomicity
  (interruption + retry), the marker race under concurrent construction, `settled()` on both
  outcomes — against `packages/sync/src/testing.ts`'s `createFakeLocalDatabase`.
- `apps/web/e2e/capture-migration.spec.ts` — the same migration against the real engine: clean
  end-to-end migration with order preserved, localStorage left untouched, and a second cold start
  as a no-op.
- `apps/web/src/sync/Outbox.tsx` — the `allSettled` gate (flush effect + `'synced'` status);
  `Outbox.test.tsx`'s dose-before-disposal tests are the regression's own repro.
- `apps/web/src/livestock/TagSessionScreen.tsx`, `WeaningSessionScreen.tsx`,
  `apps/web/src/livestock/herd.ts` (`useEffectiveAnimalsSettled`) — the mount-time-snapshot fix.
- `apps/web/scripts/check-bundle-size.mjs`, `apps/web/vite.config.ts` — the precache/budget split.
- `.claude/rules/db.md`, `.claude/rules/frontend.md` — the standing rules this migration must
  keep holding: the queue is never discarded, local writes are synchronous from the caller's
  perspective (NFR-007).
