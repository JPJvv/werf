# STATUS — where this build actually is

> **Read this first, before planning anything.** It is the live pointer between sessions.
> `CLAUDE.md` links here. Update it at the end of every session and commit it with the work.

**Last updated:** 2026-07-26 (third session) · **Branch:** `phase-2/livestock` (tip = this commit; `30ac2b6` is the last feature commit below it)

---

## 1. Position

| | |
|---|---|
| **Phase 0** — scaffold | ✅ Merged to `main`. Repo public, CI green, branch protection on |
| **Phase 1** — auth, sync, onboarding | ✅ Merged to `main` as `9452ebc` (PR #2). **Three of its four named gaps are now closed** on `phase-2/livestock` — see §3 |
| **Phase 2** — livestock & crops | 🟡 **Code complete, all three review agents run and their findings FIXED, four more slices built since, NOT merged.** `pnpm verify` green: 73 files / 668 tests, bundle 124.82 KB gz. `pnpm test:e2e` green: 21 tests, 0 axe violations in both themes. **B8 is closed, so the exit-gate sentence is whole again** — see §2.1 |
| **Phase 3** — labour & wages 🇿🇦 | ⬜ Not started. **Critical path** |
| **Phases 4–7** | ⬜ Not started. Scope expanded 2026-07-25 (fuel + refund, photo flag, price board) |

**Working tree is clean. No stashes.**

```
main                   9452ebc   (Phase 0 + 1)
phase-2/livestock      THIS      ← HEAD is this docs commit; `30ac2b6` is the last
                                 feature commit below it. Pushed, no PR yet
docs/phase-3-6-scope   1331b60   pushed, no PR yet. Stacked on phase-2 @ 86f9330,
                                 so it is now BEHIND this branch by 14 commits
```

---

## 2. ⚠️ Decisions needed from JP before work continues

**These block the next session. Nothing below should be guessed.**

1. **Phase 2 PR — open it now?** ⭐ **Still the live one, and now with nothing outstanding.**
   All three agents ran and everything they found is fixed (§3). **B8 was built this session**, so
   the stock-theft clause is back in the exit-gate sentence and the gate reads true as written.
   Four more slices went in on top (§2b) and the gate is green after every one. Nothing is blocking
   the PR — it is your call on timing alone.
   → _Answer:_

2. **`docs/phase-3-6-scope` — rebase, or cherry-pick after the merge?**
   It is stacked on `phase-2/livestock` at the commit this session started from, so it is now ten
   commits behind. Its two commits are docs-only and would cherry-pick cleanly onto `main` after
   Phase 2 merges, which is the cleaner diff.
   → _Answer:_

3. **What is the next slice — the Phase 2 remainders, or the Phase 3 checklist?**
   `phase-checklists.md` still stops at Phase 2. Four of the named remainders are now closed
   (B8, B10, B11, B12); the rest are in §4 and are all genuinely optional for the phase to close.
   The sharpest one left is **B9 — a mob's head count can never change**, which is a hole a farmer
   walks into rather than a nicety, and it needs a server PATCH route, so it is a real slice.
   Phase 3 needs its checklist written before `/loop` has anything to consume.
   → _Answer:_

4. **🇿🇦 Has the labour-law review been booked?** It gates Phase 3 (sub-phase 3l) and is on someone
   else's calendar. Still open from the last session.
   → _Answer:_

5. **🇿🇦 Have the SA wage figures been re-verified against the current Gazette?**
   `legal-compliance.md §2.2` is dated July 2026 and self-describes as decaying. Phase 3 must not
   start against stale numbers. Still open from the last session.
   → _Answer:_

6. **Should the SAFEX / red-meat data licence conversations start now?** ADR-0009 says start them in
   Phase 4, for the same reason the legal review starts early. Still open from the last session.
   → _Answer:_

7. **NEW — phone-only invitations.** Email invitations are delivered now (FR-005). A phone-only
   invitation records the membership and reaches nobody, deliberately: SMS is ruled out for the same
   SIM-swap reason it is ruled out as a second factor, and an invitation link is credential-shaped.
   Is "handed over in person" the answer, or does this need a channel we do not operate yet?
   → _Answer:_

---

## 2b. Four slices built (2026-07-26, third session)

The gate ran green after every one. All four came off the named-remainder list in §4 rather than
from anywhere new; none of them widened the phase.

| Commit | What |
|---|---|
| `91d1103` | **Stock-theft client path (FR-603) — closes B8.** The whole server side had been done and tested since the first session and a farmer could not reach any of it: no route, no screen, no client API function. Two screens, because the two halves genuinely differ — FILING is a capture (local, instant, at a cut fence with no signal), and the PACK is not and cannot be (the PDF is rendered from the rows the SERVER holds, so before the incident is sent there is nothing to render). Rather than a button that 404s, the list says per incident which state it is in |
| `754c53f` | **A twin birth records two lambs (FR-104) — closes B11.** One calf was minted however many were born, while `multiples: 2` went on the event; the two facts contradicted each other in the same action |
| `b50ac9e` | **"Which capture, and why" (FR-009) — closes B12.** The strip could say "3 need your attention" and there was nowhere to look. Now there is, and each one is named by the number on the animal's ear |
| `30ac2b6` | **Head per camp (FR-705) — closes B10.** `summariseHerd`'s `byLandUnit` was computed, unit-tested, and read by nothing |

**Rules that came out of this session, worth not relearning:**

- **"Needs a connection" and "has no UI" are not the same sentence, and neither is "is refused" and
  "is lost".** Three of these four slices are the same shape: the app already KNEW something and
  had no way to say it. A computed number nothing renders, a refusal with no detail screen, a
  server capability with no route. Each read as missing functionality from the outside and was
  actually a missing sentence.
- **The outbox now publishes two things beyond its status**: the confirmed-sent id set, and the
  refused list with each item's kind, farmer-facing detail and the server's error code. The sent
  set gates exactly ONE thing — asking the server to produce a document — and must never gate a
  farmer's view of their own work, which is saved the moment it is in its local store.
- **A refusal reason is translated from the error CODE, never from the server's message.** Server
  messages are written in English; rendering one would hand an Afrikaans farmer a half-translated
  screen at the exact moment they most need to understand it. An unrecognised code says it cannot
  explain rather than guessing, because a wrong specific reason sends someone to fix what was
  never wrong.
- **A GPS fix that fails should stop once and then yield.** Refusing the record outright loses a
  theft report on a phone that cannot see the sky; filing silently hands over a weaker document
  with no sign anything was lost. Naming the reason, then filing on a second deliberate tap, is
  the only version that loses neither.

---

## 3. The review-agent pass (2026-07-26, second session)

`reviewer`, `sync-auditor` and `compliance-checker` were run over the whole branch in parallel.
**Everything below was found by an agent and FIXED in this session, not filed for later.** Two of
the three found the same top defect independently, which is the finding to trust most.

| # | What was wrong | Where |
|---|---|---|
| 1 | **One refused capture stranded every capture behind it, permanently.** The flush `return`ed on a server refusal instead of continuing. The queue rebuilds in the same FK order every round, so the poison item was always first: 60 tags captured in a crush, one with a misread duplicate digit, and nothing behind it could ever be sent again. Nothing in the UI could clear it. Found by `sync-auditor` **and** `compliance-checker` independently | `apps/web/src/sync/Outbox.tsx` |
| 2 | **Seven client-settable cross-farm foreign keys were unchecked** — `enterpriseId`, `brandId`, `parentId`, `incidentId` across animals, mobs, camps, theft incidents and events. The 2026-07-26 fix covered 4 of 11. Sharpest was `animals.brand_id`: a brand register IS the ownership claim an evidence pack rests on | `event-capture.ts`, `livestock.service.ts`, `land.service.ts` |
| 3 | **A whole-mob dip's meat withdrawal was invisible to the sale guard.** The guard filtered `events.animal_id` only, but a plunge dip — the canonical whole-flock operation — is captured against the MOB, so its `meatWithholdUntil` lands on an event with `animal_id = NULL`. Selling any individual out of a dipped flock passed silently the next day | `livestock.service.ts` |
| 4 | **The health screen stamped the treatment date with `now()`.** The server resolves the product registration in force on the treatment day (ADR-0005) and the client handed it the CAPTURE day — turning the whole dated lookup back into a `now()` lookup, and dating the treatment register wrong for any residue traceback that later reads it | `RecordHealthScreen.tsx` |
| 5 | **The capture screens were axe-audited in ONE theme** while three places claimed both. `WCAG_TAGS` includes `wcag2aa`, so axe runs `color-contrast` — the one rule whose result is theme-dependent. Dark contrast on all 13 screens was unchecked | `apps/web/e2e/a11y.spec.ts` |
| 6 | Two remaining instant→day conversions bypassed the farm's zone: the rainfall screen used the DEVICE's zone, and the reference endpoint defaulted `onDay` with `toISOString().slice(0,10)` — which between 00:00 and 02:00 SAST resolves the vet register a day early | `RecordRainfallScreen.tsx`, `reference.controller.ts` |
| 7 | **`LoggingMailer` wrote the invitee's address and the full invitation body to the log**, selected purely on `SMTP_HOST === undefined`. An unset variable in production silently turns every invitation into a log line with a credential-shaped link (POPIA s19). Production now refuses to boot instead | `mail.module.ts`, `mailer.ts` |

**Rules that came out of this pass, worth not relearning:**

- **A 4xx and a 5xx are different animals in a flush.** A 4xx is the server refusing this record on
  its merits — it will refuse it again tomorrow, so the item is set ASIDE (kept, never dropped) and
  the round continues. A 5xx or an unrecognised error is transient and aborts the round. Getting
  this backwards either strands the queue or quietly sets aside work the server never refused.
- **`insertEvent` is where a write-path invariant belongs**, not the twelve call sites. It already
  did `assertHerdScoped` for exactly this reason; the cross-farm reference check now lives beside
  it, so a capture written in a later phase inherits both instead of having to remember them.
- **A "one theme is enough" shortcut in an a11y test is only ever true of markup.** The moment the
  tag list includes `wcag2aa`, the audit is theme-dependent and the shortcut is a false claim.

**What was verified clean and should not be re-audited:** migrations 0008–0016 (every domain table
carries `farm_id` under `FORCE ROW LEVEL SECURITY`, no `DELETE` granted anywhere, all PKs client
UUIDv7, 0015/0016 correctly additive); `tenancy.spec.ts` genuinely derives its table list from the
drizzle schema and compares in both directions; no `navigator.onLine` in any write path; no
hardcoded regulated number anywhere on the branch; FR-602's window genuinely left unwired rather
than invented; capture authorship is audit logging, not the worker tracking ADR-0010 refused.

---

## 3b. The ten feature commits (2026-07-26, first session)

Ten commits on `phase-2/livestock`. The gate ran green after every one.

| Commit | What |
|---|---|
| `961e2d7` | **Camp create (FR-150)** — the dual-write now runs client→server: GeoJSON → canonical PostGIS geometry, proven against `ST_AsGeoJSON` |
| `2b722e9` | **Tag an animal (FR-109)** — crush-shaped session; an animal is now called by its NUMBER everywhere |
| `fb74d6e` | **Groups (FR-102)** — 300 head with zero animal rows; **plus a cross-farm FK hole closed** |
| `cc91a9b` | **Move (FR-103/112)** — batch by design; **a re-flushed move would have jammed the queue forever** |
| `434db44` | **Birth, weaning, purchase, missing (FR-104/111/106/605)** — GPS-anchored missing reports; farm-zone day handling |
| `d32451a` | **Health captures (FR-130/131/132/133)** — the clear date is on screen in the crush |
| `e5fc018` | **Withdrawal guard at capture (FR-131)** — the rule now reaches the person who can still act on it |
| `4a492b9` | **Read models + tiles (FR-705/017/213)** — class breakdown, "N withholding" badge, season rainfall |
| `b725a08` | **Farm switcher + add a farm (FR-004)** — Phase 1 gap closed |
| `9f4a209` | **Invitation delivery (FR-005)** — provider-agnostic `Mailer` port, Phase 1 gap closed |

**Four real defects were found by tests rather than confirmed by them. Do not re-introduce these:**

1. **Animals could reference a NEIGHBOUR'S camp.** `animals.land_unit_id` has no farm qualifier and
   Postgres runs referential checks as the system, so RLS does not filter them; a WITH CHECK policy
   validates the row's own `farm_id` and says nothing about what its columns point at. Closed by
   `assertOwnedReferences`. Every new FK to a farm-scoped table needs the same treatment.
2. **A re-flushed move jammed the whole queue.** The flush is at-least-once; on the retry the animal
   is already at the destination, so the domain correctly refuses "a move that changes nothing", the
   outbox never marks it sent, and every later capture stalls behind a write that succeeded. Any
   capture that CHANGES THE STATE ITS OWN VALIDATION READS must check idempotency BEFORE validating
   (`findEvent`). Death and sale are safe today only because they do not touch the animal row.
3. **A read model crashed the Animals screen** on a stored animal with no `dob` FIELD — which is
   what a row written by an older client looks like, and a farmer can be six weeks behind an update.
   Read models over persisted client data must be defensive at that boundary.
4. **`toISOString().slice(0,10)` is wrong for two hours a day in South Africa.** All instant→day
   conversion now goes through `farmTime` in the FARM's zone.

**Three decisions taken this session that should not be relitigated:**

- **The Health tile carries "N withholding", not "N due".** A due/overdue count needs a vaccination
  programme schedule that does not exist. A tile carrying a number the app cannot compute is worse
  than a tile carrying none — FR-017 exists to make a tile an instrument, not a menu item.
- **No SMS, anywhere.** Not for a second factor (already decided), and not for an invitation link
  either. Same reasoning, same industrialised SIM-swap risk.
- **`createReferenceCache` is a sibling of the capture store, not a widening of it.** A capture store
  is append-only because it holds a farmer's work; adding `replace` to it would hand every capture
  path a method that can erase that work.

---

## 4. Known gaps — carried forward, not forgotten

**Owed before the Phase 2 PR:** (A1–A3 done; A4–A5 still open)

| # | Gap |
|---|---|
| A1 | ✅ **`reviewer` run 2026-07-26.** Findings fixed, not filed — see §3 |
| A2 | ✅ **`sync-auditor` run 2026-07-26.** Findings fixed — see §3 |
| A3 | ✅ **`compliance-checker` run 2026-07-26** over the new gated work. Findings fixed — see §3 |
| A4 | **CI green on `main`** — still impossible until the PR exists (CI does not run on feature branches) |
| A6 | ⚠️ **The four slices in §2b have NOT been through the review agents.** A1–A3 were run over the branch as it stood at `a6c8eff`; everything after that is unreviewed. Two of the four touch the write path (`Outbox.tsx` gained per-item kind/detail; the theft capture is a new queue entry with cross-farm references the server checks) and one is compliance-gated (FR-603, POPIA s26). Run all three ONCE over the lot before the PR — not per slice |
| A5 | **The verify gate is fragile under container contention.** `reviewer`'s run failed on a testcontainers `HealthCheckWaitStrategy` timeout (120 s, hardcoded in the library) because it ran `pnpm verify` at the same time as the main session. Isolated runs are green. But `vitest.workspace.ts`'s `maxWorkers: 4` / `hookTimeout: 60_000` do NOT bound that particular timeout, and the gate has now flaked three times (`20bc60a`, `31ce6b8`, this). Worth raising the health-check timeout or sharing one container across `packages/db` suites before it costs a CI run |

**Named Phase 2 remainders (the phase can close without them; they are not silent):**

| # | Gap |
|---|---|
| B1 | **FR-120/121 mating + pregnancy diagnosis** — domain logic done, API and screens not started. Needs species-gestation reference data, which does not exist |
| B2 | **FR-108 photos** — `photo_key` exists; the local store and deferred upload do not |
| B3 | **FR-107 species-specific attributes** — the JSONB column and GIN index exist; the per-species validator behind the ADR-0006 seam does not |
| B4 | **FR-132 due/overdue** — needs a vaccination programme schedule |
| B5 | **FR-602 unmarked-past-window flag** — the domain function is done and tested, but the prescribed window is dated reference data `regulatory_rates` does not carry, and inventing it in code is exactly the defect the domain rules forbid |
| B6 | **FR-014/014c passkey enrolment + management from the client** — the last open Phase 1 gap. API ceremonies complete and tested; the client enrols TOTP only |
| B7 | Smaller: sale WEIGHT not on screen; dose value/unit/route not on the health screen; dip method not on screen; walking a camp boundary by GPS (the API accepts and converts one, nothing produces one) |
| B8 | ✅ **CLOSED 2026-07-26 (`91d1103`).** The client path exists: `/animals/theft` and `/animals/theft/new`. The exit-gate clause is restored to the sentence, worded to name both halves — filing is offline, the pack is not |
| B9 | ⭐ **The sharpest one left.** FR-102 is CREATE-only — a mob's head count can never change. No PATCH route for a mob, and `recordDeath`/`recordSale` both require an `animalId`. A 300-head flock cannot become 297 by any path in the product. This is a hole a farmer walks into, not a nicety; it needs a server route, so it is a real slice. Checklist line downgraded ☑→◐ |
| B10 | ✅ **CLOSED 2026-07-26 (`30ac2b6`).** Each camp on `/land` carries its live head, groups included. Checklist line restored ◐→☑ |
| B11 | ✅ **CLOSED 2026-07-26 (`754c53f`).** One birth event per calf, each carrying the multiple count; per-calf sex and weight |
| B12 | ✅ **CLOSED 2026-07-26 (`b50ac9e`).** `/not-sent`, reached from the strip only when there is something to see. No delete button, deliberately: a refusal clears when its CAUSE clears |

**Older carry-forwards, still open:**

| # | Gap |
|---|---|
| G1 | **`pnpm test:trace` does not exist.** `functional-requirements.md` claims it fails CI when a P1/P2 FR has no covering test. Write it, or soften the claim |
| G2 | **`phase-checklists.md` stops at Phase 2.** Blocks `/loop` for Phase 3+ |
| G3 | **Equipment register (FR-504) has no table.** `vehicles` carries a comment to add `equipment_id` additively. Phase 4i |
| G4 | **`user-guide.md` and `ux-design-system.md` not updated** for the 2026-07-25 scope, nor for this session's ten new screens. The **grievance flow needs real UX care** when it lands |
| G5 | **CI never runs on feature branches.** Green locally ≠ green in CI until the PR opens |

---

## 5. How to resume

```
Read STATUS.md, CLAUDE.md, and docs/04-delivery/phase-checklists.md.
Answer the decisions in STATUS.md §2 with me before planning.
A1-A3 are DONE — all three review agents ran and their findings are fixed (§3).
B8, B10, B11 and B12 are DONE — four slices, §2b. The exit-gate sentence is
whole again and the gate reads true as written.

Nothing blocks the Phase 2 PR. Either open it, or take B9 first — a mob's head
count still cannot change, which is the one remaining gap a farmer walks INTO
rather than merely misses. Note the four new slices have NOT been through the
review agents; if B9 or anything else lands, run all three once over the lot
rather than per slice.
```
