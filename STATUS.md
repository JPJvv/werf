# STATUS — where this build actually is

> **Read this first, before planning anything.** It is the live pointer between sessions.
> `CLAUDE.md` links here. Update it at the end of every session and commit it with the work.

**Last updated:** 2026-07-26 · **Branch:** `phase-2/livestock` @ `9f4a209`

---

## 1. Position

| | |
|---|---|
| **Phase 0** — scaffold | ✅ Merged to `main`. Repo public, CI green, branch protection on |
| **Phase 1** — auth, sync, onboarding | ✅ Merged to `main` as `9452ebc` (PR #2). **Three of its four named gaps are now closed** on `phase-2/livestock` — see §3 |
| **Phase 2** — livestock & crops | 🟡 **Code complete and the gate sentence is now TRUE, NOT merged.** `pnpm verify` green: 72 files / 645 tests, bundle 119.19 KB gz. `pnpm test:e2e` green: 20 tests, 0 axe violations |
| **Phase 3** — labour & wages 🇿🇦 | ⬜ Not started. **Critical path** |
| **Phases 4–7** | ⬜ Not started. Scope expanded 2026-07-25 (fuel + refund, photo flag, price board) |

**Working tree is clean. No stashes.**

```
main                   9452ebc   (Phase 0 + 1)
phase-2/livestock      9f4a209   ← HEAD, pushed, no PR yet
docs/phase-3-6-scope   1331b60   pushed, no PR yet. Stacked on phase-2 @ 86f9330,
                                 so it is now BEHIND this branch by 10 commits
```

---

## 2. ⚠️ Decisions needed from JP before work continues

**These block the next session. Nothing below should be guessed.**

1. **Phase 2 PR — open it now?**
   The review agents have NOT been run (see §4). The plan of record was `reviewer` + `sync-auditor`
   first. That is the first action of the next session unless you say otherwise.
   → _Answer:_

2. **`docs/phase-3-6-scope` — rebase, or cherry-pick after the merge?**
   It is stacked on `phase-2/livestock` at the commit this session started from, so it is now ten
   commits behind. Its two commits are docs-only and would cherry-pick cleanly onto `main` after
   Phase 2 merges, which is the cleaner diff.
   → _Answer:_

3. **What is the next slice — the Phase 2 remainders, or the Phase 3 checklist?**
   `phase-checklists.md` still stops at Phase 2. The Phase 2 remainders are named in §4 and are all
   genuinely optional for the phase to close; Phase 3 needs its checklist written before `/loop`
   has anything to consume.
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

## 3. This session's output (2026-07-26)

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

**Owed before the Phase 2 PR:**

| # | Gap |
|---|---|
| A1 | **`reviewer` has not been run.** First action of the next session |
| A2 | **`sync-auditor` has not been run** over migrations 0015–0016, `assertOwnedReferences`, or the derived tenancy table list |
| A3 | **`compliance-checker` has not been run over the NEW gated work**: the client withdrawal guard, the reference-data endpoint, the missing-report GPS requirement. It did pass on the earlier gated slices |
| A4 | **CI green on `main`** — impossible until the PR exists (CI does not run on feature branches) |

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
Unless told otherwise, start with §4 A1–A3: run reviewer, sync-auditor and
compliance-checker over phase-2/livestock, fix what they find, then open the PR.
```
