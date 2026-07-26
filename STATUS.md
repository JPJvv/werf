# STATUS — where this build actually is

> **Read this first, before planning anything.** It is the live pointer between sessions.
> `CLAUDE.md` links here. Update it at the end of every session and commit it with the work.

**Last updated:** 2026-07-26 (fourth session) · **Branch:** `phase-2/livestock` (tip = this commit; `5e279b1` is the last feature commit below it)

> **Gate note, and it matters more than it looks:** the e2e lane was reporting green against a stale
> bundle until this session. Fixed — see §4 A7. If you see e2e fail and then pass on a re-run, that
> is not a flake and it is not this bug either; read A7 before assuming.

---

## 1. Position

| | |
|---|---|
| **Phase 0** — scaffold | ✅ Merged to `main`. Repo public, CI green, branch protection on |
| **Phase 1** — auth, sync, onboarding | ✅ Merged to `main` as `9452ebc` (PR #2). **All four of its named gaps are now closed** — the last one, client passkey enrolment + management, went in this session. Phase 1 has no open gaps |
| **Phase 2** — livestock & crops | 🟡 **Code complete, NOT merged.** `pnpm verify` green: 77 files / 741 tests, bundle 133.59 KB gz. `pnpm test:e2e` green: 25 tests, 0 axe violations in both themes. Every checklist line is ☑ or ◐ with its remainder named, so **the exit gate reads true as written** |
| **Phase 3** — labour & wages 🇿🇦 | ⬜ Not started. **Critical path** |
| **Phases 4–7** | ⬜ Not started. Scope expanded 2026-07-25 (fuel + refund, photo flag, price board) |

**Working tree is clean. No stashes.**

```
main                   9452ebc   (Phase 0 + 1)
phase-2/livestock      THIS      ← HEAD is this docs commit; `5e279b1` is the last
                                 feature commit below it. Pushed, no PR yet
docs/phase-3-6-scope   1331b60   pushed, no PR yet. Stacked on phase-2 @ 86f9330,
                                 so it is now well behind this branch
```

---

## 2. ⚠️ Decisions needed from JP before work continues

**These block the next session. Nothing below should be guessed.**

1. **Phase 2 PR — open it now?** ⭐ **Still the live one.**
   Nothing in the phase blocks it. The one thing OWED first is the review-agent pass over the nine
   unreviewed feature commits (§4 A6) — deferred this session on your instruction, because the three
   agents are heavy on token usage. Your call whether to run them before the PR or accept the risk.
   → _Answer:_

2. **`docs/phase-3-6-scope` — cherry-pick after the merge.** ✅ **ANSWERED 2026-07-26:** cherry-pick.
   ⚠️ One correction to the earlier note: the branch has **three** commits, not two. `85ffaa7` and
   `86b40c9` are the docs-scope work and cherry-pick cleanly. The third, `1331b60`, adds `STATUS.md`
   — which `phase-2/livestock` now also carries and has since rewritten (195 insertions / 54
   deletions apart), so it will conflict. Drop it or resolve by hand; nothing in it is still wanted.

3. **What is the next slice?** The Phase 2 remainders that CAN be built are down to two: **FR-120/121
   breeding screens** (§4 B1 — the biggest, and it needs a `species_gestation` reference table) and
   **walking a camp boundary by GPS** (§4 B7). Everything else left is blocked on something that
   does not exist yet, named honestly in §4. Phase 3 still needs its checklist written before
   `/loop` has anything to consume.
   → _Answer:_

4. **🇿🇦 Has the labour-law review been booked?** It gates Phase 3 (sub-phase 3l) and is on someone
   else's calendar. Open since the second session.
   → _Answer:_

5. **🇿🇦 Have the SA wage figures been re-verified against the current Gazette?**
   `legal-compliance.md §2.2` is dated July 2026 and self-describes as decaying. Phase 3 must not
   start against stale numbers. Open since the second session.
   → _Answer:_

6. **Should the SAFEX / red-meat data licence conversations start now?** ADR-0009 says start them in
   Phase 4, for the same reason the legal review starts early. Open since the second session.
   → _Answer:_

7. **Phone-only invitations.** Email invitations are delivered now (FR-005). A phone-only invitation
   records the membership and reaches nobody, deliberately: SMS is ruled out for the same SIM-swap
   reason it is ruled out as a second factor, and an invitation link is credential-shaped. Is
   "handed over in person" the answer, or does this need a channel we do not operate yet?
   → _Answer:_

8. **NEW — object storage.** FR-108 photos cannot be built without it, and it is not a design
   question but a missing tier: `architecture.md` plans presigned direct-from-client upload to S3
   in af-south-1 and none of it exists. It also blocks storing generated evidence packs. Does this
   become a Phase 3 infrastructure slice, or does it wait?
   → _Answer:_

---

## 2b. Four slices built (2026-07-26, fourth session)

The gate ran green after every one. All four came off the named-remainder list in §4; none widened
the phase. **The three review agents were deliberately NOT run — see §4 A6.**

| Commit | What |
|---|---|
| `06884c7` | **A flock of 300 can become 297, and say why (FR-102) — closes B9.** The last gap a farmer walked INTO rather than merely missed. A group-only mob has no `animals` rows, and every way out of the herd is recorded against an `animals.id`, so a flock created at 300 stayed 300 through a lambing, a drought and an abattoir run |
| `00f1016` | **Sale weight, dose value/unit/route, dip method (FR-106/130/133) — closes most of B7.** Four fields that existed in the payload schema, on the wire and in the server's write path, and that no screen ever asked for — so all four were null in every record the product had produced |
| `bb17b24` | **Passkeys from the client (FR-014/014c) — closes B6, the last Phase 1 gap.** Enrolment, sign-in, and Settings → Security to list/add/revoke |
| `5e279b1` | **A cow has horns and a sheep has wool (FR-107) — closes B3.** The `attributes` JSONB has existed since migration 0009 with nothing validating a byte of it |

**Rules that came out of this session, worth not relearning:**

- **Deltas compose; an edited field does not.** Two people each record three deaths on their own
  phone in a dead zone. Deltas land on 294, which is the truth; an edited head count is
  last-write-wins, lands on 297, and silently keeps three dead sheep in the count with nothing
  anywhere to show what was lost. Any number this product lets a farmer change needs this question
  asked of it, because two offline devices is the normal case here, not the edge case.
- **A RECOUNT is the one absolute, and it resets rather than adds.** "I walked the camp and counted
  297" is a stronger fact than arithmetic on a number just shown to be wrong. It cannot be modelled
  as a delta: that would need the device to know the true previous count, which is exactly what the
  farmer has just discovered it did not.
- **Arrival order is not `occurred_at` order, and a server that steps a stored value by each
  incoming delta will be wrong.** The tally count is RE-DERIVED from the whole log over an immutable
  baseline (`mobs.initial_head_count`), so the server and the offline client run the identical
  projection and cannot drift. This is the general shape for any denormalised aggregate this product
  adds later.
- **A field that exists everywhere except on a screen is null in every record you have.** Four of
  them this session. The schema, the wire contract and the server write path all carried sale
  weight, dose, route and dip method; the data has none of it, because nothing ever asked.
- **A hand-written duplicate of a schema drifts silently and in one direction.** The client's dip
  `method` type offered `'injectable'`, which the server refuses. It had never fired because the
  field was on no screen — the moment it appeared, a plausible choice would have queued a capture
  that could never be sent, and it would have read as a sync bug rather than a typo in a type.
- **Ask whether the device CAN before offering the button, not after.** A mandatory-2FA screen
  offering only a passkey to a browser with no authenticator is a dead end for someone with no other
  route into their own account.
- **`NotAllowedError` is a cancellation, not a failure.** The WebAuthn spec uses it for both
  "dismissed" and "timed out" and withholds which, so a site cannot probe what a person did.
  Treating it as an error puts a red panel in front of someone who tapped the wrong thing — and, on
  sign-in, would spend a challenge token they never actually spent.
- **Not every seam is the seam it looks like.** FR-107 was pencilled in behind ADR-0006's
  `AnimalIdentityRules`. That seam is for what the LAW varies; a horn is a horn in Namibia. Putting
  a husbandry vocabulary behind a jurisdiction interface is the mirror image of the mistake ADR-0006
  warns about — shared biology leaking into a jurisdiction pack instead of a statute leaking into
  shared code.
- **Refusing to half-build is a decision, not a delay.** FR-108 photos and FR-120/121 breeding were
  both left alone on purpose (§4). The photo case is the sharp one: building only the local half
  would set `photo_key` with no image behind it, and `evidence-pack.pdf.ts` prints "Photograph on
  file: Yes" off exactly that field — the pack would claim a photograph the Stock Theft Unit cannot
  be shown.

---

## 3. The review-agent pass (2026-07-26, second session)

`reviewer`, `sync-auditor` and `compliance-checker` were run over the whole branch **as it stood at
`a6c8eff`**, in parallel. Everything below was found by an agent and FIXED in that session, not filed
for later. Two of the three found the same top defect independently, which is the finding to trust
most.

| # | What was wrong | Where |
|---|---|---|
| 1 | **One refused capture stranded every capture behind it, permanently.** The flush `return`ed on a server refusal instead of continuing. The queue rebuilds in the same FK order every round, so the poison item was always first: 60 tags captured in a crush, one with a misread duplicate digit, and nothing behind it could ever be sent again. Found by `sync-auditor` **and** `compliance-checker` independently | `apps/web/src/sync/Outbox.tsx` |
| 2 | **Seven client-settable cross-farm foreign keys were unchecked** — `enterpriseId`, `brandId`, `parentId`, `incidentId` across animals, mobs, camps, theft incidents and events. Sharpest was `animals.brand_id`: a brand register IS the ownership claim an evidence pack rests on | `event-capture.ts`, `livestock.service.ts`, `land.service.ts` |
| 3 | **A whole-mob dip's meat withdrawal was invisible to the sale guard.** The guard filtered `events.animal_id` only, but a plunge dip — the canonical whole-flock operation — is captured against the MOB, so its `meatWithholdUntil` lands on an event with `animal_id = NULL` | `livestock.service.ts` |
| 4 | **The health screen stamped the treatment date with `now()`**, turning ADR-0005's dated product lookup back into a `now()` lookup | `RecordHealthScreen.tsx` |
| 5 | **The capture screens were axe-audited in ONE theme** while three places claimed both. `WCAG_TAGS` includes `wcag2aa`, so axe runs `color-contrast` — the one rule whose result is theme-dependent | `apps/web/e2e/a11y.spec.ts` |
| 6 | Two remaining instant→day conversions bypassed the farm's zone: the rainfall screen used the DEVICE's zone, and the reference endpoint defaulted `onDay` with `toISOString().slice(0,10)` | `RecordRainfallScreen.tsx`, `reference.controller.ts` |
| 7 | **`LoggingMailer` wrote the invitee's address and the full invitation body to the log**, selected purely on `SMTP_HOST === undefined` (POPIA s19). Production now refuses to boot instead | `mail.module.ts`, `mailer.ts` |

**Rules that came out of that pass:**

- **A 4xx and a 5xx are different animals in a flush.** A 4xx is the server refusing this record on
  its merits — it will refuse it again tomorrow, so the item is set ASIDE (kept, never dropped) and
  the round continues. A 5xx or an unrecognised error is transient and aborts the round.
- **`insertEvent` is where a write-path invariant belongs**, not the twelve call sites.
- **A "one theme is enough" shortcut in an a11y test is only ever true of markup.**

**What was verified clean and should not be re-audited:** migrations 0008–0016 (every domain table
carries `farm_id` under `FORCE ROW LEVEL SECURITY`, no `DELETE` granted anywhere, all PKs client
UUIDv7); `tenancy.spec.ts` genuinely derives its table list from the drizzle schema and compares in
both directions; no `navigator.onLine` in any write path; no hardcoded regulated number anywhere on
the branch; capture authorship is audit logging, not the worker tracking ADR-0010 refused.

---

## 3b. Earlier sessions

- **Fourteen feature commits** before this session (see git log from `0194939` to `30ac2b6`). The
  four from the third session closed B8 (stock-theft client path, FR-603), B11 (a twin birth records
  two lambs, FR-104), B12 (which capture the server refused, and why, FR-009) and B10 (head per
  camp, FR-705).
- **Four real defects were found by tests rather than confirmed by them, and must not return:**
  animals could reference a NEIGHBOUR'S camp (closed by `assertOwnedReferences`); a re-flushed move
  jammed the whole queue (any capture that CHANGES THE STATE ITS OWN VALIDATION READS must check
  idempotency BEFORE validating — the FR-102 tally follows this rule for the same reason); a read
  model crashed the Animals screen on a stored animal with no `dob` FIELD; and
  `toISOString().slice(0,10)` is wrong for two hours a day in South Africa.
- **Three decisions not to relitigate:** the Health tile carries "N withholding", not "N due"; no
  SMS anywhere, ever; `createReferenceCache` is a sibling of the capture store, not a widening of it.

---

## 4. Known gaps — carried forward, not forgotten

**Owed before the Phase 2 PR:**

| # | Gap |
|---|---|
| A1–A3 | ✅ All three agents run 2026-07-26 over the branch at `a6c8eff`. Findings fixed, not filed — §3 |
| A4 | **CI green on `main`** — still impossible until the PR exists (CI does not run on feature branches) |
| A6 | ⚠️ **NINE feature commits are UNREVIEWED.** `91d1103`, `754c53f`, `b50ac9e`, `30ac2b6` (third session) and `06884c7`, `00f1016`, `bb17b24`, `5e279b1` (fourth). Several touch the write path — the FR-102 tally adds a new queue entry, a new event type, two migrations and a denormalised aggregate; the passkey work touches auth. Two are compliance-gated (FR-603, FR-014c/POPIA). **Deferred on JP's instruction (token cost), not because it is done.** Run all three ONCE over the lot before the PR, not per slice |
| A7 | ✅ **FIXED 2026-07-26 — the e2e lane could report green against code that no longer existed.** `vite preview` serves `dist`, and `turbo.json`'s `build` task declared no `outputs`, so turbo cached only LOGS: a cache hit printed "FULL TURBO" and wrote no files, leaving whatever bundle was already on disk. Proven rather than theorised — a screen's heading was replaced with a literal and the suite stayed 25-green, then kept FAILING for five consecutive runs after the source was restored, because the broken bundle was never replaced either way. Two changes: `outputs: ["dist/**"]` in `turbo.json`, and `pnpm test:e2e` now builds first (turbo-cached, so free when nothing changed). Verified in both directions — breaking a heading now fails 2 tests, restoring it returns 25 green. **This is why the earlier "2 failed then clean on a re-run" was never a flake; do not re-diagnose it as one.** |
| A8 | ⚠️ **ONE unexplained unit-suite failure, cause unknown — do not dismiss it.** A single `pnpm verify` run reported `1 failed | 76 passed` and the next EIGHT runs were clean (4 full-suite, 4 targeted). Which test it was is unknown, because the log was discarded before the failure detail was read. **What HAS been ruled out:** the flake recorded in memory as "`confirmTotpEnrolment` reds when a code straddles a 30s boundary" cannot be it — `TOTP_DRIFT_STEPS = 1`, so `verifyTotp` accepts ±1 step and a boundary crossing is tolerated by design. That recorded explanation is simply wrong and has been corrected. If this recurs, capture the failing test name FIRST; a one-in-nine failure in a suite the PR gate depends on is worth a real diagnosis, not a re-run. |
| A5 | **The verify gate is fragile under container contention.** `reviewer`'s run once failed on a testcontainers `HealthCheckWaitStrategy` timeout (120 s, hardcoded in the library) because it ran `pnpm verify` at the same time as the main session. Isolated runs are green. `vitest.workspace.ts`'s `maxWorkers: 4` / `hookTimeout: 60_000` do NOT bound that particular timeout. Worth raising the health-check timeout or sharing one container across `packages/db` suites before it costs a CI run |

**Named Phase 2 remainders (the phase can close without them; they are not silent):**

| # | Gap |
|---|---|
| B1 | ⭐ **The biggest one left, and the only large one that is not blocked.** FR-120/121 mating + pregnancy diagnosis. The domain is complete and tested and takes `gestationDays` INJECTED, which is the design working as intended — it is reference data, not a magic number. Missing: a `species_gestation` reference table (biology, so **not** jurisdiction-scoped, unlike `veterinary_products`), its sync classification and seed, a reference endpoint, a client cache and two capture screens. Comparable in size to the FR-102 tally slice. **Deliberately not half-built:** the server half alone would repeat the FR-603 mistake this phase already made once |
| B2 | **FR-108 photos — BLOCKED on infrastructure, not design.** No S3/MinIO anywhere in the repo, no upload endpoint; `architecture.md` plans presigned direct-from-client upload and none of it exists. Building only the local half would set `photo_key` with no image behind it, and `evidence-pack.pdf.ts` prints "Photograph on file: Yes" off exactly that field — the pack would claim a photograph the Stock Theft Unit cannot be shown. See decision §2.8 |
| B3 | ✅ **CLOSED 2026-07-26 (`5e279b1`).** Strict per-species attribute schemas, enforced on the device and on the server from the same schema. The ADR-0006 seam assumption was wrong and the checklist line is corrected |
| B4 | **FR-132 due/overdue** — needs a vaccination programme schedule that does not exist. A tile carrying a number the app cannot compute is worse than one carrying none |
| B5 | **FR-602 unmarked-past-window flag** — the domain function is done and tested, but the prescribed window is dated reference data `regulatory_rates` does not carry, and inventing it in code is exactly the defect the domain rules forbid |
| B6 | ✅ **CLOSED 2026-07-26 (`bb17b24`).** The last Phase 1 gap. Enrolment offers the passkey first, sign-in uses it, Settings → Security lists/adds/revokes |
| B7 | ◐ **Three of four closed** (`00f1016`): sale weight, dose value/unit/route, dip method. **Remaining: walking a camp boundary by GPS.** The land API accepts a GeoJSON polygon and dual-writes it to PostGIS; nothing in the client produces one, so boundaries can only be typed. Needs a capture screen that collects points by walking and closes the ring — a real slice, not a field |
| B8, B10, B11, B12 | ✅ Closed in the third session |
| B9 | ✅ **CLOSED 2026-07-26 (`06884c7`).** `/animals/groups/count`. Append-only `tally` events, migrations 0017/0018, deltas that compose, a recount that supersedes, and a server-side re-derivation that is order-independent |

**Older carry-forwards, still open:**

| # | Gap |
|---|---|
| G1 | **`pnpm test:trace` does not exist.** `functional-requirements.md` claims it fails CI when a P1/P2 FR has no covering test. Write it, or soften the claim |
| G2 | **`phase-checklists.md` stops at Phase 2.** Blocks `/loop` for Phase 3+ |
| G3 | **Equipment register (FR-504) has no table.** `vehicles` carries a comment to add `equipment_id` additively. Phase 4i |
| G4 | **`user-guide.md` and `ux-design-system.md` not updated** for the 2026-07-25 scope, nor for the fourteen screens added since. Now also missing `/animals/groups/count` and Settings → Security. The **grievance flow needs real UX care** when it lands |
| G5 | **CI never runs on feature branches.** Green locally ≠ green in CI until the PR opens |

---

## 5. How to resume

```
Read STATUS.md, CLAUDE.md, and docs/04-delivery/phase-checklists.md.
Answer the decisions in STATUS.md §2 with me before planning.

Phase 1 has NO open gaps. Phase 2's exit gate reads true as written: every
checklist line is ☑ or ◐ with its remainder named, verify is green at 77 files
/ 741 tests, e2e green at 25.

Of the Phase 2 remainders, only TWO are buildable: B1 (FR-120/121 breeding —
needs a species_gestation reference table first) and B7's GPS boundary walk.
B2, B4 and B5 are each blocked on something that does not exist yet, and §4
says exactly what.

⚠️ NINE feature commits have not been through the review agents (§4 A6). They
were deferred on cost grounds, not because they are done. That is the one thing
owed before the PR.
```
